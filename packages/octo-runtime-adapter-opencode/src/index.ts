import type { AdapterMetadata } from "@mininglamp-oss/octo-runtime-adapter-sdk";

export const openCodeMetadata: AdapterMetadata = {
  mcp: true,
  type: "opencode",
  agentSources: ["provisioned"]
};

import {
  assertAdapterAgentEnv,
  assertAdapterWorkdir,
  runAdapterPreparation,
  invocationEffort,
  invocationModel,
  invocationRuntimeLimits,
  invocationApprovalMode,
  invocationWorkdir
} from "@mininglamp-oss/octo-runtime-adapter-sdk";
import {
  hasImageInput,
  mapReasoningEffort,
  invocationEnvironment,
  processEnvironmentValue,
  invocationMcpServers,
  assertMcpOptions
} from "@mininglamp-oss/octo-runtime-adapter-sdk";
import { canonicalTerminalStatus } from "@mininglamp-oss/octo-runtime-protocol";
/**
 * OpenCode adapter: wraps the OpenCode CLI (`opencode run --format json
 * --thinking --auto`) for full access and ACP for interactive approval.
 * Both transports normalize provider output into canonical events.
 */
import { AcpInvocationError, createAcpAdapter } from "@mininglamp-oss/octo-runtime-adapter-acp";
import {
  createJsonCliAdapter,
  probeCommand,
  snapshotProviderLaunch,
  providerInputText,
  ProviderProcessError,
  type AdapterInvocationContext,
  type CanonicalEvent,
  type InvokeRequest,
  type ProbeResult
} from "@mininglamp-oss/octo-runtime-adapter-sdk";

class OpenCodeInputError extends Error {}

/** 只展示宿主绑定目标的可选版本，不按版本号准入；协议可用性由实际执行结果确定。 */
export async function probeOpenCode(
  command: string,
  env: NodeJS.ProcessEnv = {},
  cwd?: string,
  args: readonly string[] = []
): Promise<ProbeResult> {
  return probeCommand(command, { cwd, env, args });
}

function inlineConfig(
  request: InvokeRequest,
  inherited: NodeJS.ProcessEnv = {}
): Record<string, unknown> {
  const content = processEnvironmentValue(
    invocationEnvironment(request, {}, inherited),
    "OPENCODE_CONFIG_CONTENT"
  );
  if (!content) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new OpenCodeInputError(
      "OPENCODE_CONFIG_INVALID: OPENCODE_CONFIG_CONTENT must be a JSON object"
    );
  }
  if (!isRecord(parsed))
    throw new OpenCodeInputError(
      "OPENCODE_CONFIG_INVALID: OPENCODE_CONFIG_CONTENT must be a JSON object"
    );
  return parsed;
}

/** A single OpenCode stream part; tool lifecycle is carried in `state.status` (running -> completed/error). */
interface OpenCodePart {
  sessionID?: string;
  messageID?: string;
  type?: string;
  text?: string;
  reason?: string;
  callID?: string;
  id?: string;
  tool?: string;
  state?: {
    status?: string;
    input?: unknown;
    output?: unknown;
    error?: unknown;
    time?: { start?: unknown; end?: unknown };
  };
  tokens?: Record<string, unknown>;
  cost?: unknown;
  time?: { start?: unknown; end?: unknown };
}

/** A top-level OpenCode event, which may wrap a part and carries session/usage/error at the envelope level. */
interface OpenCodeNativeEvent extends OpenCodePart {
  sessionID?: string;
  sessionId?: string;
  part?: OpenCodePart;
  timestamp?: unknown;
  usage?: Record<string, unknown>;
  error?: { data?: { message?: string }; message?: string };
}

/**
 * 构造本轮 OpenCode 命令、普通输入和执行配置；原生 inline config 保持，
 * 仅合并本轮 MCP 设置，不生成应用指令文件或追加系统提示词。
 */
export function buildOpenCodeCommand(
  req: InvokeRequest,
  command = "opencode",
  inherited: NodeJS.ProcessEnv = {}
) {
  return Promise.resolve().then(() => {
    if (hasImageInput(req))
      throw new Error("UNSUPPORTED_INPUT_MODALITY: opencode does not encode image input");
    if (invocationApprovalMode(req) !== "full_access")
      throw new Error("APPROVAL_MODE_UNSUPPORTED: opencode permission transport is not qualified");
    const runEnv = invocationEnvironment(req, {}, inherited);
    const servers = invocationMcpServers(req, runEnv);
    assertMcpOptions(servers, "opencode", ["toolTimeoutMs"]);
    const inline = inlineConfig(req, inherited);
    if (Object.keys(servers).length) {
      const existing = isRecord(inline.mcp) ? inline.mcp : {};
      inline.mcp = {
        ...existing,
        servers: {
          ...(isRecord(existing.servers) ? existing.servers : {}),
          ...Object.fromEntries(
            Object.entries(servers).map(([name, server]) => [
              name,
              {
                ...(server.type === "stdio"
                  ? {
                      type: "local",
                      command: [server.command, ...(server.args ?? [])],
                      environment: server.env ?? {}
                    }
                  : { type: "remote", url: server.url, headers: server.headers ?? {} }),
                disabled: false,
                ...(server.toolTimeoutMs !== undefined
                  ? { timeout: { execution: server.toolTimeoutMs } }
                  : {})
              }
            ])
          )
        }
      };
    }
    // Reasoning output and non-interactive tool approval are mandatory parts of
    // this adapter's provider contract.
    const args = ["run", "--format", "json", "--thinking", "--auto", "--standalone"];
    if (req.providerSession?.sessionId) args.push("--session", req.providerSession.sessionId);
    const variant = mapReasoningEffort("opencode", invocationEffort(req));
    const model = invocationModel(req);
    if (model) {
      args.push("--model", variant ? `${model.split("#")[0]}#${variant}` : model);
    }
    return {
      command,
      args,
      input: providerInputText(req),
      env: {
        OPENCODE_CONFIG_CONTENT: JSON.stringify(inline),
        OPENCODE_CLIENT: "octo-runtime",
        PWD: invocationWorkdir(req)
      },
      rpcMethod: "process.stdin",
      providerSessionId: req.providerSession?.sessionId,
      cleanup: () => undefined
    };
  });
}

/** Translate one OpenCode native event/part into canonical events; unrelated events yield an empty list. */
export function normalizeOpenCodeEvent(native: OpenCodeNativeEvent): CanonicalEvent[] {
  const events: CanonicalEvent[] = [];
  const part: OpenCodePart = native.part ?? native;
  const sessionId = native.sessionID ?? native.sessionId ?? native.part?.sessionID;
  if ((native.type === "step_start" || native.type === "session.created") && sessionId) {
    events.push({
      protocolVersion: 2,
      type: "session.update",
      payload: { providerSession: { sessionId, resumable: true } }
    });
  }
  const stepId = part.messageID;
  const timestamp = providerTimestamp(native.timestamp);
  if ((native.type === "step_start" || part.type === "step-start") && stepId) {
    events.push({
      protocolVersion: 2,
      type: "model_step.started",
      payload: { stepId, ...(timestamp === undefined ? {} : { startedAtMs: timestamp }) }
    });
  }
  const toolState = part.state;
  const toolId = part.callID ?? part.id;
  if ((native.type === "text" || part.type === "text") && typeof part.text === "string") {
    events.push({
      protocolVersion: 2,
      type: "message.delta",
      payload: {
        text: part.text,
        // 原生 text 是公开最终正文；显式标记，展示层无需猜测缺失的通道。
        channel: "final",
        ...(stepId
          ? { stepId, messageId: `opencode:${part.id ?? `${stepId}:answer`}` }
          : part.id
            ? { messageId: `opencode:${part.id}` }
            : {})
      }
    });
  }
  if ((native.type === "reasoning" || part.type === "reasoning") && typeof part.text === "string") {
    events.push({
      protocolVersion: 2,
      type: "message.delta",
      payload: {
        text: part.text,
        ...(stepId ? { stepId, messageId: `opencode:${part.id ?? `${stepId}:reasoning`}` } : {}),
        channel: "analysis",
        exposure: "public_reasoning",
        provenance: { provider: "opencode", nativeEvent: "reasoning" }
      }
    });
  }
  if (part.type === "tool" && toolState?.status === "running" && toolId && part.tool) {
    const args = isRecord(toolState.input)
      ? toolState.input
      : toolState.input == null
        ? {}
        : { value: toolState.input };
    events.push({
      protocolVersion: 2,
      type: "tool_call.create",
      payload: {
        status: "running",
        id: toolId,
        name: part.tool,
        args,
        ...(stepId ? { stepId } : {})
      }
    });
  }
  if (
    part.type === "tool" &&
    toolId &&
    toolState?.status &&
    ["completed", "error"].includes(toolState.status)
  ) {
    const args = isRecord(toolState.input)
      ? toolState.input
      : toolState.input == null
        ? {}
        : { value: toolState.input };
    const durationMs = toolDurationMs(toolState.time);
    // A terminal-only OpenCode frame carries enough identity to let the
    // projector create the item without inventing a duplicate start event.
    events.push({
      protocolVersion: 2,
      type: "tool_call.update",
      payload: {
        id: toolId,
        ...(part.tool ? { name: part.tool, args } : {}),
        status: canonicalTerminalStatus(toolState.status === "error" ? "failed" : toolState.status),
        output: toolState.output ?? toolState.error,
        ...(stepId ? { stepId } : {}),
        ...(durationMs === undefined ? {} : { durationMs })
      }
    });
  }
  if ((native.type === "step_finish" || part.type === "step-finish") && stepId) {
    events.push({
      protocolVersion: 2,
      type: "model_step.finished",
      payload: {
        stepId,
        status: canonicalTerminalStatus("completed"),
        ...(typeof part.reason === "string" ? { finishReason: part.reason } : {}),
        ...(timestamp === undefined ? {} : { endedAtMs: timestamp })
      }
    });
  }
  if (native.type === "step_finish" || part.type === "step-finish") {
    events.push({
      protocolVersion: 2,
      type: "usage.update",
      payload: {
        ...(part.tokens ?? native.usage ?? {}),
        cost: part.cost,
        ...(stepId ? { stepId } : {})
      }
    });
  }
  if (native.type === "error")
    events.push({
      protocolVersion: 2,
      type: "run.failed",
      payload: {
        message: native.error?.data?.message ?? native.error?.message ?? "OpenCode failed",
        providerError: native.error
      }
    });
  return events;
}

/** Narrow an unknown value to a plain object (excluding arrays), used to guard tool input before spreading it. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Return OpenCode's provider-measured whole-millisecond tool duration. */
function toolDurationMs(time: { start?: unknown; end?: unknown } | undefined): number | undefined {
  if (typeof time?.start !== "number" || typeof time.end !== "number") return undefined;
  if (!Number.isSafeInteger(time.start) || !Number.isSafeInteger(time.end) || time.end < time.start)
    return undefined;
  return time.end - time.start;
}

/** Preserve a provider event clock only when it is a valid Unix-millisecond value. */
function providerTimestamp(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

/**
 * Create an OpenCode adapter over the JSON CLI helper. OpenCode's stream ends
 * without an explicit terminal, so `onSuccess` synthesizes the closing
 * message.update/run.completed; run.failed is emitted inline by the normalizer.
 */
export class OpenCodeEventNormalizer {
  readonly #text = new Map<string, string>();
  readonly #tools = new Set<string>();

  normalize(native: OpenCodeNativeEvent): CanonicalEvent[] {
    return normalizeOpenCodeEvent(native).flatMap((event) => {
      if (
        event.type === "message.delta" &&
        typeof event.payload.messageId === "string" &&
        typeof event.payload.text === "string"
      ) {
        const id = event.payload.messageId;
        const previous = this.#text.get(id);
        const text = event.payload.text;
        this.#text.set(id, text);
        if (previous === undefined) return [event];
        if (previous === text) return [];
        if (text.startsWith(previous))
          return [{ ...event, payload: { ...event.payload, text: text.slice(previous.length) } }];
        return [
          {
            protocolVersion: 2,
            type: "message.update",
            payload: { ...event.payload, status: "streaming" }
          }
        ];
      }
      if (event.type === "tool_call.create") {
        const id = event.payload.id;
        if (this.#tools.has(id)) {
          const output = (native.part ?? native).state?.output;
          return output === undefined
            ? []
            : [
                {
                  protocolVersion: 2,
                  type: "tool_call.delta",
                  payload: {
                    id,
                    outputSnapshot: typeof output === "string" ? output : JSON.stringify(output)
                  }
                }
              ];
        }
        this.#tools.add(id);
      }
      return [event];
    });
  }
}

export function createOpenCodeAdapter({
  command,
  commandArgsPrefix = [],
  env = {}
}: {
  command: string;
  commandArgsPrefix?: readonly string[];
  env?: NodeJS.ProcessEnv;
}) {
  const launch = snapshotProviderLaunch({ command, args: commandArgsPrefix, env });
  const buildCommand = async (req: InvokeRequest) => {
    const spec = await buildOpenCodeCommand(req, launch.command, launch.env);
    return {
      ...spec,
      args: [...launch.args, ...spec.args],
      env: invocationEnvironment(req, spec.env, launch.env)
    };
  };
  const interactiveAdapters = new Map<string, ReturnType<typeof createAcpAdapter>>();
  const createInteractive = () =>
    createAcpAdapter(
      {
        type: "opencode",
        provider: "opencode",
        command: launch.command,
        args: ["acp"],
        // ACP 原生权限策略决定何时请求审批；桥接层逐次处理，不覆盖用户的 deny。
        env: (request) => ({
          OPENCODE_CLIENT: "octo-runtime",
          PWD: invocationWorkdir(request),
          OPENCODE_CONFIG_CONTENT: JSON.stringify(inlineConfig(request, launch.env))
        })
      },
      { command: launch.command, commandArgsPrefix: launch.args, env: launch.env }
    );
  const options: Parameters<typeof createJsonCliAdapter<OpenCodeNativeEvent>>[0] = {
    metadata: openCodeMetadata,
    probe: () => probeOpenCode(launch.command, launch.env, undefined, launch.args),
    buildCommand,
    normalize: normalizeOpenCodeEvent,
    onSuccess: (): CanonicalEvent[] => [
      {
        protocolVersion: 2,
        type: "message.update",
        payload: { role: "assistant", status: "completed" }
      },
      { protocolVersion: 2, type: "run.completed", payload: {} }
    ]
  };
  const adapter = createJsonCliAdapter<OpenCodeNativeEvent>(options);
  return {
    ...adapter,
    get defaultAgentEnv() {
      return adapter.defaultAgentEnv;
    },
    async respondInteraction(
      ...args: Parameters<ReturnType<typeof createAcpAdapter>["respondInteraction"]>
    ) {
      const interactive = interactiveAdapters.get(args[0]);
      if (!interactive) throw new Error("INTERACTION_NOT_ACTIVE");
      await interactive.respondInteraction(...args);
    },
    async *invoke(
      request: InvokeRequest,
      context?: AdapterInvocationContext
    ): AsyncGenerator<CanonicalEvent> {
      await runAdapterPreparation(context, async () => {
        assertAdapterAgentEnv(request);
        // 两种传输共用本轮预算；内层再次配置同值不会重置 Core 的计时起点。
        context?.configureRuntimeLimits?.(invocationRuntimeLimits(request));
        await assertAdapterWorkdir(request);
        if (hasImageInput(request))
          throw new Error("UNSUPPORTED_INPUT_MODALITY: opencode does not encode image input");
        if (invocationApprovalMode(request) === "assisted")
          throw new Error("APPROVAL_MODE_UNSUPPORTED: opencode has no qualified assisted policy");
        // 启动前只做目录与纯配置检查；实际协议失败按执行结果报告，不以版本号拦截。
        inlineConfig(request, launch.env);
      });
      request.signal?.throwIfAborted();
      if (invocationApprovalMode(request) === "ask") {
        if (interactiveAdapters.has(request.invocationId))
          throw new Error("INVOCATION_ALREADY_ACTIVE");
        const interactive = createInteractive();
        interactiveAdapters.set(request.invocationId, interactive);
        try {
          yield* interactive.invoke(request, context);
        } catch (error) {
          if (!(error instanceof AcpInvocationError)) throw error;
          // 只有共享 ACP 确认 close 成功后的调用错误才收敛为失败终态。
          yield { protocolVersion: 2, type: "run.failed", payload: { message: error.message } };
        } finally {
          interactiveAdapters.delete(request.invocationId);
        }
        return;
      }
      const normalizer = new OpenCodeEventNormalizer();
      let finalText = false;
      try {
        yield* createJsonCliAdapter<OpenCodeNativeEvent>({
          ...options,
          reasoningLevels: invocationModel(request) ? undefined : null,
          buildCommand,
          normalize: (native) => {
            const part = native.part ?? native;
            if (native.type === "step_start" || part.type === "step-start") finalText = false;
            if ((native.type === "text" || part.type === "text") && typeof part.text === "string")
              finalText = true;
            // 一个 step 的 stop 不能掩盖随后进程的失败；等待私有 CLI 正常退出。
            return normalizer.normalize(native);
          },
          onSuccess: (req) => {
            if (!finalText)
              return [
                {
                  protocolVersion: 2,
                  type: "run.failed",
                  payload: {
                    code: "OPENCODE_INCOMPLETE_OUTPUT",
                    message:
                      "OPENCODE_INCOMPLETE_OUTPUT: process exited without a final assistant response"
                  }
                }
              ];
            return options.onSuccess!(req);
          }
        }).invoke(request, context);
      } catch (error) {
        // helper 的 finally 已回收进程和临时文件；只收敛已知的进程退出，清理异常继续向上报告。
        if (!(error instanceof ProviderProcessError)) throw error;
        yield request.signal?.aborted
          ? {
              protocolVersion: 2,
              type: "run.cancelled",
              payload: { reason: String(request.signal.reason ?? "cancelled") }
            }
          : { protocolVersion: 2, type: "run.failed", payload: { message: error.message } };
      }
    }
  };
}
