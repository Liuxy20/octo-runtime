import {
  initialControlInstructions,
  hasImageInput,
  AcpApprovalBridge,
  DriverQueue,
  defineAdapter,
  invocationEnvs,
  mapReasoningEffort,
  providerInputText,
  type AdapterInvocationContext,
  type AdapterProbeOptions,
  type CanonicalEvent,
  type InvokeRequest
} from "@mininglamp-oss/octo-runtime-adapter-sdk";
import {
  canonicalTerminalStatus,
  type InteractionResponse
} from "@mininglamp-oss/octo-runtime-protocol";
import { randomUUID } from "node:crypto";
import {
  OpenClawGatewayClient,
  type OpenClawDeviceIdentity,
  type OpenClawGatewayEvent,
  type OpenClawGatewayOptions
} from "./gateway.js";
import { resolveOpenClawGateway, localGatewayFailure } from "./local-gateway.js";
import {
  resolveGatewayContract,
  resolveGatewayPermission,
  gatewayCreateParams,
  gatewayLegacyPermissionParams,
  gatewayTerminal,
  isGatewayRunPending,
  type GatewayTerminal
} from "./compatibility.js";

type JsonRecord = Record<string, unknown>;

export const OPENCLAW_PROVIDER_OPTIONS = {
  url: "OPENCLAW_GATEWAY_URL",
  token: "OPENCLAW_GATEWAY_TOKEN",
  deviceId: "OPENCLAW_GATEWAY_DEVICE_ID",
  publicKey: "OPENCLAW_GATEWAY_PUBLIC_KEY",
  privateKey: "OPENCLAW_GATEWAY_PRIVATE_KEY"
} as const;

export interface OpenClawGatewayInvocation {
  gateway: OpenClawGatewayOptions;
  agentId: string;
  sessionKey: string;
  requestId: string;
  reconciliationDeadlineAt: number;
  createParams: JsonRecord;
  agentParams: JsonRecord;
}

function asRecord(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function option(req: InvokeRequest, key: string): string | undefined {
  return nonEmptyString(req.agentConfig.providerOptions?.[key]);
}

function requiredOption(req: InvokeRequest, key: string): string {
  const value = option(req, key);
  if (!value) throw new Error(`OpenClaw adapter is not configured: missing ${key}`);
  return value;
}

/** The Gateway has a real system-prompt channel, so user content and Runtime instructions remain separate. */
export function composeOpenClawPrompt(req: InvokeRequest): string {
  return providerInputText(req);
}

export function buildOpenClawGatewayInvocation(req: InvokeRequest): OpenClawGatewayInvocation {
  if (hasImageInput(req))
    throw new Error("UNSUPPORTED_INPUT_MODALITY: openclaw does not encode image input");
  if (Object.keys(invocationEnvs(req)).length)
    throw new Error(
      "CONTEXT_ENVS_UNSUPPORTED: openclaw gateway has no per-run environment carrier"
    );
  const gatewayUrl = requiredOption(req, OPENCLAW_PROVIDER_OPTIONS.url);
  // TODO(P2, #243)：按 URL.hostname 判定产物位置，127.0.0.1/localhost/0.0.0.0 为本地；不使用 agentSource。
  const token = requiredOption(req, OPENCLAW_PROVIDER_OPTIONS.token);
  const device: OpenClawDeviceIdentity = {
    deviceId: requiredOption(req, OPENCLAW_PROVIDER_OPTIONS.deviceId),
    publicKey: requiredOption(req, OPENCLAW_PROVIDER_OPTIONS.publicKey),
    privateKey: requiredOption(req, OPENCLAW_PROVIDER_OPTIONS.privateKey)
  };
  const agentId = req.agentConfig.providerAgentId;
  if (!agentId || !/^[a-z0-9_][a-z0-9_-]{0,63}$/.test(agentId))
    throw new Error("OpenClaw provider_agent_id is required");
  const resumedKey = req.providerSession?.sessionId;
  if (
    resumedKey &&
    (!resumedKey.startsWith(`agent:${agentId}:`) ||
      (req.providerSession?.agentId !== undefined && req.providerSession.agentId !== agentId))
  )
    throw new Error("OPENCLAW_SESSION_AGENT_MISMATCH: recovery handle belongs to another agent");
  // 名称仅用于展示；原生 key 附独立随机量，同名调用绝不合并，续接只认 opaque handle。
  const sessionKey =
    resumedKey ??
    `agent:${agentId}:${req.sessionName ? `${encodeURIComponent(req.sessionName)}-` : ""}${randomUUID()}`;
  const requestId = `octo-runtime-${req.runId}-${randomUUID()}`;
  const message = composeOpenClawPrompt(req);
  const timeout = finiteNumber(req.agentConfig.timeoutSeconds);
  const model = nonEmptyString(req.agentConfig.model);
  const thinking = mapReasoningEffort("openclaw", req.agentConfig.effort);
  const timeoutMilliseconds = timeout && timeout > 0 ? timeout * 1_000 : 30 * 60_000;
  const reconciliationGraceMilliseconds = Math.min(30_000, timeoutMilliseconds * 0.1);
  const createParams: JsonRecord = {
    key: sessionKey,
    agentId,
    ...(model ? { model } : {})
  };
  const agentParams: JsonRecord = {
    message,
    agentId,
    sessionKey,
    deliver: false,

    idempotencyKey: requestId,
    ...(initialControlInstructions(req)
      ? { extraSystemPrompt: initialControlInstructions(req) }
      : {}),
    ...(model ? { model } : {}),
    ...(thinking ? { thinking } : {}),
    ...(timeout === undefined ? {} : { timeout: Math.max(0, Math.floor(timeout)) })
  };
  return {
    gateway: { url: gatewayUrl, token, device },
    agentId,
    sessionKey,
    requestId,
    reconciliationDeadlineAt: Date.now() + timeoutMilliseconds + reconciliationGraceMilliseconds,
    createParams,
    agentParams
  };
}

interface EventQueueItem {
  event?: OpenClawGatewayEvent;
  error?: Error;
  done?: true;
  result?: unknown;
}

interface StreamState {
  lastSeq: number;
  runId: string;
  stepNumber: number;
  stepHasTools: boolean;
  assistantText: string;
  reasoningText: string;
  stepStarted: boolean;
  stepFinished: boolean;
  stepFinishReason?: string;
  stepId?: string;
  messageNumber: number;
  messages: Map<string, CanonicalEvent["payload"]>;
  assistantItemId?: string;
  tools: Map<string, { stepId: string; finished: boolean }>;
  completedMessages: Set<string>;
  answers: Map<
    string,
    { message: CanonicalEvent["payload"]; text: string; phase?: "commentary" | "final_answer" }
  >;
  completedAnswerText?: string;
  finalAnswerText?: string;
}

function gatewayMessage(
  state: StreamState,
  channel: "analysis" | "assistant" | "commentary",
  nativeId?: string
): CanonicalEvent["payload"] {
  const key = channel === "commentary" ? `commentary:${nativeId ?? "preamble"}` : channel;
  let message = state.messages.get(key);
  if (!message) {
    message = {
      messageId: nativeId ? `openclaw:${nativeId}` : `openclaw:${channel}:${++state.messageNumber}`,
      stepId: state.stepId,
      channel: channel === "assistant" ? "commentary" : channel,
      ...(channel === "analysis"
        ? {
            exposure: "public_reasoning",
            provenance: { provider: "openclaw", nativeEvent: "gateway.agent.thinking" }
          }
        : {})
    };
    state.messages.set(key, message);
  }
  return message;
}

/** Run 内的模型轮独立编号；只有模型输出/原生消息边界才能开始新轮，工具结果不换轮。 */
function startGatewayStep(state: StreamState, startedAtMs?: number): CanonicalEvent[] {
  if (state.stepStarted && !state.stepFinished) return [];
  state.stepId = `openclaw:${state.runId}:round:${++state.stepNumber}`;
  state.stepStarted = true;
  state.stepFinished = false;
  state.stepFinishReason = undefined;
  state.stepHasTools = false;
  state.assistantText = "";
  state.reasoningText = "";
  state.assistantItemId = undefined;
  state.completedAnswerText = undefined;
  return [
    {
      protocolVersion: 2,
      type: "model_step.started",
      payload: {
        stepId: state.stepId,
        ...(startedAtMs === undefined ? {} : { startedAtMs })
      }
    }
  ];
}

function finishGatewayStep(
  state: StreamState,
  status: string,
  finishReason?: string,
  endedAtMs?: number
): CanonicalEvent[] {
  if (!state.stepStarted || state.stepFinished) return [];
  state.stepFinished = true;
  state.stepFinishReason = finishReason;
  const events: CanonicalEvent[] = [
    {
      protocolVersion: 2,
      type: "model_step.finished",
      payload: {
        stepId: state.stepId!,
        status: canonicalTerminalStatus(status),
        ...(finishReason ? { finishReason } : {}),
        ...(endedAtMs === undefined ? {} : { endedAtMs })
      }
    }
  ];
  for (const key of [...state.messages.keys()])
    events.push(...closeGatewayMessage(state, key, status));
  return events;
}

function rememberGatewayAnswer(
  state: StreamState,
  message: CanonicalEvent["payload"],
  phase?: unknown
): void {
  if (typeof message.messageId === "string") {
    if (!state.answers.has(message.messageId) && state.answers.size >= 4096)
      throw new Error("OPENCLAW_STREAM_STATE_EXCEEDED");
    state.answers.set(message.messageId, {
      message,
      text: state.assistantText,
      phase:
        phase === "commentary" || phase === "final_answer"
          ? phase
          : state.answers.get(message.messageId)?.phase
    });
  }
}

/** 旧 Gateway 缺最终 RPC 正文时只选当前步的最终片段；显式 commentary 永不兜底为 final。 */
function fallbackGatewayAnswer(state: StreamState): string {
  const answers = [...state.answers.values()].filter(
    (answer) => answer.message.stepId === state.stepId
  );
  if (answers.some((answer) => answer.phase))
    return answers
      .filter((answer) => answer.phase === "final_answer")
      .map((answer) => answer.text)
      .join("\n");
  return answers.at(-1)?.text ?? "";
}

/** 持久消息可能聚合多个已交付过程片段，只把尚属最后一条的正文交给该消息。 */
function remainingGatewayAnswer(text: string, earlierAnswers: string[]): string {
  const prefix = ["\n\n", "\n"]
    .map((separator) => earlierAnswers.join(separator) + separator)
    .find((candidate) => earlierAnswers.length > 0 && text.startsWith(candidate));
  return prefix ? text.slice(prefix.length) : text;
}

/** 与原生 assistant phase 对齐：显式区分时，只取 final_answer，不把 commentary 混入最终投递。 */
function completedGatewayAnswer(message: JsonRecord, blocks: JsonRecord[]): string {
  const textBlocks = blocks.filter(
    (block) => block.type === "text" && typeof block.text === "string"
  );
  const phases = textBlocks.map((block) => {
    if (typeof block.textSignature !== "string" || !block.textSignature.startsWith("{"))
      return undefined;
    try {
      const signature = asRecord(JSON.parse(block.textSignature));
      return signature?.v === 1 && ["commentary", "final_answer"].includes(String(signature.phase))
        ? signature.phase
        : undefined;
    } catch {
      return undefined;
    }
  });
  const explicit = phases.some(Boolean);
  const final = textBlocks.filter(
    (_, index) => (phases[index] ?? (explicit ? undefined : message.phase)) === "final_answer"
  );
  if (final.length) return final.map((block) => block.text).join("\n");
  if (explicit || message.phase === "commentary") return "";
  return textBlocks.map((block) => block.text).join("\n");
}

/** 只处理调用层已核验 session/run 的持久消息；不从 transcript 补发未公开的 reasoning。 */
function normalizeGatewaySessionMessage(payload: unknown, state: StreamState): CanonicalEvent[] {
  const native = asRecord(payload);
  const message = asRecord(native?.message);
  const metadata = asRecord(message?.__openclaw);
  const id = nonEmptyString(native?.messageId) ?? nonEmptyString(metadata?.id);
  if (!id || !message || message.role !== "assistant" || !Array.isArray(message.content)) return [];
  if (state.completedMessages.has(id)) return [];
  if (state.completedMessages.size >= 4096) throw new Error("OPENCLAW_STREAM_STATE_EXCEEDED");
  state.completedMessages.add(id);
  const blocks = message.content.map(asRecord).filter((b): b is JsonRecord => !!b);
  const toolBlocks = blocks.filter((b) => b.type === "toolCall" && nonEmptyString(b.id));
  const knownStep = toolBlocks.map((b) => state.tools.get(String(b.id))?.stepId).find(Boolean);
  // 已经通过工具边界换轮后才到达的消息属于旧轮，不能结束当前模型调用或重复创建工具。
  if (knownStep && (knownStep !== state.stepId || state.stepFinished)) return [];
  const events = startGatewayStep(state, finiteNumber(message.timestamp));
  for (const block of toolBlocks) {
    const toolId = String(block.id);
    if (state.tools.has(toolId)) continue;
    if (state.tools.size >= 4096) throw new Error("OPENCLAW_STREAM_STATE_EXCEEDED");
    state.tools.set(toolId, { stepId: state.stepId!, finished: false });
    state.stepHasTools = true;
    events.push({
      protocolVersion: 2,
      type: "tool_call.create",
      payload: {
        id: toolId,
        name: nonEmptyString(block.name) ?? "tool",
        status: "running",
        args: asRecord(block.arguments) ?? {},
        stepId: state.stepId
      }
    });
  }
  const textBlocks = blocks
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => String(b.text));
  const text = textBlocks.join("\n");
  const stepAnswers = [...state.answers.entries()].filter(
    ([, answer]) => answer.message.stepId === state.stepId
  );
  const alreadyDelivered = ["\n", "\n\n"].some(
    (separator) => text === stepAnswers.map(([, answer]) => answer.text).join(separator)
  );
  if (text && !alreadyDelivered) {
    const corrections: Array<{ message: CanonicalEvent["payload"]; text: string }> = [];
    if (stepAnswers.length > 0 && stepAnswers.length === textBlocks.length) {
      // 原生 text block 和流式 item 保持顺序；每块分别校正，不能把全量正文塞进末块。
      for (const [index, [, answer]] of stepAnswers.entries())
        corrections.push({ message: answer.message, text: textBlocks[index] });
    } else {
      const answer = gatewayMessage(state, "assistant");
      const earlierAnswers = stepAnswers
        .filter(([id]) => id !== answer.messageId)
        .map(([, value]) => value.text);
      const nextText = remainingGatewayAnswer(text, earlierAnswers);
      if (earlierAnswers.length && nextText === text) {
        // Provider 合并/拆分 block 且旧前缀也被修正时，以持久正文替换本步片段并清空旧余片。
        const first = stepAnswers[0][1].message;
        corrections.push({ message: first, text });
        for (const [, previous] of stepAnswers.slice(1)) {
          events.push({
            protocolVersion: 2,
            type: "message.update",
            payload: { ...previous.message, text: "", status: "completed" }
          });
          state.answers.delete(String(previous.message.messageId));
        }
        state.messages.set("assistant", first);
      } else corrections.push({ message: answer, text: nextText });
    }
    for (const correction of corrections) {
      if (state.answers.get(String(correction.message.messageId))?.text !== correction.text)
        events.push({
          protocolVersion: 2,
          type: "message.update",
          payload: {
            ...correction.message,
            text: correction.text,
            role: "assistant",
            status: "completed"
          }
        });
      state.assistantText = correction.text;
      rememberGatewayAnswer(state, correction.message);
    }
  }
  const reason = nonEmptyString(message.stopReason);
  const finishReason = reason === "toolUse" || reason === "tool_use" ? "tool-calls" : reason;
  if (finishReason === "tool-calls") state.stepHasTools = true;
  const status = ["error", "failed", "aborted", "cancelled"].includes(reason ?? "")
    ? "failed"
    : "completed";
  state.completedAnswerText =
    status === "completed" && finishReason !== "tool-calls" && finishReason !== "length"
      ? completedGatewayAnswer(message, blocks)
      : "";
  const endedAtMs = finiteNumber(metadata?.recordTimestampMs);
  events.push(...finishGatewayStep(state, status, finishReason, endedAtMs));
  return events;
}

function closeGatewayMessage(
  state: StreamState,
  key: string,
  status = "completed"
): CanonicalEvent[] {
  const message = state.messages.get(key);
  if (!message) return [];
  state.messages.delete(key);
  return [
    {
      protocolVersion: 2,
      type: "message.update",
      payload: { ...message, status: canonicalTerminalStatus(status) }
    }
  ];
}

function snapshotDelta(previous: string, next: string): { delta?: string; replacement?: string } {
  if (next === previous) return {};
  if (next.startsWith(previous)) return { delta: next.slice(previous.length) };
  return { replacement: next };
}

function usageEvent(data: JsonRecord): CanonicalEvent | undefined {
  const inputTokens = finiteNumber(data.inputTokens ?? data.input ?? data.promptTokens);
  const outputTokens = finiteNumber(
    data.outputTokens ?? data.output ?? data.completionTokens ?? data.tokens
  );
  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  return {
    protocolVersion: 2,
    type: "usage.update",
    payload: {
      inputTokens: inputTokens ?? 0,
      outputTokens: outputTokens ?? 0,
      ...(nonEmptyString(data.provider) ? { provider: data.provider } : {}),
      ...(nonEmptyString(data.model) ? { model: data.model } : {})
    }
  };
}

function normalizeGatewayAgentEvent(payload: unknown, state: StreamState): CanonicalEvent[] {
  const native = asRecord(payload);
  const seq = finiteNumber(native?.seq);
  const stream = nonEmptyString(native?.stream);
  const data = asRecord(native?.data);
  if (
    !native ||
    seq === undefined ||
    !Number.isSafeInteger(seq) ||
    seq <= state.lastSeq ||
    !stream ||
    !data
  )
    return [];
  state.lastSeq = seq;
  const events: CanonicalEvent[] = [];
  state.runId = nonEmptyString(native.runId) ?? state.runId;

  if (stream === "lifecycle") {
    const phase = nonEmptyString(data.phase);
    const terminal = gatewayTerminal(data, "lifecycle");
    if (phase === "start" && !state.stepStarted)
      events.push(...startGatewayStep(state, finiteNumber(data.startedAt)));
    if (
      (phase === "end" || phase === "error") &&
      terminal &&
      state.stepStarted &&
      !state.stepFinished
    ) {
      const finishReason = nonEmptyString(data.stopReason);
      events.push(...finishGatewayStep(state, terminal, finishReason, finiteNumber(data.endedAt)));
    }
    return events;
  }

  const modelOutput =
    stream === "assistant" ||
    stream === "thinking" ||
    (stream === "item" && data.kind === "preamble");
  // 持久 stop 通知后可能再次 flush 同一份 assistant 快照；它不是新模型调用。
  if (
    stream === "assistant" &&
    state.stepFinished &&
    state.stepFinishReason === "stop" &&
    (data.text === state.assistantText || data.text === state.completedAnswerText)
  )
    return events;
  if (modelOutput) {
    // 旧 Gateway 没有可关联的持久消息时，以工具批次后下一次模型输出确认新调用。
    if (state.stepHasTools && !state.stepFinished)
      events.push(...finishGatewayStep(state, "completed", "tool-calls"));
    events.push(...startGatewayStep(state, finiteNumber(native.ts)));
  }
  if (stream === "assistant" && typeof data.text === "string") {
    events.push(...closeGatewayMessage(state, "analysis"));
    state.reasoningText = "";
    const nativeId = nonEmptyString(data.itemId);
    if (nativeId && nativeId !== state.assistantItemId) {
      events.push(...closeGatewayMessage(state, "assistant"));
      state.assistantText = "";
      state.assistantItemId = nativeId;
    }
    const message = gatewayMessage(state, "assistant", nativeId);
    const change = snapshotDelta(state.assistantText, data.text);
    state.assistantText = data.text;
    rememberGatewayAnswer(state, message, data.phase);
    if (change.delta)
      events.push({
        protocolVersion: 2,
        type: "message.delta",
        payload: { ...message, text: change.delta }
      });
    if (change.replacement !== undefined) {
      events.push({
        protocolVersion: 2,
        type: "message.update",
        payload: {
          ...message,
          role: "assistant",
          status: "streaming",
          text: change.replacement,
          channel: "commentary"
        }
      });
    }
  } else if (stream === "thinking" && typeof data.text === "string") {
    const message = gatewayMessage(state, "analysis");
    const change = snapshotDelta(state.reasoningText, data.text);
    state.reasoningText = data.text;
    const text = change.delta ?? change.replacement;
    if (text) {
      events.push({
        protocolVersion: 2,
        type: change.replacement === undefined ? "message.delta" : "message.update",
        payload: {
          ...message,
          role: "assistant",
          status: "streaming",
          text,
          channel: "analysis",
          exposure: "public_reasoning",
          provenance: { provider: "openclaw", nativeEvent: "gateway.agent.thinking" }
        }
      });
    }
  } else if (stream === "thinking" && finiteNumber(data.progressTokens) !== undefined) {
    if (!state.messages.has("analysis")) {
      events.push({
        protocolVersion: 2,
        type: "message.create",
        payload: { ...gatewayMessage(state, "analysis"), status: "streaming", exposure: "unknown" }
      });
    }
  } else if (stream === "tool") {
    const phase = nonEmptyString(data.phase);
    const id = nonEmptyString(data.toolCallId);
    if (!id) return events;
    let tool = state.tools.get(id);
    if (phase === "start") {
      if (tool) return events;
      // 7.1 的 toolUse 持久消息可能只含正文；随后才广播的工具仍属于刚结束的模型调用。
      if (!state.stepFinished || state.stepFinishReason !== "tool-calls")
        events.push(...startGatewayStep(state));
      tool = { stepId: state.stepId!, finished: false };
      if (state.tools.size >= 4096) throw new Error("OPENCLAW_STREAM_STATE_EXCEEDED");
      state.tools.set(id, tool);
      state.stepHasTools = true;
      events.push(...closeGatewayMessage(state, "analysis"));
      state.reasoningText = "";
      events.push({
        protocolVersion: 2,
        type: "tool_call.create",
        payload: {
          status: "running",
          id,
          stepId: tool.stepId,
          name: nonEmptyString(data.name) ?? "tool",
          args: asRecord(data.args) ?? {}
        }
      });
    } else if (phase === "update") {
      if (!tool || tool.finished) return events;
      const argsDelta = typeof data.argsDelta === "string" ? data.argsDelta : undefined;
      const output = data.result ?? data.partialResult;
      events.push({
        protocolVersion: 2,
        type: "tool_call.delta",
        payload: {
          id,
          stepId: tool.stepId,
          ...(argsDelta === undefined ? {} : { argsDelta }),
          ...(output === undefined && argsDelta !== undefined
            ? {}
            : {
                outputSnapshot: typeof output === "string" ? output : JSON.stringify(output ?? "")
              })
        }
      });
    } else if (phase === "result") {
      if (!tool || tool.finished) return events;
      tool.finished = true;
      events.push({
        protocolVersion: 2,
        type: "tool_call.update",
        payload: {
          id,
          stepId: tool.stepId,
          ...(nonEmptyString(data.name) ? { name: data.name } : {}),
          status: canonicalTerminalStatus(data.isError === true ? "error" : "completed"),
          output: data.result
        }
      });
    }
  } else if (stream === "command_output") {
    const id = nonEmptyString(data.toolCallId);
    const tool = id ? state.tools.get(id) : undefined;
    // command_output 是已有工具的输出快照，不是模型思考，也不能单独创建模型轮次。
    if (!id || !tool) return events;
    if (data.phase === "delta" && typeof data.output === "string" && !tool.finished)
      events.push({
        protocolVersion: 2,
        type: "tool_call.delta",
        payload: {
          id,
          stepId: tool.stepId,
          outputSnapshot: data.output
        }
      });
    if (data.phase === "end") {
      tool.finished = true;
      const exitCode = finiteNumber(data.exitCode);
      const durationMs = finiteNumber(data.durationMs);
      events.push({
        protocolVersion: 2,
        type: "tool_call.update",
        payload: {
          id,
          stepId: tool.stepId,
          status: canonicalTerminalStatus(data.status),
          ...(typeof data.output === "string" ? { output: data.output } : {}),
          ...(exitCode === undefined ? {} : { exitCode }),
          ...(durationMs === undefined ? {} : { durationMs })
        }
      });
    }
  } else if (
    stream === "item" &&
    data.kind === "preamble" &&
    typeof data.progressText === "string"
  ) {
    const nativeId = nonEmptyString(data.itemId);
    const message = gatewayMessage(state, "commentary", nativeId);
    events.push({
      protocolVersion: 2,
      type: "message.update",
      payload: {
        ...message,
        text: data.progressText,
        status: data.phase === "end" ? "completed" : "streaming"
      }
    });
    if (data.phase === "end") state.messages.delete(`commentary:${nativeId ?? "preamble"}`);
  } else if (stream === "usage") {
    const event = usageEvent(data);
    if (event) events.push(event);
  }
  return events;
}

function terminalState(payload: unknown): "completed" | "failed" | "cancelled" | undefined {
  const native = asRecord(payload);
  if (native?.stream !== "lifecycle") return undefined;
  const data = asRecord(native.data);
  if (data?.phase !== "end" && data?.phase !== "error") return undefined;
  return gatewayTerminal(data, "lifecycle");
}

function terminalError(payload: unknown): string {
  return (
    nonEmptyString(asRecord(asRecord(payload)?.data)?.error) ?? "OpenClaw Gateway agent run failed"
  );
}

async function waitForConfirmedTerminal(
  client: OpenClawGatewayClientLike,
  runId: string,
  expected: GatewayTerminal | undefined,
  deadlineAt: number
): Promise<GatewayTerminal> {
  while (Date.now() < deadlineAt) {
    const waitMs = Math.max(1, Math.min(30_000, deadlineAt - Date.now()));
    const result = asRecord(
      await client.request(
        "agent.wait",
        { runId, timeoutMs: waitMs },
        { timeoutMs: waitMs + 2_000 }
      )
    );
    const status = nonEmptyString(result?.status);
    const actual = gatewayTerminal(result, "wait");
    if (actual && (expected === undefined || actual === expected)) return actual;
    if (!actual && (isGatewayRunPending(result) || status === "timeout")) {
      await new Promise<void>((resolve) =>
        setTimeout(resolve, Math.min(250, Math.max(0, deadlineAt - Date.now())))
      );
      continue;
    }
    const error = nonEmptyString(result?.error);
    throw new Error(
      error
        ? `OpenClaw Gateway confirmed ${actual ?? status ?? "unknown"}, not ${expected}: ${error}`
        : `OpenClaw Gateway confirmed ${actual ?? status ?? "unknown"}, not ${expected}`
    );
  }
  throw new Error(
    `OpenClaw Gateway did not confirm ${expected ?? "a terminal state"} before the invocation deadline`
  );
}

function normalizeFinalResponse(
  value: unknown,
  state: StreamState,
  runId: string
): {
  events: CanonicalEvent[];
  terminal?: "completed" | "failed" | "cancelled";
  error?: string;
} {
  const response = asRecord(value);
  const result = asRecord(response?.result);
  const meta = asRecord(result?.meta);
  const agentMeta = asRecord(meta?.agentMeta);
  const events: CanonicalEvent[] = [];
  state.runId = runId;
  const payloads = Array.isArray(result?.payloads) ? result.payloads.map(asRecord) : [];
  // 原生 finalTextFromResult 的选择合同：不把过程、reasoning 或错误 payload 投进 IM finalMsg。
  const selected = payloads
    .filter(
      (item) =>
        item && item.isReasoning !== true && item.isCommentary !== true && item.isError !== true
    )
    .map((item) => nonEmptyString(item?.text)?.trimEnd() ?? "")
    .filter(Boolean)
    .join("\n");
  // 7.1 的 payload 投影会丢失 reasoning 标记；原生最终可见正文比未标记的列表更权威。
  const metadataText =
    !payloads.some((item) => item?.isError === true) &&
    typeof meta?.finalAssistantVisibleText === "string"
      ? meta.finalAssistantVisibleText.trimEnd()
      : undefined;
  const finalText = metadataText ?? selected;
  if (Array.isArray(result?.payloads) || typeof meta?.finalAssistantVisibleText === "string")
    state.finalAnswerText = finalText;
  const needsNextStep =
    state.stepFinished &&
    (state.stepHasTools || ["length", "error", "failed"].includes(state.stepFinishReason ?? ""));
  if (finalText) {
    // 工具/length 后模型可能不公开任何流式输出，最终正文仍证明发生了下一次模型调用。
    if (!state.stepStarted || needsNextStep) events.push(...startGatewayStep(state));
  }
  const usage = asRecord(agentMeta?.usage);
  const usageUpdate = usageEvent({
    inputTokens: usage?.input,
    outputTokens: usage?.output,
    provider: agentMeta?.provider,
    model: agentMeta?.model
  });
  if (usageUpdate) events.push(usageUpdate);

  const terminal = gatewayTerminal(response, "final");
  if (terminal && !state.stepFinished) {
    if (!state.stepStarted) events.push(...startGatewayStep(state));
    events.push(...finishGatewayStep(state, terminal, nonEmptyString(meta?.stopReason)));
  }
  return {
    events,
    terminal,
    ...(terminal === "failed"
      ? { error: nonEmptyString(response?.summary) ?? "OpenClaw Gateway agent run failed" }
      : {})
  };
}

export interface OpenClawGatewayClientLike {
  connect(): Promise<unknown>;
  onEvent(listener: (event: OpenClawGatewayEvent) => void): () => void;
  request(
    method: string,
    params: JsonRecord,
    options?: {
      expectFinal?: boolean;
      timeoutMs?: number | null;
      signal?: AbortSignal;
      onAccepted?: (value: unknown) => void;
    }
  ): Promise<unknown>;
  close(): Promise<void>;
}

type GatewayClientFactory = (options: OpenClawGatewayOptions) => OpenClawGatewayClientLike;

async function* invokeOpenClawGateway(
  req: InvokeRequest,
  invocation: OpenClawGatewayInvocation,
  context: AdapterInvocationContext | undefined,
  clientFactory: GatewayClientFactory,
  permissions: AcpApprovalBridge
): AsyncGenerator<CanonicalEvent> {
  const client = clientFactory(invocation.gateway);
  const requestAbort = new AbortController();
  let resourceFailure: Error | undefined;
  let terminal: "completed" | "failed" | "cancelled" | undefined;
  let closing: Promise<void> | undefined;
  const stop = (cancel = false): Promise<void> => {
    if (closing) return closing;
    unsubscribe();
    requestAbort.abort();
    closing = (async () => {
      if (cancel && agentDispatched)
        await client
          .request(
            "sessions.abort",
            {
              key: providerSessionKey,
              runId: acceptedRunId,
              agentId: invocation.agentId
            },
            { timeoutMs: 5000 }
          )
          .catch(() => undefined);
      await client.close();
    })();
    // A paused consumer must not leave a rejected cleanup promise unobserved.
    void closing.catch(() => undefined);
    return closing;
  };
  let cancellation: Promise<void> | undefined;
  const confirmCancellation = (): Promise<void> => {
    cancellation ??= (async () => {
      if (!agentDispatched) return;
      let recoveryClient: OpenClawGatewayClientLike | undefined;
      try {
        const abortParams = {
          key: providerSessionKey,
          runId: acceptedRunId,
          agentId: invocation.agentId
        };
        let controlClient = client;
        try {
          await controlClient.request("sessions.abort", abortParams, { timeoutMs: 5_000 });
        } catch {
          recoveryClient = clientFactory(invocation.gateway);
          resolveGatewayContract(await recoveryClient.connect());
          controlClient = recoveryClient;
          await controlClient.request("sessions.abort", abortParams, { timeoutMs: 5_000 });
        }
        await waitForConfirmedTerminal(
          controlClient,
          acceptedRunId,
          "cancelled",
          Date.now() + 30_000
        );
        terminal ??= "cancelled";
      } finally {
        await recoveryClient?.close();
      }
    })();
    return cancellation;
  };
  // 桥和执行循环可能同时收到取消；共用一次 abort/对账，确认后才关闭连接。
  permissions.bindTransport(async () => {
    if (req.signal?.aborted && !terminal) {
      try {
        await confirmCancellation();
      } catch {
        // 执行源负责发出取消对账失败；清理桥不重复抛出同一错误。
      } finally {
        await stop(false);
      }
    } else await stop(!terminal);
  });
  const queue = new DriverQueue<EventQueueItem>({
    discardOnFailure: true,
    limits: context?.streamLimits,
    boundary: "openclaw.event_queue",
    onFailure: (error) => {
      if (req.signal?.aborted) return;
      resourceFailure = error;
      void stop(true);
    }
  });
  const iterator = queue[Symbol.asyncIterator]();
  let acceptedRunId = invocation.requestId;
  let agentDispatched = false;
  let agentAccepted = false;
  const seenApprovals = new Set<string>();
  const activeApprovals = new Map<string, JsonRecord>();
  let providerSessionKey = invocation.sessionKey;
  const routedApprovals = new Set<string>();
  const staleApprovals = new Set<string>();
  const acceptEvent = (event: OpenClawGatewayEvent): void => {
    if (closing || terminal) return;
    const payload = asRecord(event.payload);
    if (event.event === "agent") {
      const runId = nonEmptyString(payload?.runId);
      if (runId !== acceptedRunId && runId !== invocation.requestId) return;
    } else if (event.event === "session.message") {
      if (!agentDispatched || payload?.sessionKey !== providerSessionKey) return;
      if (payload.agentId !== undefined && payload.agentId !== invocation.agentId) return;
      const message = asRecord(payload.message);
      if (message?.role !== "assistant") return;
      const topRunId = nonEmptyString(payload.runId);
      const messageRunId = nonEmptyString(asRecord(message.__openclaw)?.runId);
      const ids = [topRunId, messageRunId].filter((id): id is string => !!id);
      // 中间消息的 runId 在原生 __openclaw 元数据内；任何显式身份冲突都拒绝。
      // 续聊不得按到达时间认领无 runId 的旧消息；fresh 的随机独占 key 没有历史消息。
      if (ids.some((id) => id !== acceptedRunId && id !== invocation.requestId)) return;
      if (!ids.length && req.providerSession?.sessionId) return;
    } else if (event.event === "exec.approval.requested") {
      const request = asRecord(payload?.request);
      const id = nonEmptyString(payload?.id);
      if (
        !id ||
        routedApprovals.has(id) ||
        staleApprovals.has(id) ||
        request?.sessionKey !== providerSessionKey
      )
        return;
      if (
        request.runId &&
        request.runId !== acceptedRunId &&
        request.runId !== invocation.requestId
      )
        return;
      if (routedApprovals.size + staleApprovals.size >= 1024) {
        queue.fail(new Error("APPROVAL_WAIT_UNAVAILABLE"));
        return;
      }
      // 派发前的无 runId 审批属于旧轮次；记住 ID，避免稍后重播时串入本轮。
      if (!request.runId && !agentDispatched) {
        staleApprovals.add(id);
        return;
      }
      // 共享旧 session 时，到达时间不能证明轮次；无 runId 则停止本轮，不回答未知归属的审批。
      if (!request.runId && req.providerSession?.sessionId) {
        queue.fail(
          new Error(
            "OPENCLAW_APPROVAL_RUN_UNVERIFIED: resumed session approval has no runId; turn ownership cannot be verified"
          )
        );
        return;
      }
      routedApprovals.add(id);
    } else if (event.event === "exec.approval.resolved") {
      const id = nonEmptyString(payload?.id);
      // A resolution can arrive before the consumer has processed its request.
      if (!id || (!routedApprovals.has(id) && !activeApprovals.has(id))) return;
    } else return;
    queue.push({ event });
  };
  const unsubscribe = client.onEvent(acceptEvent);
  const onAbort = (): void => queue.fail(new Error("OpenClaw invocation aborted"));
  req.signal?.addEventListener("abort", onAbort, { once: true });
  const state: StreamState = {
    lastSeq: -1,
    runId: invocation.requestId,
    stepNumber: 0,
    stepHasTools: false,
    assistantText: "",
    reasoningText: "",
    stepStarted: false,
    stepFinished: false,
    messageNumber: 0,
    messages: new Map(),
    tools: new Map(),
    completedMessages: new Set(),
    answers: new Map()
  };
  // 原生终态和步骤收尾共用出口；旧等待失败不能覆盖已确认的结果或丢失步骤结束。
  const terminalEvents = (outcome: GatewayTerminal, message?: string): CanonicalEvent[] => {
    const events: CanonicalEvent[] = [];
    events.push(...finishGatewayStep(state, outcome));
    const processOnly =
      state.stepHasTools || ["length", "error", "failed"].includes(state.stepFinishReason ?? "");
    const finalText =
      state.finalAnswerText ??
      (processOnly ? "" : (state.completedAnswerText ?? fallbackGatewayAnswer(state)));
    // final 通道只有这一份已选定的回答；IM 按 messageId 聚合时不会再拼进过程正文。
    // TODO(P2, #243)：成功 final 的远端文件引用由 Adapter 协调转换为可读取 HTTPS；不读本机同名路径、不代发 IM。
    if (outcome === "completed" && finalText)
      events.push({
        protocolVersion: 2,
        type: "message.update",
        payload: {
          messageId: `openclaw:${state.runId}:final-answer`,
          stepId: state.stepId,
          role: "assistant",
          status: "completed",
          text: finalText,
          channel: "final"
        }
      });
    if (outcome === "cancelled")
      events.push({
        protocolVersion: 2,
        type: "run.cancelled",
        payload: { reason: String(req.signal?.reason ?? "openclaw_aborted") }
      });
    else if (outcome === "completed")
      events.push({ protocolVersion: 2, type: "run.completed", payload: {} });
    else
      events.push({
        protocolVersion: 2,
        type: "run.failed",
        payload: {
          message: message ?? "OpenClaw Gateway agent run failed",
          adapterType: "openclaw"
        }
      });
    return events;
  };
  try {
    const hello = await client.connect();
    const contract = resolveGatewayContract(hello);
    const policy = resolveGatewayPermission(contract, req.approvalMode);
    permissions.options.effectiveApprovalMode = policy.effective;
    // 参数在真实握手之后生成；probe 的版本快照不作为本次执行依据。
    const createParams = gatewayCreateParams(
      contract,
      policy,
      invocation.createParams,
      invocation.requestId,
      invocation.agentParams.thinking
    );
    if (policy.fallbackReason)
      yield {
        protocolVersion: 2,
        type: "run.notice",
        payload: {
          noticeId: `${req.invocationId}:openclaw-permission`,
          code: "provider_diagnostic",
          severity: "warning",
          params: {
            adapter: "openclaw",
            diagnosticId: `openclaw-compat-${randomUUID()}`,
            category: "permission_fallback",
            message: `OpenClaw ${contract.version}: requested ask; using full_access for this invocation (${policy.fallbackReason}).`
          }
        }
      };
    await assertExistingAgent(client, invocation.agentId, req.signal);
    if (req.providerSession?.sessionId) {
      // describe 是实际 Gateway 广告的只读查询；缺失时不能让 patch/agent 隐式建会话。
      for (const method of ["sessions.describe", "sessions.patch"]) {
        if (!contract.methods.includes(method))
          throw new Error(`OPENCLAW_COMPATIBILITY_UNSUPPORTED: missing required method ${method}`);
      }
      const described = asRecord(
        await client.request(
          "sessions.describe",
          { key: providerSessionKey },
          { timeoutMs: 10_000, signal: req.signal }
        )
      );
      const resolved = asRecord(described?.session);
      if (!resolved)
        throw new Error("OPENCLAW_SESSION_NOT_FOUND: requested native session is unavailable");
      if (
        resolved.key !== providerSessionKey ||
        (resolved.agentId !== undefined && resolved.agentId !== invocation.agentId)
      )
        throw new Error("OPENCLAW_SESSION_AGENT_MISMATCH: resolved session does not match handle");
    } else {
      const created = asRecord(
        await client.request("sessions.create", createParams, {
          timeoutMs: 30_000,
          signal: req.signal
        })
      );
      const createdKey = nonEmptyString(created?.key);
      if (!createdKey || !createdKey.startsWith(`agent:${invocation.agentId}:`))
        throw new Error("OpenClaw Gateway returned no valid created session key");
      providerSessionKey = createdKey;
    }
    invocation.agentParams.sessionKey = providerSessionKey;
    if (contract.family === "legacy" || req.providerSession?.sessionId) {
      const permissionMode = policy.effective === "full_access" ? "full" : "guarded";
      const patched = asRecord(
        await client.request(
          "sessions.patch",
          contract.family === "legacy"
            ? gatewayLegacyPermissionParams(providerSessionKey)
            : { key: providerSessionKey, agentId: invocation.agentId, permissionMode },
          { timeoutMs: 10_000, signal: req.signal }
        )
      );
      const entry = asRecord(patched?.entry);
      if (
        patched?.ok !== true ||
        patched.key !== providerSessionKey ||
        (contract.family === "legacy"
          ? entry?.execSecurity !== "full" || entry.execAsk !== "off"
          : entry?.permissionMode !== permissionMode)
      ) {
        throw new Error("OPENCLAW_PERMISSION_UNAVAILABLE: session policy was not confirmed");
      }
    }
    await client.request(
      "sessions.messages.subscribe",
      {
        key: providerSessionKey,
        agentId: invocation.agentId
      },
      { timeoutMs: 10_000, signal: req.signal }
    );
    if (policy.effective === "ask") {
      const pending = await client.request(
        "exec.approval.list",
        {},
        { timeoutMs: 10_000, signal: req.signal }
      );
      if (!Array.isArray(pending))
        throw new Error("OpenClaw Gateway returned invalid pending approvals");
      for (const payload of pending) acceptEvent({ event: "exec.approval.requested", payload });
    }
    yield {
      protocolVersion: 2,
      type: "session.update",
      payload: {
        providerSession: {
          sessionId: providerSessionKey,
          resumable: true,
          ...(req.providerSession?.sessionId ? { resumeOutcome: "resumed" } : {}),
          agentId: invocation.agentId
        }
      }
    };

    if (req.signal?.aborted) throw new Error("OpenClaw invocation aborted before dispatch");
    agentDispatched = true;
    const request = client.request("agent", invocation.agentParams, {
      expectFinal: true,
      timeoutMs: null,
      signal: AbortSignal.any([requestAbort.signal, ...(req.signal ? [req.signal] : [])]),
      onAccepted: (value) => {
        agentAccepted = true;
        const runId = nonEmptyString(asRecord(value)?.runId);
        if (runId) acceptedRunId = runId;
      }
    });
    void request.then(
      (result) => queue.push({ done: true, result }),
      (error) => queue.push({ error: error instanceof Error ? error : new Error(String(error)) })
    );

    while (!terminal) {
      const next = await iterator.next();
      if (terminal) break;
      if (next.done) throw new Error("OpenClaw event queue closed before terminal");
      const item = next.value;
      if (item.error) throw item.error;
      if (item.done) {
        const reconciled = normalizeFinalResponse(item.result, state, acceptedRunId);
        terminal = reconciled.terminal;
        // 先保存原生终态，避免消费者在接收收尾事件时取消而覆盖真实结果。
        for (const event of reconciled.events) yield event;
        if (!terminal) {
          const confirmed = await waitForConfirmedTerminal(
            client,
            acceptedRunId,
            undefined,
            invocation.reconciliationDeadlineAt
          );
          if (resourceFailure) throw resourceFailure;
          terminal ??= confirmed;
          if (!state.stepStarted) yield* startGatewayStep(state);
          yield* finishGatewayStep(state, terminal);
        }
        if (terminal === "failed")
          throw new Error(reconciled.error ?? "OpenClaw Gateway agent run failed");
        break;
      }
      if (item.event?.event === "exec.approval.resolved") {
        const payload = asRecord(item.event.payload);
        const id = nonEmptyString(payload?.id);
        if (!id) continue;
        const params = activeApprovals.get(id);
        if (!params) continue;
        permissions.resolveFromProvider(
          params,
          payload?.decision == null ? "expired" : "resolved",
          payload?.decision === "deny"
            ? "declined"
            : ["allow-once", "allow-always"].includes(String(payload?.decision))
              ? "accepted"
              : undefined
        );
        activeApprovals.delete(id);
        continue;
      }
      if (item.event?.event === "exec.approval.requested") {
        const payload = asRecord(item.event.payload);
        const approvalRequest = asRecord(payload?.request);
        // Gateway approval events are broadcast. Only this invocation's session may be answered.
        if (approvalRequest?.sessionKey !== providerSessionKey || typeof payload?.id !== "string")
          continue;
        if (
          approvalRequest.runId &&
          approvalRequest.runId !== acceptedRunId &&
          approvalRequest.runId !== invocation.requestId
        )
          continue;
        const id = payload.id;
        if (seenApprovals.has(id)) continue;
        seenApprovals.add(id);
        if (seenApprovals.size > 1024) throw new Error("APPROVAL_WAIT_UNAVAILABLE");
        const expiresAt = finiteNumber(payload.expiresAtMs);
        if (expiresAt === undefined || expiresAt <= Date.now()) continue;
        const allowed = Array.isArray(approvalRequest.allowedDecisions)
          ? approvalRequest.allowedDecisions
          : [];
        const options = [
          ...(allowed.includes("allow-once")
            ? [{ kind: "allow_once", optionId: "allow-once" }]
            : []),
          ...(allowed.includes("allow-always")
            ? [{ kind: "allow_always", optionId: "allow-always" }]
            : []),
          ...(allowed.includes("deny") ? [{ kind: "reject_once", optionId: "deny" }] : [])
        ];
        const params = {
          toolCall: {
            toolCallId: nonEmptyString(approvalRequest.toolCallId) ?? id,
            title: nonEmptyString(approvalRequest.command) ?? "OpenClaw command"
          },
          providerDetails: {
            provider: "openclaw",
            method: "exec.approval.resolve",
            approvalId: id,
            command: approvalRequest.command,
            cwd: approvalRequest.cwd,
            reason: approvalRequest.warningText,
            description: [approvalRequest.host, approvalRequest.nodeId]
              .filter((value) => typeof value === "string" && value)
              .join(" · "),
            options
          },
          options
        };
        activeApprovals.set(id, params);
        void permissions
          .requestPermission(params, finiteNumber(payload.expiresAtMs))
          .then(async (result) => {
            if (result.providerResolved) {
              activeApprovals.delete(id);
              return;
            }
            const decision = nonEmptyString(asRecord(result.outcome)?.optionId) ?? "deny";
            await client.request(
              "exec.approval.resolve",
              { id, decision },
              { timeoutMs: 10_000, signal: req.signal }
            );
            permissions.responseWritten(params);
            activeApprovals.delete(id);
          })
          .catch((error) => {
            const failure = error instanceof Error ? error : new Error(String(error));
            permissions.responseFailed(params, failure);
            queue.push({ error: failure });
          });
        continue;
      }
      if (item.event?.event === "session.message") {
        yield* normalizeGatewaySessionMessage(item.event.payload, state);
        continue;
      }
      if (!item.event || item.event.event !== "agent") continue;
      const native = asRecord(item.event.payload);
      const runId = nonEmptyString(native?.runId);
      if (!runId || (runId !== acceptedRunId && runId !== invocation.requestId)) continue;
      const nativeTerminal = terminalState(item.event.payload);
      if (nativeTerminal) {
        const confirmed = await waitForConfirmedTerminal(
          client,
          runId,
          nativeTerminal,
          invocation.reconciliationDeadlineAt
        );
        if (resourceFailure) throw resourceFailure;
        // await 期间取消任务可能先完成；较早发出的等待不能覆盖较新的确认。
        terminal ??= confirmed;
        if (terminal !== nativeTerminal) break;
      }
      const events = normalizeGatewayAgentEvent(item.event.payload, state);
      for (const event of events) yield event;
      if (terminal === "failed") throw new Error(terminalError(item.event.payload));
    }

    if (resourceFailure) throw resourceFailure;
    if (terminal !== "completed" && terminal !== "cancelled")
      throw new Error("OpenClaw Gateway stream ended without a terminal lifecycle event");
    yield* terminalEvents(terminal);
  } catch (error) {
    let message =
      resourceFailure?.message ?? (error instanceof Error ? error.message : String(error));
    if (!resourceFailure && terminal) {
      yield* terminalEvents(terminal, message);
      return;
    }
    if (!resourceFailure && req.signal?.aborted) {
      if (!agentDispatched) {
        yield* terminalEvents("cancelled");
        return;
      }
      try {
        await confirmCancellation();
      } catch (abortError) {
        message =
          abortError instanceof Error
            ? abortError.message
            : "OpenClaw Gateway abort confirmation failed";
      }
      yield* terminalEvents(terminal ?? "failed", message);
      return;
    }
    if (!resourceFailure && agentAccepted) {
      const recoveryClient = clientFactory(invocation.gateway);
      try {
        resolveGatewayContract(await recoveryClient.connect());
        const confirmed = await waitForConfirmedTerminal(
          recoveryClient,
          acceptedRunId,
          undefined,
          invocation.reconciliationDeadlineAt
        );
        terminal ??= confirmed;
        message = `OpenClaw Gateway confirmed a failed run after disconnect: ${message}`;
      } catch (recoveryError) {
        const detail =
          recoveryError instanceof Error ? recoveryError.message : "unknown reconciliation failure";
        message = `${message}; reconnect reconciliation failed: ${detail}`;
      } finally {
        await recoveryClient.close();
      }
    }
    yield* terminalEvents(
      resourceFailure ? "failed" : (terminal ?? "failed"),
      resourceFailure?.message ?? message
    );
  } finally {
    req.signal?.removeEventListener("abort", onAbort);
    queue.close();
    queue.drain();
    routedApprovals.clear();
    activeApprovals.clear();
    await stop(!terminal);
  }
}

export function createOpenClawAdapter({
  clientFactory = (options) => new OpenClawGatewayClient(options)
}: { clientFactory?: GatewayClientFactory } = {}) {
  const responders = new Map<string, AcpApprovalBridge>();
  const probeGateway = async (options?: AdapterProbeOptions) => {
    let client: OpenClawGatewayClientLike | undefined;
    try {
      client = clientFactory(await resolveOpenClawGateway(options?.providerOptions));
      resolveGatewayContract(await client.connect());
      await client.request("agents.list", {});
      return { available: true, command: "openclaw-gateway" };
    } catch (error) {
      return { available: false, command: "openclaw-gateway", reason: localGatewayFailure(error) };
    } finally {
      await client?.close();
    }
  };
  return defineAdapter({
    metadata: {
      type: "openclaw",
      workspace: false,
      processModel: "websocket-per-invocation",
      transport: "openclaw-gateway-rpc",
      agentSources: ["preset", "provisioned"]
    },
    probe: probeGateway,
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
        throw new Error("UNSUPPORTED_INPUT_MODALITY: openclaw does not encode image input");
      if (req.approvalMode === "assisted")
        throw new Error("APPROVAL_MODE_UNSUPPORTED: OpenClaw has no qualified assisted policy");
      if (responders.has(req.invocationId)) throw new Error("INVOCATION_ALREADY_ACTIVE");
      const gateway = await resolveOpenClawGateway(req.agentConfig.providerOptions);
      req = {
        ...req,
        agentConfig: {
          ...req.agentConfig,
          providerOptions: {
            ...req.agentConfig.providerOptions,
            [OPENCLAW_PROVIDER_OPTIONS.url]: gateway.url,
            [OPENCLAW_PROVIDER_OPTIONS.token]: gateway.token,
            [OPENCLAW_PROVIDER_OPTIONS.deviceId]: gateway.device.deviceId,
            [OPENCLAW_PROVIDER_OPTIONS.publicKey]: gateway.device.publicKey,
            [OPENCLAW_PROVIDER_OPTIONS.privateKey]: gateway.device.privateKey
          }
        }
      };
      const invocation = buildOpenClawGatewayInvocation(req);
      const bridge = new AcpApprovalBridge(req, 600_000, {
        providerDecisions: true,
        providerManagedExpiry: true
      });
      responders.set(req.invocationId, bridge);
      try {
        yield* bridge.stream(
          invokeOpenClawGateway(req, invocation, context, clientFactory, bridge)
        );
      } finally {
        bridge.close("execution_lost");
        responders.delete(req.invocationId);
      }
    }
  });
}

async function assertExistingAgent(
  client: OpenClawGatewayClientLike,
  agentId: string,
  signal?: AbortSignal
): Promise<void> {
  const result = asRecord(await client.request("agents.list", {}, { timeoutMs: 1_000, signal }));
  const agents = Array.isArray(result?.agents) ? result.agents : [];
  if (!agents.some((agent) => asRecord(agent)?.id === agentId))
    throw new Error(`OpenClaw agent ${agentId} is missing`);
}

export {
  loadLocalOpenClawGateway,
  configureOpenClawConnection,
  readOpenClawConnection,
  LocalGatewayError,
  normalizeOpenClawGatewayUrl,
  resolveOpenClawGateway,
  OPENCLAW_RUNTIME_ROOT,
  type OpenClawConnectionInput,
  type OpenClawConnection
} from "./local-gateway.js";

export {
  OpenClawGatewayClient,
  createOpenClawDeviceIdentity,
  type OpenClawDeviceIdentity,
  type OpenClawGatewayEvent,
  type OpenClawGatewayOptions
} from "./gateway.js";
export {
  OpenClawTranscriptNormalizer,
  normalizeOpenClawFrame,
  tryParseOpenClawEvent,
  tryParseOpenClawFinalBlob,
  tryParseOpenClawTranscriptLine
} from "./parser.js";

export const openclawAdapter = createOpenClawAdapter();
export default openclawAdapter;
