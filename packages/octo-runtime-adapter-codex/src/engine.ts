import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { delimiter, isAbsolute, resolve } from "node:path";
import {
  invocationEnvironment,
  invocationEnvs,
  invocationMcpServers,
  mergeProcessEnvironment,
  processEnvironmentValue,
  probeCommand,
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
export type CodexTurnConfiguration = Pick<CodexAppServerCommand, "mcpServers">;
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
  command?: string;
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
  command = "codex",
  appServerArgs = buildCodexAppServerArgs(),
  env: NodeJS.ProcessEnv = process.env
): CodexAppServerCommand {
  const home = processEnvironmentValue(env, "CODEX_HOME");
  assertCodexHome(home);
  assertCodexInvocationHome(req, home);
  const runEnv = invocationEnvironment(req, { CODEX_HOME: home }, env);
  const mcp = codexMcpConfig(req, runEnv);
  return {
    command,
    args: [...appServerArgs, ...nativeCapacityOverrides(req)],
    cwd: req.workdir,
    env: mergeProcessEnvironment(runEnv, mcp.env),
    ...(Object.keys(mcp.servers).length ? { mcpServers: mcp.servers } : {}),
    cleanup: () => undefined
  };
}

/** 宿主显式创建惰性托管池；同配置复用，关闭 owned 进程但保留全部 Home 数据。 */
export function createManagedCodexEngine({
  codexHome,
  command = "codex",
  appServerArgs = buildCodexAppServerArgs(),
  spawnFn,
  env = process.env
}: ManagedCodexEngineOptions): ManagedCodexEngine {
  assertCodexHome(codexHome);
  const inherited = mergeProcessEnvironment(env, { CODEX_HOME: codexHome });
  const args = [...appServerArgs];
  const scopeId = randomUUID();
  const salt = randomBytes(32);
  const services = new Map<string, { semantic: string; service: CodexService }>();
  let closing = false;
  let close: Promise<void> | undefined;
  const unresolved = new Set<string>();
  const failed = new Set<string>();
  return {
    provider: {
      codexHome,
      probe: () => probeCommand(command),
      async acquire(request, context) {
        if (closing) throw new Error("CODEX_SERVICE_CLOSED");
        assertCodexInvocationHome(request, codexHome);
        const runEnv = invocationEnvironment(request, {}, inherited);
        const rawMessageMaxBytes = resolveStreamLimitPolicy(
          context?.streamLimits
        ).rawMessageMaxBytes;
        // 按解析语义分池，私有 MCP header 随机环境名不影响服务复用。
        const semantic = stableJson({
          command: executableIdentity(command, runEnv, request.workdir),
          args: [...args, ...nativeCapacityOverrides(request)],
          cwd: request.workdir,
          env: runEnv,
          home: codexHome,
          mcp: invocationMcpServers(request, runEnv),
          revision: request.agentConfig.providerOptions?.codexServiceRevision ?? "",
          rawMessageMaxBytes
        });
        const key = createHmac("sha256", salt).update(semantic).digest("hex");
        let entry = services.get(key);
        if (entry && entry.semantic !== semantic) throw new Error("CODEX_SERVICE_KEY_COLLISION");
        if (!entry) {
          if (services.size >= 8) throw new Error("CODEX_SERVICE_CONFIGURATIONS_EXCEEDED");
          entry = {
            semantic,
            service: new CodexService(
              scopeId,
              buildCodexCommand(request, command, args, inherited),
              spawnFn,
              rawMessageMaxBytes
            )
          };
          services.set(key, entry);
        }
        const channel = await entry.service.acquire(
          request.signal,
          Buffer.byteLength(JSON.stringify(request)),
          context?.protocolMode !== "native" && hasImageInput(request)
        );
        return { channel, configuration: { mcpServers: entry.service.spec.mcpServers } };
      }
    },
    processes: () => [...services.values()].map(({ service }) => service.snapshot()),
    beginShutdown() {
      closing = true;
      for (const { service } of services.values()) service.stopRecovery();
    },
    async close({ deadline }) {
      if (!Number.isFinite(deadline)) throw new TypeError("CLEANUP_DEADLINE_INVALID");
      closing = true;
      if (!close) {
        for (const { service } of services.values()) unresolved.add(service.id);
        close = Promise.all(
          [...services.values()].map(async ({ service }) => {
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
  const value = request.runMetadata?.contextCapacity as Record<string, unknown> | undefined;
  if (!value) return [];
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
  return [
    "-c",
    `model_context_window=${window}`,
    "-c",
    `model_auto_compact_token_limit=${window - reserve}`
  ];
}
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
/** 路径命令相对 cwd 解析一次；文件身份改变即选择新服务。 */
function executableIdentity(command: string, env: NodeJS.ProcessEnv, cwd: string): unknown {
  const extensions =
    process.platform === "win32" && !/\.[a-z]+$/i.test(command)
      ? (processEnvironmentValue(env, "PATHEXT") ?? ".EXE;.CMD;.BAT").split(";")
      : [""];
  const directories =
    isAbsolute(command) || /[/\\]/.test(command)
      ? [""]
      : (processEnvironmentValue(env, "PATH") ?? "").split(delimiter);
  for (const directory of directories)
    for (const extension of extensions) {
      try {
        const path = realpathSync(resolve(cwd, directory, command + extension));
        const info = statSync(path);
        if (info.isFile())
          return { path, dev: info.dev, ino: info.ino, size: info.size, mtime: info.mtimeMs };
      } catch (error) {
        if (!["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? ""))
          throw error;
      }
    }
  return { command };
}
