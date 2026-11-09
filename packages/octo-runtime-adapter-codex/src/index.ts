import {
  invocationEnvironment,
  invocationMcpServers,
  mergeProcessEnvironment,
  processEnvironmentValue
} from "@mininglamp-oss/octo-runtime-adapter-sdk";
import { codexMcpConfig } from "./mcp.js";
/**
 * Assembly entry point for the Codex adapter.
 *
 * 描述对象注册时创建独立 scope；按兼容配置选择常驻服务，再绑定本轮 channel。
 * scope 负责最终关闭；应用提示词随普通 turn 输入传递，不写入 thread 指令参数。
 */
import {
  defineAdapter,
  probeCommand,
  type AdapterInvocationContext,
  type InvokeRequest
} from "@mininglamp-oss/octo-runtime-adapter-sdk";
import {
  hasImageInput,
  resolveStreamLimitPolicy,
  type InteractionResponse,
  type NativeInteractionResponse
} from "@mininglamp-oss/octo-runtime-protocol";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  buildCodexAppServerArgs,
  runCodexAppServerTurn,
  type CodexAppServerCommand,
  type CodexAppServerSpawn,
  type CodexInteractionResponder
} from "./app-server.js";
import { CodexService } from "./service.js";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { delimiter, isAbsolute, resolve } from "node:path";
import type {
  AdapterExecutionScope,
  AdapterScopeCleanup,
  AdapterOutput,
  RuntimeLog
} from "@mininglamp-oss/octo-runtime-adapter-sdk";

export {
  buildCodexAppServerArgs,
  CodexEventNormalizer,
  CodexAppServerProcessError,
  CodexAppServerRpcError,
  normalizeCodexEvent,
  runCodexAppServerTurn,
  type CodexAppServerCommand,
  type CodexAppServerNotification,
  type CodexAppServerSpawn,
  type CodexInteractionResponder
} from "./app-server.js";

/**
 * Convert an Octo Runtime InvokeRequest into a launchable app-server process spec.
 *
 * The user prompt never appears in argv; it is written to stdin later via
 * turn/start. The parent process environment and the complete real CODEX_HOME
 * are reused without writing the user's config.toml. Application prompts remain
 * ordinary turn input and are not promoted to developer instructions.
 */
export function buildCodexCommand(
  req: InvokeRequest,
  command = "codex",
  appServerArgs = buildCodexAppServerArgs(),
  env: NodeJS.ProcessEnv = process.env
): CodexAppServerCommand {
  const runEnv = invocationEnvironment(req, {}, env);
  const mcp = codexMcpConfig(req, runEnv);
  const realHome = processEnvironmentValue(runEnv, "CODEX_HOME") || join(homedir(), ".codex");
  return {
    command,
    args: [...appServerArgs, ...nativeCapacityOverrides(req)],
    cwd: req.workdir,
    env: mergeProcessEnvironment(runEnv, mcp.env, { CODEX_HOME: realHome }),
    ...(Object.keys(mcp.servers).length ? { mcpServers: mcp.servers } : {}),
    cleanup: () => undefined
  };
}

/** 宿主已核实的窗口同步给 Codex；历史由原生自动压缩处理，绝不重发已接受的 turn。 */
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

export function createCodexAdapter({
  command = "codex",
  appServerArgs = buildCodexAppServerArgs(),
  spawnFn,
  env = process.env
}: {
  command?: string;
  appServerArgs?: string[];
  spawnFn?: CodexAppServerSpawn;
  env?: NodeJS.ProcessEnv;
} = {}) {
  return defineAdapter({
    metadata: {
      mcp: true,
      protocolSupport: {
        protocol: "codex.app-server",
        modes: ["native", "canonical"],
        nativeMethods: [
          "thread/start",
          "thread/resume",
          "turn/start",
          "turn/interrupt",
          "item/commandExecution/requestApproval",
          "execCommandApproval",
          "item/fileChange/requestApproval",
          "applyPatchApproval",
          "item/tool/requestUserInput",
          "mcpServer/elicitation/request"
        ]
      },
      type: "codex",
      agentSources: ["provisioned"],
      processModel: "service-owned-subprocess",
      transport: "json-rpc-2.0/stdio"
    },
    probe: () => probeCommand(command),
    createExecutionScope: ({ log }: { log: RuntimeLog }): AdapterExecutionScope => {
      const scopeId = randomUUID();
      const salt = randomBytes(32);
      const services = new Map<string, { semantic: string; service: CodexService }>();
      const interactionResponders = new Map<string, CodexInteractionResponder>();
      const nativeResponders = new Map<
        string,
        (response: NativeInteractionResponse) => Promise<void>
      >();
      const active = new Set<string>();
      let closing = false;
      let close: Promise<void> | undefined;
      const unresolved = new Set<string>();
      const failed = new Set<string>();
      const scope = {
        metadata: {
          type: "codex",
          agentSources: ["provisioned" as const],
          mcp: true,
          protocolSupport: {
            protocol: "codex.app-server",
            modes: ["native", "canonical"] as ["native", "canonical"],
            nativeMethods: []
          }
        },
        async *invoke(request: InvokeRequest, context?: AdapterInvocationContext) {
          if (closing) throw new Error("CODEX_SERVICE_CLOSED");
          if (active.has(request.invocationId)) throw new Error("CODEX_INVOCATION_BUSY");
          active.add(request.invocationId);
          try {
            const runEnv = invocationEnvironment(request, {}, env);
            const rawMessageMaxBytes = resolveStreamLimitPolicy(
              context?.streamLimits
            ).rawMessageMaxBytes;
            // 比较解析后的语义，而非每轮随机 MCP header 环境名；私有键从不进入诊断。
            const semantic = stableJson({
              command: executableIdentity(command, runEnv, request.workdir),
              args: [...appServerArgs, ...nativeCapacityOverrides(request)],
              cwd: request.workdir,
              env: runEnv,
              home: processEnvironmentValue(runEnv, "CODEX_HOME") || join(homedir(), ".codex"),
              mcp: invocationMcpServers(request, runEnv),
              revision: request.agentConfig.providerOptions?.codexServiceRevision ?? "",
              rawMessageMaxBytes
            });
            const key = createHmac("sha256", salt).update(semantic).digest("hex");
            let entry = services.get(key);
            if (entry && entry.semantic !== semantic)
              throw new Error("CODEX_SERVICE_KEY_COLLISION");
            if (!entry) {
              if (services.size >= 8) throw new Error("CODEX_SERVICE_CONFIGURATIONS_EXCEEDED");
              entry = {
                semantic,
                service: new CodexService(
                  scopeId,
                  buildCodexCommand(request, command, appServerArgs, env),
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
            try {
              yield* runCodexAppServerTurn({
                request,
                spec: entry.service.spec,
                channel,
                context,
                onInteractionResponder: (responder) => {
                  if (responder) interactionResponders.set(request.invocationId, responder);
                  else interactionResponders.delete(request.invocationId);
                },
                onNativeResponder: (responder) => {
                  if (responder) nativeResponders.set(request.invocationId, responder);
                  else nativeResponders.delete(request.invocationId);
                }
              });
            } finally {
              await channel.close();
            }
          } finally {
            active.delete(request.invocationId);
            interactionResponders.delete(request.invocationId);
            nativeResponders.delete(request.invocationId);
          }
        },
        async respondNative(invocationId: string, response: NativeInteractionResponse) {
          const responder = nativeResponders.get(invocationId);
          if (!responder) throw new Error("INTERACTION_NOT_ACTIVE");
          await responder(response);
        },
        async respondInteraction(invocationId: string, response: InteractionResponse) {
          const responder = interactionResponders.get(invocationId);
          if (!responder) throw new Error("INTERACTION_NOT_ACTIVE");
          await responder(response);
        },
        processes: () => [...services.values()].map(({ service }) => service.snapshot()),
        beginShutdown() {
          closing = true;
          for (const { service } of services.values()) service.beginShutdown();
        },
        close({ deadline }: { deadline: number }) {
          scope.beginShutdown();
          if (!close) {
            for (const { service } of services.values()) unresolved.add(service.id);
            close = Promise.all(
              [...services.values()].map(async ({ service }) => {
                try {
                  await service.close();
                  unresolved.delete(service.id);
                } catch {
                  failed.add(service.id);
                  log("warn", "codex.service.cleanup_incomplete", { service_id: service.id });
                }
              })
            ).then(() => {});
          }
          return (async (): Promise<AdapterScopeCleanup> => {
            let timer: NodeJS.Timeout | undefined;
            try {
              await Promise.race([
                close,
                new Promise<void>((resolve) => {
                  timer = setTimeout(resolve, Math.max(0, deadline - performance.now()));
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
          })();
        }
      };
      const defined = defineAdapter(scope);
      return { ...scope, invoke: defined.invoke };
    },
    respondNative(invocationId: string, response: NativeInteractionResponse): Promise<void> {
      void invocationId;
      void response;
      return Promise.reject(new Error("CODEX_SERVICE_SCOPE_REQUIRED"));
    },
    respondInteraction(invocationId: string, response: InteractionResponse): Promise<void> {
      void invocationId;
      void response;
      return Promise.reject(new Error("CODEX_SERVICE_SCOPE_REQUIRED"));
    },
    invoke(
      request: InvokeRequest,
      context?: AdapterInvocationContext
    ): AsyncIterable<AdapterOutput> {
      void request;
      void context;
      throw new Error("CODEX_SERVICE_SCOPE_REQUIRED");
    }
  });
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

/** 每轮校验入口文件身份；安装文件变化会换服务，不额外启动版本探针。 */
function executableIdentity(command: string, env: NodeJS.ProcessEnv, cwd: string): unknown {
  const extensions =
    process.platform === "win32" && !/\.[a-z]+$/i.test(command)
      ? (processEnvironmentValue(env, "PATHEXT") ?? ".EXE;.CMD;.BAT").split(";")
      : [""];
  // 带路径的命令只相对 cwd 解析一次；裸命令仍按 PATH 搜索。
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

export const codexAdapter = createCodexAdapter();
export default codexAdapter;
