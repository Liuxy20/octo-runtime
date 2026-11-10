import type { AdapterMetadata } from "@mininglamp-oss/octo-runtime-adapter-sdk";
export const codexMetadata: AdapterMetadata = {
  type: "codex",
  agentSources: ["provisioned"],
  mcp: true,
  processModel: "host-owned-engine",
  transport: "codex-channel",
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
  }
};

import {
  defineAdapter,
  type AdapterExecutionScope,
  type AdapterInvocationContext,
  type AdapterOutput,
  type InvokeRequest
} from "@mininglamp-oss/octo-runtime-adapter-sdk";
import type {
  InteractionResponse,
  NativeInteractionResponse
} from "@mininglamp-oss/octo-runtime-protocol";
import { runCodexAppServerTurn, type CodexInteractionResponder } from "./app-server.js";
import { assertCodexHome, assertCodexInvocationHome, type CodexEngineProvider } from "./engine.js";

export * from "./engine.js";
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
 * 宿主先构造 Codex 访问依赖，再注册 Adapter；注册只创建本地调用 scope。
 * scope 释放自身 lease 和路由，永不关闭 Engine；宿主最终关闭其 owner。
 * 这是 Codex 专用签名，不限制其他 Adapter 的类、工厂、闭包及任意依赖参数。
 */
export function createCodexAdapter({ engine }: { engine: CodexEngineProvider }) {
  if (!engine || typeof engine.acquire !== "function") throw new TypeError("CODEX_ENGINE_REQUIRED");
  assertCodexHome(engine.codexHome);
  return defineAdapter({
    metadata: codexMetadata,
    ...(engine.probe ? { probe: () => engine.probe!() } : {}),
    createExecutionScope: (): AdapterExecutionScope => {
      const active = new Set<string>();
      const failed = new Set<string>();
      const settled = new Map<string, Promise<void>>();
      const interactionResponders = new Map<string, CodexInteractionResponder>();
      const nativeResponders = new Map<
        string,
        (response: NativeInteractionResponse) => Promise<void>
      >();
      let closing = false;
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
          if (closing) throw new Error("CODEX_ADAPTER_CLOSED");
          if (active.has(request.invocationId)) throw new Error("CODEX_INVOCATION_BUSY");
          assertCodexInvocationHome(request, engine.codexHome);
          active.add(request.invocationId);
          let finish!: () => void;
          settled.set(
            request.invocationId,
            new Promise<void>((done) => {
              finish = done;
            })
          );
          try {
            const lease = await engine.acquire(request, context);
            try {
              // acquire 可晚于 scope 关闭返回；仍须 release，不能接纳迟到调用。
              if (closing) throw new Error("CODEX_ADAPTER_CLOSED");
              request.signal?.throwIfAborted();
              yield* runCodexAppServerTurn({
                request,
                context,
                channel: lease.channel,
                spec: lease.configuration,
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
              await release();
            }
            // 保留 release 失败作为独立 scope 清理事实；原执行终态不因此变为成功。
            async function release() {
              try {
                await lease.channel.close();
              } catch (error) {
                failed.add(request.invocationId);
                throw error;
              }
            }
          } finally {
            active.delete(request.invocationId);
            settled.delete(request.invocationId);
            finish();
            interactionResponders.delete(request.invocationId);
            nativeResponders.delete(request.invocationId);
          }
        },
        async respondInteraction(id: string, response: InteractionResponse) {
          const responder = interactionResponders.get(id);
          if (!responder) throw new Error("INTERACTION_NOT_ACTIVE");
          await responder(response);
        },
        async respondNative(id: string, response: NativeInteractionResponse) {
          const responder = nativeResponders.get(id);
          if (!responder) throw new Error("INTERACTION_NOT_ACTIVE");
          await responder(response);
        },
        beginShutdown() {
          closing = true;
        },
        async close({ deadline }: { deadline: number }) {
          if (!Number.isFinite(deadline)) throw new TypeError("CLEANUP_DEADLINE_INVALID");
          closing = true;
          // Core 取消和排空自身调用；不得借此关闭宿主共享 Engine。
          let timer: NodeJS.Timeout | undefined;
          try {
            await Promise.race([
              Promise.all([...settled.values()]),
              new Promise<void>((done) => {
                timer = setTimeout(done, Math.max(0, deadline - performance.now()));
              })
            ]);
          } finally {
            clearTimeout(timer);
          }
          return {
            complete: active.size === 0 && failed.size === 0,
            unresolvedServiceIds: [...new Set([...active, ...failed])],
            failedCleanupServiceIds: [...failed]
          };
        }
      };
      return { ...scope, invoke: defineAdapter(scope).invoke };
    },
    respondNative(_id: string, _response: NativeInteractionResponse): Promise<void> {
      void _id;
      void _response;
      return Promise.reject(new Error("CODEX_ADAPTER_SCOPE_REQUIRED"));
    },
    respondInteraction(_id: string, _response: InteractionResponse): Promise<void> {
      void _id;
      void _response;
      return Promise.reject(new Error("CODEX_ADAPTER_SCOPE_REQUIRED"));
    },
    invoke(
      _request: InvokeRequest,
      _context?: AdapterInvocationContext
    ): AsyncIterable<AdapterOutput> {
      void _request;
      void _context;
      throw new Error("CODEX_ADAPTER_SCOPE_REQUIRED");
    }
  });
}
