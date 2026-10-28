import {
  initialControlInstructions,
  invocationEnvironment
} from "@mininglamp-oss/octo-runtime-adapter-sdk";
import {
  canonicalTerminalStatus,
  failureMessage,
  hasImageInput,
  type InteractionResponse
} from "@mininglamp-oss/octo-runtime-protocol";
/**
 * CodeBuddy adapter: wraps the CodeBuddy CLI spoken over ACP (Agent Client
 * Protocol) as JSON-RPC 2.0 on stdio, and normalizes its `session/update`
 * notifications into the harness canonical event stream.
 */
import type { AcpUpdate } from "@mininglamp-oss/octo-runtime-acp-client";
import {
  acpLoadSessionParams,
  acpNewSessionParams,
  acpPromptParams,
  spawnAcpClient
} from "@mininglamp-oss/octo-runtime-acp-client";
import {
  AcpApprovalBridge,
  AcpTurnNormalizer,
  acpToolTerminalStatus,
  defineAdapter,
  normalizeAcpToolUpdate,
  probeCommand,
  providerInputText,
  type AdapterInvocationContext,
  type CanonicalEvent,
  type InvokeRequest
} from "@mininglamp-oss/octo-runtime-adapter-sdk";

/** One ACP `session/update` notification; fields are optional because their presence depends on `sessionUpdate`. */
interface CodeBuddyUpdate extends AcpUpdate {
  sessionUpdate?: string;
  content?: unknown;
  text?: string;
  toolCallId?: string;
  name?: string;
  title?: string;
  rawInput?: unknown;
  input?: unknown;
  status?: string;
  output?: unknown;
}

/** Translate one ACP update into canonical events; unrecognized update kinds yield nothing. */
export function normalizeCodeBuddyUpdate(update: CodeBuddyUpdate): CanonicalEvent[] {
  const type = update.sessionUpdate ?? update.type;
  if (type === "agent_message_chunk" || type === "agent_thought_chunk") {
    const text =
      isRecord(update.content) && typeof update.content.text === "string"
        ? update.content.text
        : update.text;
    if (typeof text !== "string") return [];
    return [
      {
        protocolVersion: 2,
        type: "message.delta",
        payload:
          type === "agent_thought_chunk"
            ? {
                // agent_thought_chunk is CodeBuddy's presentation-facing ACP reasoning stream.
                text,
                channel: "analysis",
                exposure: "public_reasoning",
                provenance: { provider: "codebuddy", nativeEvent: "agent_thought_chunk" }
              }
            : { text, channel: "final" }
      }
    ];
  }
  if (type === "tool_call") {
    if (!update.toolCallId) return [];
    if (acpToolTerminalStatus(update.status)) return normalizeAcpToolUpdate(update);
    const value = update.rawInput ?? update.input;
    const args = isRecord(value) ? value : value == null ? {} : { value };
    return [
      {
        protocolVersion: 2,
        type: "tool_call.create",
        payload: {
          status: "running",
          id: update.toolCallId,
          name: update.name ?? update.title ?? "provider_tool",
          args
        }
      }
    ];
  }
  if (type === "tool_call_update") {
    return normalizeAcpToolUpdate(update);
  }
  if (type === "usage")
    return [
      {
        protocolVersion: 2,
        type: "usage.update",
        payload: { ...update.usage, ...(update.model ? { model: update.model } : {}) }
      }
    ];
  return [];
}

function isTerminalToolStatus(status: unknown): boolean {
  return (
    typeof status === "string" &&
    ["completed", "failed", "error", "cancelled", "canceled", "stopped"].includes(
      status.toLowerCase()
    )
  );
}

function isCancelledStopReason(reason: unknown): boolean {
  return (
    typeof reason === "string" &&
    ["cancelled", "canceled", "interrupted", "aborted"].includes(reason.toLowerCase())
  );
}

/** 只回报本次原生响应确认的模型；请求值及旧 binding 都不代表恢复后的实际模型。 */
function confirmedSessionModel(result: unknown): string | undefined {
  if (!isRecord(result)) return undefined;
  const option: unknown = Array.isArray(result.configOptions)
    ? result.configOptions.find(
        (value) => isRecord(value) && (value.id === "model" || value.category === "model")
      )
    : undefined;
  for (const value of [
    isRecord(option) ? option.currentValue : undefined,
    isRecord(result.models) ? result.models.currentModelId : undefined,
    result.model
  ]) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

/** 只使用本次会话广告的目录与原生 setter，不把 session/new.model 当作选模确认。 */
function modelSelection(session: unknown, sessionId: string, model: string) {
  const result = isRecord(session) ? session : {};
  const option: unknown = Array.isArray(result.configOptions)
    ? result.configOptions.find(
        (value) => isRecord(value) && (value.id === "model" || value.category === "model")
      )
    : undefined;
  const config = isRecord(option) ? option : undefined;
  const models = isRecord(result.models) ? result.models : {};
  const entries: unknown[] = config
    ? Array.isArray(config.options)
      ? config.options.flatMap((value: unknown) =>
          isRecord(value) && Array.isArray(value.options) ? (value.options as unknown[]) : [value]
        )
      : []
    : Array.isArray(models.availableModels)
      ? models.availableModels
      : [];
  const available = entries
    .filter(isRecord)
    .map((entry) => (config ? entry.value : entry.modelId))
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  if (!available.includes(model)) {
    throw new Error(
      `MODEL_NOT_FOUND: CodeBuddy does not offer model ${model}. Select a model from its advertised catalog.`
    );
  }
  if (confirmedSessionModel(result) === model) return undefined;
  if (config && (typeof config.id !== "string" || !config.id.trim())) {
    throw new Error(`CodeBuddy cannot select model ${model}: the model config option has no id`);
  }
  return config
    ? {
        method: "session/set_config_option",
        params: { sessionId, configId: config.id as string, value: model }
      }
    : { method: "session/set_model", params: { sessionId, modelId: model } };
}

/** ACP 失败详情按宿主要求原样序列化，不解析或筛选 Provider 的私有错误字段。 */
function promptFailure(update: AcpUpdate): CanonicalEvent["payload"] | undefined {
  const meta = isRecord(update._meta) ? update._meta : {};
  const outcome = meta["codebuddy.ai/outcome"];
  const raw = meta["codebuddy.ai/errorMessage"];
  const hasError = typeof raw === "string" ? raw.trim().length > 0 : raw != null;
  if (
    !(typeof update.stopReason === "string" && update.stopReason.toLowerCase() === "refusal") &&
    !(typeof outcome === "string" && outcome.startsWith("FAILED")) &&
    !hasError
  )
    return undefined;

  return {
    code: "ACP_MODEL_REQUEST_FAILED",
    message: `${failureMessage("OH-PRV-4010")}\n${JSON.stringify(update._meta)}`,
    adapterType: "codebuddy"
  };
}

/** 与通用 ACP 一致，仅在无流式 final 且未失败时使用已支持的结果正文载体。 */
function promptResultText(update: AcpUpdate): string | undefined {
  for (const value of [
    update.text,
    update.content,
    update.output,
    update.response,
    update.message
  ]) {
    if (typeof value === "string" && value.trim()) return value;
    if (isRecord(value) && typeof value.text === "string" && value.text.trim()) return value.text;
    if (Array.isArray(value)) {
      const text = value
        .filter(isRecord)
        .map((item) => (typeof item.text === "string" ? item.text : ""))
        .join("");
      if (text.trim()) return text;
    }
  }
  return undefined;
}

/**
 * 创建 CodeBuddy adapter；每轮拥有独立 ACP client，先握手并创建或恢复显式会话，再发送 prompt。
 * adapter 将 Provider 结果映射为唯一终态并负责关闭 client；Core 独立确认清理完成。
 * 显式模型在 prompt 前按本次原生目录设置并确认；回执只取确认值，Provider 失败优先于部分输出及空输出检查。
 */
export function createCodeBuddyAdapter({
  acpClientFactory = spawnAcpClient,
  command = "codebuddy"
}: { acpClientFactory?: typeof spawnAcpClient; command?: string } = {}) {
  const responders = new Map<string, AcpApprovalBridge>();
  return defineAdapter({
    metadata: {
      type: "codebuddy",
      agentSources: ["provisioned"]
    },
    probe: () => probeCommand(command),
    async respondInteraction(invocationId: string, response: InteractionResponse): Promise<void> {
      const bridge = responders.get(invocationId);
      if (!bridge) throw new Error("INTERACTION_NOT_ACTIVE");
      await bridge.respond(response);
    },
    async *invoke(
      req: InvokeRequest,
      context?: AdapterInvocationContext
    ): AsyncGenerator<CanonicalEvent> {
      if (hasImageInput(req))
        throw new Error("UNSUPPORTED_INPUT_MODALITY: codebuddy does not encode image input");
      if (responders.has(req.invocationId)) throw new Error("INVOCATION_ALREADY_ACTIVE");
      const permissions = new AcpApprovalBridge(req);
      responders.set(req.invocationId, permissions);
      async function* execute(): AsyncGenerator<CanonicalEvent> {
        const client = await Promise.resolve(
          acpClientFactory({
            command,
            args: ["--acp", "--permission-mode", codeBuddyPermissionMode(req.approvalMode)],
            env: invocationEnvironment(req),
            cwd: req.workdir,
            signal: req.signal,
            permissionHandler: (params) => permissions.requestPermission(params),
            onPermissionResponseWritten: (params) => permissions.responseWritten(params),
            onPermissionResponseFailed: (params, error) =>
              permissions.responseFailed(params, error),
            ...(context?.streamLimits ? { streamLimits: context.streamLimits } : {})
          })
        );
        permissions.bindTransport(() => client.close());
        try {
          await client.initialize();
          const requestedSessionId = req.providerSession?.sessionId;
          const sessionMethod = requestedSessionId ? "session/load" : "session/new";
          const sessionParams = requestedSessionId
            ? acpLoadSessionParams(requestedSessionId, { cwd: req.workdir })
            : acpNewSessionParams({ cwd: req.workdir });
          const sessionRequestId = client.reserveRequestId();
          let session: { id: string };

          const requestOptions = {
            requestId: sessionRequestId,
            ...(requestedSessionId ? { timeoutMs: 600_000 } : {})
          };
          const sessionResult = await client.request(sessionMethod, sessionParams, requestOptions);
          if (requestedSessionId) {
            session = { id: requestedSessionId };
          } else {
            const sessionId =
              isRecord(sessionResult) && typeof sessionResult.sessionId === "string"
                ? sessionResult.sessionId
                : undefined;
            if (!sessionId) throw new Error("ACP session/new returned no sessionId");
            session = { id: sessionId };
          }
          let model = confirmedSessionModel(sessionResult);
          const requestedModel = req.agentConfig?.model;
          if (requestedModel) {
            const selection = modelSelection(sessionResult, session.id, requestedModel);
            if (selection) {
              const selected = await client.request(selection.method, selection.params, {
                requestId: client.reserveRequestId()
              });
              // 空 ACK 或旧模型都不能证明切换生效；失败时不发送下一轮 prompt。
              model = confirmedSessionModel(selected);
              if (model !== requestedModel) {
                throw new Error(
                  `CodeBuddy did not confirm model ${requestedModel} after selection (confirmed: ${model ?? "unknown"}). Select a supported model and retry.`
                );
              }
            }
          }
          yield {
            protocolVersion: 2,
            type: "session.update",
            payload: {
              providerSession: {
                sessionId: session.id,
                resumable: true,
                ...(model ? { model } : {})
              }
            }
          };
          const prompt = `${providerInputText(req)}\n\n${initialControlInstructions(req)}`;
          const promptParams = acpPromptParams(session.id, prompt);
          const promptRequestId = client.reserveRequestId();

          let promptStopReason: string | undefined;
          let promptFinishReason: string | undefined;
          let failure: CanonicalEvent["payload"] | undefined;
          let resultText: string | undefined;
          let producedFinalOutput = false;
          const activeToolIds = new Set<string>();
          const turn = new AcpTurnNormalizer("codebuddy");
          for await (const update of client.prompt(session.id, prompt, {
            requestId: promptRequestId,
            params: promptParams
          })) {
            if (update.type === "prompt_result") {
              promptStopReason =
                typeof update.stopReason === "string" ? update.stopReason : undefined;
              promptFinishReason =
                typeof update.finishReason === "string" ? update.finishReason : undefined;
              failure ??= promptFailure(update);
              resultText = promptResultText(update);
              continue;
            }
            const events = turn.normalize(
              update.sessionUpdate ?? update.type,
              normalizeCodeBuddyUpdate(update)
            );
            for (const event of events) {
              if (
                event.type === "message.delta" &&
                event.payload.channel !== "analysis" &&
                typeof event.payload.text === "string" &&
                event.payload.text.trim()
              )
                producedFinalOutput = true;
              const toolID = typeof event.payload.id === "string" ? event.payload.id : undefined;
              if (event.type === "tool_call.create" && toolID) activeToolIds.add(toolID);
              if (
                event.type === "tool_call.update" &&
                toolID &&
                isTerminalToolStatus(event.payload.status)
              )
                activeToolIds.delete(toolID);
              yield event;
            }
          }
          const cancelled =
            !failure && (req.signal?.aborted || isCancelledStopReason(promptStopReason));
          if (!cancelled && !failure && !producedFinalOutput && resultText) {
            yield* turn.normalize(
              "agent_message_chunk",
              normalizeCodeBuddyUpdate({
                sessionUpdate: "agent_message_chunk",
                content: { text: resultText }
              })
            );
            producedFinalOutput = true;
          }
          if (!cancelled && !failure && !producedFinalOutput) {
            failure = {
              code: "ACP_NO_FINAL_OUTPUT",
              message: "CodeBuddy completed without assistant output",
              adapterType: "codebuddy"
            };
          }
          const status = failure ? "failed" : cancelled ? "cancelled" : "completed";
          if (cancelled || failure) {
            for (const id of activeToolIds) {
              yield {
                protocolVersion: 2,
                type: "tool_call.update",
                payload: { id, status: canonicalTerminalStatus(status) }
              };
            }
          }
          for (const event of turn.finish(promptFinishReason ?? promptStopReason, status))
            yield event;
          const terminalMessage: CanonicalEvent = {
            protocolVersion: 2,
            type: "message.update",
            payload: {
              role: "assistant",
              status: failure ? "failed" : cancelled ? "stopped" : "completed"
            }
          };
          yield terminalMessage;
          yield failure
            ? { protocolVersion: 2, type: "run.failed", payload: failure }
            : cancelled
              ? {
                  protocolVersion: 2,
                  type: "run.cancelled",
                  payload: {
                    reason: promptStopReason ?? "cancelled",
                    ...(promptFinishReason ? { finishReason: promptFinishReason } : {})
                  }
                }
              : { protocolVersion: 2, type: "run.completed", payload: {} };
        } finally {
          await client.close?.();
        }
      }
      try {
        yield* permissions.stream(execute());
      } finally {
        permissions.close("execution_lost");
        responders.delete(req.invocationId);
      }
    }
  });
}

export function codeBuddyPermissionMode(mode: InvokeRequest["approvalMode"]): string {
  switch (mode) {
    case "ask":
      return "default";
    case "assisted":
      return "auto";
    case "full_access":
      return "bypassPermissions";
    default:
      throw new Error("APPROVAL_MODE_UNSUPPORTED");
  }
}

/** Narrow an unknown value to a plain object (excluding arrays), used to guard ACP payloads before indexing. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export const codebuddyAdapter = createCodeBuddyAdapter();
export default codebuddyAdapter;
