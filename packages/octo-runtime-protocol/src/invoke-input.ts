import {
  assertContextEnvelope,
  assertModelInputParts,
  type CanonicalEvent,
  type ContextEnvelope,
  type ContextEnvsPayload,
  type HostFrame,
  type InvokeRequest,
  type ModelInputPart,
  type ProviderSession
} from "./index.js";
import { assertJsonValue } from "./context.js";
import { canonicalEvents } from "./run-protocol.js";
import { assertJsonByteLimit } from "./json-size.js";
import { INVOKE_REQUEST_MAX_BYTES } from "./invoke-size.js";
import type { StreamLimitPolicy } from "./stream-limits.js";

/**
 * Public JSON invocation contract shared by CLI, SDK and channels.
 * A plain JSON object satisfies this class structurally; `new` is not required.
 * Only inputs and agentEnv are required. Defaults are resolved by the execution
 * boundary, never by adding historical business context.
 */
export class InvokeInput {
  /** Exact current-turn text/image parts, in caller order. Image bytes occur here once. */
  declare inputs: ModelInputPart[];
  /** Execution-only Context v3 snapshot; an empty items array is valid. */
  declare agentEnv: AgentEnv;
  /** Business session identity; generated if omitted. Does not imply provider resume. */
  declare sessionId?: string;
  /** 调用方拥有的展示名称；省略时由 Core 提供 UUID，不参与会话恢复。 */
  declare sessionName?: string;
  /** Output view of the same execution stream; defaults to native. */
  declare protocol_mode?: "native" | "canonical";
  /** Cancellation identity for this invocation; generated if omitted. */
  declare invocationId?: string;
  /** Business Run identity; generated if omitted. Independent of invocation/session IDs. */
  declare runId?: string;
  /** Caller-owned session generation, used to fence stale updates; no inferred default. */
  declare sessionGeneration?: number;
  /** Caller-owned provider binding epoch; no inferred default. */
  declare providerEpoch?: number;
  /** Display-safe description; defaults to the textual summary of inputs. */
  declare prompt?: string;
  /** 显式值替换纯文本 inputs 的 Provider 正文；有图片时保留原有有序 parts。 */
  declare modelInput?: string;
  /** JSON metadata for tracing/business identity; not model text or authorization evidence. */
  declare runMetadata?: Record<string, unknown>;
  /** Opaque provider session, including provider extension fields; never rebuilt from sessionId. */
  declare providerSession?: ProviderSession;
  /** Fresh/continue intent; defaults to continue with providerSession, fresh otherwise. */
  declare continuityMode?: "fresh" | "continue";
  /** 调用方完整恢复文本；无显式恢复 parts 时优先于主输入，不自动补历史。 */
  declare freshFallbackModelInput?: string;
  /** 显式恢复 parts 优先于恢复文本和主输入；须保留当前图片及其顺序。 */
  declare freshFallbackModelInputParts?: ModelInputPart[];
  /** Explicitly fail fresh fallback when historical image bytes cannot be supplied. */
  declare freshFallbackImagesUnavailable?: boolean;

  /** Checks the JSON boundary; resolved execution additionally uses assertInvokeRequest. */
  static check(value: unknown): InvokeInput {
    assertInvokeInput(value);
    return value;
  }
}

/** 可复用执行配置；信封格式保持 v3，业务材料必须由调用方放入 inputs。 */
export type AgentEnv = ContextEnvelope;

/** 高级调用的内容与追踪信息；不包含执行环境、会话参数或本地 signal。 */
export type InvocationContent = Omit<
  InvokeInput,
  "inputs" | "agentEnv" | "sessionId" | "providerSession"
> & {
  parts: ModelInputPart[];
};
export type InvocationInputs = ModelInputPart[] | InvocationContent;

/** Local ingress execution settings, outside caller-owned JSON and Context. */
export interface InvokeEnvironment {
  signal?: AbortSignal;
  /** 宿主连接配置独立于调用方信封，仅由目标 Adapter 消费。 */
  providerOptions?: Record<string, string>;
  /** Trusted per-invocation values; forwarded privately across the Host process boundary. */
  executionEnvOverrides?: ContextEnvsPayload;
  /** Trusted transport and replay budgets; never sourced from caller Context. */
  streamLimits?: StreamLimitPolicy;
}

export type InputFrames = (
  input: InvokeInput,
  environment?: InvokeEnvironment
) => AsyncGenerator<HostFrame>;

/** Stable correlation IDs for cancellation and stream reconnection, without resolving execution. */
export function identifyInvokeInput(input: InvokeInput) {
  return {
    ...input,
    invocationId: input.invocationId ?? globalThis.crypto.randomUUID(),
    runId: input.runId ?? globalThis.crypto.randomUUID(),
    sessionId: input.sessionId ?? globalThis.crypto.randomUUID()
  };
}

/** Select a view of one source stream; execution preparation belongs to the Host. */
export function createInputInvoke(source: InputFrames): InputInvoke {
  return async function* (input: InvokeInput, environment?: InvokeEnvironment) {
    environment?.signal?.throwIfAborted();
    const frames = source(input, environment);
    if (input.protocol_mode === "canonical") yield* canonicalEvents(frames);
    else yield* frames;
    // Only normal exhaustion reports local abort; never replace a source error or iterator return.
    environment?.signal?.throwIfAborted();
  } as InputInvoke;
}
export interface InputInvoke {
  (
    input: InvokeInput & { protocol_mode: "canonical" },
    environment?: InvokeEnvironment
  ): AsyncGenerator<CanonicalEvent>;
  (
    input: InvokeInput & { protocol_mode?: "native" },
    environment?: InvokeEnvironment
  ): AsyncGenerator<HostFrame>;
  (input: InvokeInput, environment?: InvokeEnvironment): AsyncGenerator<CanonicalEvent | HostFrame>;
}

export function assertInvokeInput(value: unknown): asserts value is InvokeInput {
  if (
    value &&
    typeof value === "object" &&
    ("controlInstructions" in value ||
      ("agentEnv" in value &&
        value.agentEnv &&
        typeof value.agentEnv === "object" &&
        "controlInstructions" in value.agentEnv))
  )
    throw new TypeError(
      "CONTROL_INSTRUCTIONS_REMOVED: controlInstructions was removed; provide application prompts in inputs.parts"
    );
  assertJsonByteLimit(
    value instanceof InvokeInput ? { ...value } : value,
    INVOKE_REQUEST_MAX_BYTES,
    "INVOKE_REQUEST_TOO_LARGE"
  );
  assertJsonValue(value);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("InvokeInput must be a JSON object");
  const input = value as Record<string, unknown>;
  const allowed = new Set([
    "inputs",
    "agentEnv",
    "sessionId",
    "sessionName",
    "protocol_mode",
    "invocationId",
    "runId",
    "sessionGeneration",
    "providerEpoch",
    "prompt",
    "modelInput",
    "runMetadata",
    "providerSession",
    "continuityMode",
    "freshFallbackModelInput",
    "freshFallbackModelInputParts",
    "freshFallbackImagesUnavailable"
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key)))
    throw new TypeError(
      "InvokeInput contains an unknown field; use AgentEnv items for execution settings"
    );
  if (
    [
      "protocolMode",
      "adapterType",
      "request",
      "options",
      "contexts",
      "agentSource",
      "workdir",
      "approvalMode",
      "runtimeLimits"
    ].some((key) => Object.hasOwn(input, key))
  )
    throw new TypeError(
      "InvokeInput requires the unified JSON contract, not a prepared request wrapper"
    );
  if (Object.hasOwn(input, "signal"))
    throw new TypeError("signal belongs to the local invoke environment");
  if (Object.hasOwn(input, "executionEnvOverrides"))
    throw new TypeError("executionEnvOverrides belongs to the local invoke environment");
  assertModelInputParts(input.inputs);
  assertAgentEnv(input.agentEnv);
  if (input.sessionName !== undefined) assertSessionName(input.sessionName);
  for (const key of [
    "sessionId",
    "invocationId",
    "runId",
    "prompt",
    "modelInput",
    "freshFallbackModelInput"
  ])
    if (input[key] !== undefined && (typeof input[key] !== "string" || !input[key]))
      throw new TypeError(`InvokeInput.${key} must be a non-empty string`);
  for (const key of ["sessionGeneration", "providerEpoch"])
    if (
      input[key] !== undefined &&
      (!Number.isSafeInteger(input[key]) || (input[key] as number) < 0)
    )
      throw new TypeError(`InvokeInput.${key} must be a non-negative safe integer`);
  if (
    input.protocol_mode !== undefined &&
    !["native", "canonical"].includes(input.protocol_mode as string)
  )
    throw new TypeError("protocol_mode must be native or canonical");
  if (
    input.continuityMode !== undefined &&
    !["fresh", "continue"].includes(input.continuityMode as string)
  )
    throw new TypeError("continuityMode must be fresh or continue");
  if (input.freshFallbackModelInputParts !== undefined)
    assertModelInputParts(input.freshFallbackModelInputParts);
  if (
    input.freshFallbackImagesUnavailable !== undefined &&
    typeof input.freshFallbackImagesUnavailable !== "boolean"
  )
    throw new TypeError("freshFallbackImagesUnavailable must be a boolean");
  for (const key of ["runMetadata", "providerSession"])
    if (
      input[key] !== undefined &&
      (!input[key] || typeof input[key] !== "object" || Array.isArray(input[key]))
    )
      throw new TypeError(`InvokeInput.${key} must be a JSON object`);
  if (input.providerSession) {
    const session = input.providerSession as Record<string, unknown>;
    if (typeof session.sessionId !== "string" || !session.sessionId.trim())
      throw new TypeError("providerSession.sessionId must be a non-empty string");
    if (session.resumable !== undefined && typeof session.resumable !== "boolean")
      throw new TypeError("providerSession.resumable must be a boolean");
    if (session.requireResume !== undefined && typeof session.requireResume !== "boolean")
      throw new TypeError("providerSession.requireResume must be a boolean");
    if (
      session.resumeOutcome !== undefined &&
      !["new", "resumed", "fresh_fallback", "compacted"].includes(session.resumeOutcome as string)
    )
      throw new TypeError("providerSession.resumeOutcome is invalid");
    if (session.resumeFallback !== undefined && typeof session.resumeFallback !== "string")
      throw new TypeError("providerSession.resumeFallback must be a string");
    if (
      session.contextInputVariant !== undefined &&
      !["primary", "recovery"].includes(session.contextInputVariant as string)
    )
      throw new TypeError("providerSession.contextInputVariant is invalid");
  }
}

/** 校验可读名称，不解析业务身份；同一约束用于公开输入与内部 Adapter wire。 */
export function assertSessionName(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 512 ||
    [...value].length > 256 ||
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || (code >= 127 && code <= 159);
    })
  )
    throw new TypeError(
      "sessionName must contain 1-256 characters, not only whitespace, without control characters"
    );
}

/** Lossless field reorganization of a validated prepared execution, excluding its local signal. */
export function invocationInput(
  request: InvokeRequest,
  protocol_mode: "native" | "canonical" = "native",
  adapterType?: string
): InvokeInput {
  const {
    protocolVersion: _version,
    signal: _signal,
    executionEnvOverrides: _executionEnvOverrides,
    agentSessionId,
    agentEnv,
    modelInputParts,
    ...fields
  } = request;
  void _version;
  void _signal;
  void _executionEnvOverrides;
  const contexts = structuredClone(agentEnv);
  if (adapterType) {
    const adapter = contexts.items.find(
      (item) => item.namespace === "octo.execution" && item.name === "adapter"
    );
    if (adapter && adapter.payload.type !== adapterType)
      throw new TypeError("CONTEXT_PLAN_MISMATCH");
    if (!adapter)
      contexts.items.push({
        namespace: "octo.execution",
        name: "adapter",
        payload: { type: adapterType }
      });
  }
  return InvokeInput.check({
    ...fields,
    sessionId: agentSessionId,
    agentEnv: contexts,
    protocol_mode,
    inputs: modelInputParts ?? [{ type: "text", text: request.modelInput }]
  });
}

/** 公共层只校验信封；共性与私有 payload 由消费它的 Adapter 校验。 */
export function assertAgentEnv(value: unknown): asserts value is AgentEnv {
  if (value && typeof value === "object" && "controlInstructions" in value)
    throw new TypeError(
      "CONTROL_INSTRUCTIONS_REMOVED: controlInstructions was removed; provide application prompts in inputs.parts"
    );
  assertContextEnvelope(value);
}
