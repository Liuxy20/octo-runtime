import { randomUUID } from "node:crypto";
import {
  assertInvokeRequest,
  contextItem,
  InvokeInput,
  type InvokeRequest,
  type ProviderSession
} from "@mininglamp-oss/octo-runtime-protocol";

/**
 * 将调用方本轮 JSON 快照包装为内部请求，不读取持久会话或创建 Provider。
 * sessionId 只标识业务会话；续接必须显式携带 providerSession，不能由同名会话推断。
 * 仅读取 Adapter 路由；agentEnv 与业务方准备的 inputs 保序交给 Adapter。
 */
export function prepareInvokeInput(value: unknown): {
  adapterType: string;
  protocolMode: "native" | "canonical";
  request: InvokeRequest;
} {
  if (!isRecord(value)) throw new TypeError("invoke input must be a JSON object");
  const input = InvokeInput.check(value);
  const protocolMode = value.protocol_mode ?? "native";
  if (protocolMode !== "native" && protocolMode !== "canonical") {
    throw new TypeError("protocol_mode must be native or canonical");
  }
  const adapterType =
    contextItem(input.agentEnv, "octo.execution", "adapter")?.payload.type ?? "codex";
  if (typeof adapterType !== "string" || !adapterType) throw new TypeError("ADAPTER_TYPE_INVALID");
  if (
    value.sessionId !== undefined &&
    (typeof value.sessionId !== "string" || !value.sessionId.trim())
  ) {
    throw new TypeError("sessionId must be a non-empty string");
  }
  const continuityMode = value.continuityMode ?? (value.providerSession ? "continue" : "fresh");
  if (continuityMode !== "fresh" && continuityMode !== "continue") {
    throw new TypeError("continuityMode must be fresh or continue");
  }
  let providerSession: ProviderSession | undefined;
  if (value.providerSession !== undefined) {
    if (
      !isRecord(value.providerSession) ||
      typeof value.providerSession.sessionId !== "string" ||
      !value.providerSession.sessionId.trim()
    ) {
      throw new TypeError("providerSession.sessionId must be a non-empty string");
    }
    if (
      value.providerSession.resumable !== undefined &&
      typeof value.providerSession.resumable !== "boolean"
    ) {
      throw new TypeError("providerSession.resumable must be a boolean");
    }
    if (
      value.providerSession.requireResume !== undefined &&
      typeof value.providerSession.requireResume !== "boolean"
    )
      throw new TypeError("providerSession.requireResume must be a boolean");
    providerSession = structuredClone(value.providerSession) as ProviderSession;
  }
  if (continuityMode === "fresh" && providerSession)
    throw new TypeError("fresh execution cannot carry providerSession");
  if (continuityMode === "continue" && !providerSession)
    throw new TypeError(
      "continue requires providerSession; sessionId alone cannot resume a provider"
    );

  const prompt = input.inputs
    .map((part) => (part.type === "text" ? part.text : "[Image]"))
    .join("\n\n");
  if (!prompt.trim()) throw new TypeError("inputs must contain non-empty text or an image");
  const request: InvokeRequest = {
    protocolVersion: 2,
    invocationId: input.invocationId ?? `invoke_${randomUUID()}`,
    runId: input.runId ?? `run_${randomUUID()}`,
    agentSessionId: value.sessionId ?? `session_${randomUUID()}`,
    // 名称默认值只在此归一化；Host SDK/Adapter 不猜业务策略或据此决定恢复。
    sessionName: input.sessionName ?? randomUUID(),
    continuityMode,
    ...(providerSession ? { providerSession } : {}),
    ...(input.sessionGeneration !== undefined
      ? { sessionGeneration: input.sessionGeneration }
      : {}),
    ...(input.providerEpoch !== undefined ? { providerEpoch: input.providerEpoch } : {}),
    ...(input.runMetadata ? { runMetadata: structuredClone(input.runMetadata) } : {}),
    ...(input.freshFallbackModelInput !== undefined
      ? { freshFallbackModelInput: input.freshFallbackModelInput }
      : {}),
    ...(input.freshFallbackModelInputParts
      ? { freshFallbackModelInputParts: structuredClone(input.freshFallbackModelInputParts) }
      : {}),
    ...(input.freshFallbackImagesUnavailable !== undefined
      ? { freshFallbackImagesUnavailable: input.freshFallbackImagesUnavailable }
      : {}),
    prompt: input.prompt ?? prompt,
    modelInput: input.modelInput ?? prompt,
    // 高级调用显式选择的纯文本作为普通内容提交；有图片时始终保留完整有序 parts。
    modelInputParts:
      input.modelInput !== undefined && input.inputs.every((part) => part.type === "text")
        ? [{ type: "text", text: input.modelInput }]
        : structuredClone(input.inputs),
    agentEnv: structuredClone(input.agentEnv)
  };
  assertInvokeRequest(request);
  return { adapterType, protocolMode, request };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
