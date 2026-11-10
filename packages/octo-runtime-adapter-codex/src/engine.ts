import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import {
  invocationEnvironment,
  invocationEnvs,
  invocationProviderOptions,
  invocationWorkdir,
  mergeProcessEnvironment,
  processEnvironmentValue,
  probeCommand,
  snapshotProviderLaunch,
  type AdapterInvocationContext,
  type AdapterScopeCleanup,
  type InvokeRequest,
  type ProbeResult,
  type ServiceProcessSnapshot
} from "@mininglamp-oss/octo-runtime-adapter-sdk";
import { hasImageInput, resolveStreamLimitPolicy } from "@mininglamp-oss/octo-runtime-protocol";
import {
  buildCodexAppServerArgs,
  type CodexAppServerCommand,
  type CodexAppServerSpawn
} from "./app-server.js";
import { codexMcpConfig } from "./mcp.js";
import { CodexService } from "./service.js";

/** Codex 专用单调用通道；close 只释放本调用，不能关闭共享 Engine。 */
export interface CodexChannel {
  onMessage: (message: Record<string, unknown>) => void;
  onFailure: (error: Error) => void;
  reserveRequestId(): string | number;
  write(
    message: Record<string, unknown>,
    onError: (error: Error) => void,
    onWritten?: () => void,
    options?: { control?: boolean; timeoutMs?: number }
  ): () => void;
  cancelPending(error: Error): void;
  close(): Promise<void>;
  errorMessage(error: unknown): string;
}

/** 本轮协议配置，不向借用者暴露 spawn 或进程 cleanup。 */
export type CodexTurnConfiguration = Pick<CodexAppServerCommand, "mcpServers"> & {
  config?: Record<string, unknown>;
};
export interface CodexEngineLease {
  channel: CodexChannel;
  configuration: CodexTurnConfiguration;
}
/** 这是 Codex 专用访问依赖；不限制其他 Adapter 的构造参数。 */
export interface CodexEngineProvider {
  readonly codexHome: string;
  acquire(request: InvokeRequest, context?: AdapterInvocationContext): Promise<CodexEngineLease>;
  probe?(): Promise<ProbeResult>;
}
/** 宿主持有 owner 并最终关闭；Adapter 仅接收不含 close 的 provider。 */
export interface ManagedCodexEngine {
  readonly provider: CodexEngineProvider;
  processes(): readonly ServiceProcessSnapshot[];
  beginShutdown(): void;
  close(options: { deadline: number }): Promise<AdapterScopeCleanup>;
}
export interface ManagedCodexEngineOptions {
  codexHome: string;
  command: string;
  commandArgsPrefix?: readonly string[];
  appServerArgs?: string[];
  spawnFn?: CodexAppServerSpawn;
  env?: NodeJS.ProcessEnv;
}

/** Home 由宿主提供和准备；库不选择、创建或修改持久目录。 */
export function assertCodexHome(home: unknown): asserts home is string {
  if (typeof home !== "string" || !isAbsolute(home) || home.includes("\0"))
    throw new TypeError("CODEX_HOME_REQUIRED");
}
/** 本轮不能通过环境覆盖宿主已绑定的 Home。 */
export function assertCodexInvocationHome(request: InvokeRequest, home: string): void {
  const override = processEnvironmentValue(invocationEnvs(request), "CODEX_HOME");
  if (override !== undefined && override !== home) throw new Error("CODEX_HOME_CONFLICT");
}
/** 构造命令不启动进程；显式环境必须含 Home，不回退 ~/.codex。 */
export function buildCodexCommand(
  req: InvokeRequest,
  command: string,
  appServerArgs = buildCodexAppServerArgs(),
  env: NodeJS.ProcessEnv = {}
): CodexAppServerCommand {
  const home = processEnvironmentValue(env, "CODEX_HOME");
  assertCodexHome(home);
  assertCodexInvocationHome(req, home);
  const runEnv = invocationEnvironment(req, { CODEX_HOME: home }, env);
  const mcp = codexMcpConfig(req, runEnv);
  return {
    command,
    args: [...appServerArgs, ...nativeCapacityOverrides(req)],
    cwd: invocationWorkdir(req),
    env: mergeProcessEnvironment(runEnv, mcp.env),
    ...(Object.keys(mcp.servers).length ? { mcpServers: mcp.servers } : {}),
    cleanup: () => undefined
  };
}

/** 宿主显式拥有唯一 app-server；本轮配置只进入 thread，不参与进程选择。 */
export function createManagedCodexEngine({
  codexHome,
  command,
  commandArgsPrefix = [],
  appServerArgs = buildCodexAppServerArgs(),
  spawnFn,
  env = {}
}: ManagedCodexEngineOptions): ManagedCodexEngine {
  assertCodexHome(codexHome);
  const launch = snapshotProviderLaunch({ command, args: commandArgsPrefix, env });
  const inherited = mergeProcessEnvironment(launch.env, { CODEX_HOME: codexHome });
  const scopeId = randomUUID();
  // server 启动继承宿主目录；CODEX_HOME 仅是数据目录，本轮 cwd 只经 thread/turn RPC 传入。
  const spec: CodexAppServerCommand = {
    command: launch.command,
    args: [...launch.args, ...appServerArgs],
    env: inherited,
    cleanup: () => undefined
  };
  let service: CodexService | undefined;
  let closing = false;
  let close: Promise<void> | undefined;
  const unresolved = new Set<string>();
  const failed = new Set<string>();
  return {
    provider: {
      codexHome,
      probe: () => probeCommand(launch.command, { args: launch.args, env: inherited }),
      async acquire(request, context) {
        if (closing) throw new Error("CODEX_SERVICE_CLOSED");
        assertCodexInvocationHome(request, codexHome);
        if (invocationProviderOptions(request, "codex").codexServiceRevision !== undefined)
          throw new Error("CODEX_SERVICE_REVISION_UNSUPPORTED");
        const runEnv = invocationEnvironment(request, {}, inherited);
        const rawMessageMaxBytes = resolveStreamLimitPolicy(
          context?.streamLimits
        ).rawMessageMaxBytes;
        const mcp = codexMcpConfig(request, runEnv);
        const config = codexCapacityConfig(request);
        service ??= new CodexService(scopeId, spec, spawnFn);
        const channel = await service.acquire(
          request.signal,
          context?.protocolMode !== "native" && hasImageInput(request),
          rawMessageMaxBytes
        );
        return {
          channel,
          configuration: {
            ...(Object.keys(mcp.servers).length ? { mcpServers: mcp.servers } : {}),
            ...(Object.keys(config).length ? { config } : {})
          }
        };
      }
    },
    processes: () => (service ? [service.snapshot()] : []),
    beginShutdown() {
      closing = true;
      service?.stopRecovery();
    },
    async close({ deadline }) {
      if (!Number.isFinite(deadline)) throw new TypeError("CLEANUP_DEADLINE_INVALID");
      closing = true;
      if (!close) {
        if (service) unresolved.add(service.id);
        close = Promise.all(
          (service ? [service] : []).map(async (service) => {
            try {
              await service.close();
              unresolved.delete(service.id);
            } catch {
              failed.add(service.id);
            }
          })
        ).then(() => {});
      }
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          close,
          new Promise<void>((done) => {
            timer = setTimeout(done, Math.max(0, deadline - performance.now()));
          })
        ]);
      } finally {
        clearTimeout(timer);
      }
      return {
        complete: unresolved.size === 0,
        unresolvedServiceIds: [...unresolved],
        failedCleanupServiceIds: [...failed]
      };
    }
  };
}

/** 宿主已确认的容量映射为原生参数，不重发已接受的 turn。 */
function nativeCapacityOverrides(request: InvokeRequest): string[] {
  return Object.entries(codexCapacityConfig(request)).flatMap(([key, value]) => [
    "-c",
    `${key}=${value}`
  ]);
}
/** 容量属于本轮 thread 配置，不改变共享服务的 argv。 */
function codexCapacityConfig(request: InvokeRequest): Record<string, number> {
  const value = request.runMetadata?.contextCapacity as Record<string, unknown> | undefined;
  if (!value) return {};
  const window = value.contextWindow;
  const reserve = value.outputReserveTokens;
  if (
    value.management !== "provider_native" ||
    typeof window !== "number" ||
    !Number.isSafeInteger(window) ||
    window < 1024 ||
    typeof reserve !== "number" ||
    !Number.isSafeInteger(reserve) ||
    reserve < 0 ||
    reserve >= window
  )
    throw new TypeError("CONTEXT_CAPACITY_UNAVAILABLE");
  return {
    model_context_window: window,
    model_auto_compact_token_limit: window - reserve
  };
}
