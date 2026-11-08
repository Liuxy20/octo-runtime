import { randomUUID } from "node:crypto";
import { localRuntimeLimits, resolveLocalContext } from "./context.js";
import {
  CONTEXT_SCHEMA,
  DEFAULT_RUN_TIMEOUT_MS,
  assertAgentSource,
  assertContextEnvelope,
  assertInvokeRequest,
  contextControlInstructions,
  contextItem,
  InvokeInput,
  type ContextEnvelope,
  type InvokeRequest,
  type ProviderSession
} from "@mininglamp-oss/octo-runtime-protocol";

/** CLI shorthand resolves execution defaults before entering the strict Context contract. */
function inputContext(value: unknown): ContextEnvelope {
  if (isRecord(value) && Array.isArray(value.items)) {
    value = {
      ...value,
      items: value.items.map((item: unknown) => {
        if (
          isRecord(item) &&
          item.namespace === "octo.execution" &&
          item.name === "adapter" &&
          isRecord(item.payload) &&
          item.payload.type === "openclaw" &&
          !Object.hasOwn(item.payload, "provider_agent_id")
        ) {
          return { ...item, payload: { ...item.payload, provider_agent_id: "main" } };
        }
        return item;
      })
    };
  }
  const envelope = {
    schema: (value as ContextEnvelope).schema,
    items: (value as ContextEnvelope).items
  };
  assertContextEnvelope(envelope);
  return envelope;
}

/**
 * 将调用方本轮 JSON 快照解析为执行计划与内部请求，不读取持久会话或创建 Provider。
 * sessionId 只标识业务会话；续接必须显式携带 providerSession，不能由同名会话推断。
 * 仅解析执行设置；inputs 由业务方准备，原样进入 Adapter。
 */
export function prepareInvokeInput(value: unknown): {
  adapterType: string;
  protocolMode: "native" | "canonical";
  request: InvokeRequest;
} {
  if (!isRecord(value)) throw new TypeError("invoke input must be a JSON object");
  const input = InvokeInput.check({
    ...value,
    agentEnv: { ...(value.agentEnv as object), ...inputContext(value.agentEnv) }
  });
  const contexts = inputContext(value.agentEnv);
  const env = input.agentEnv;
  const protocolMode = value.protocol_mode ?? "native";
  if (protocolMode !== "native" && protocolMode !== "canonical") {
    throw new TypeError("protocol_mode must be native or canonical");
  }
  const adapterType = contextItem(contexts, "octo.execution", "adapter")?.payload.type;
  const agentSource = env.agentSource ?? (adapterType === "openclaw" ? "preset" : "provisioned");
  assertAgentSource(agentSource);
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

  const defaults: ContextEnvelope = {
    schema: CONTEXT_SCHEMA,
    items: [
      { namespace: "octo.execution", name: "adapter", payload: { type: "codex" } },
      ...(agentSource === "provisioned"
        ? [
            {
              namespace: "octo.execution",
              name: "workspace",
              payload: { mode: "fixed", path: env.workdir ?? process.cwd() }
            }
          ]
        : []),
      {
        namespace: "octo.security",
        name: "approval_policy",
        payload: { mode: env.approvalMode ?? "ask" }
      },
      {
        namespace: "octo.execution",
        name: "limits",
        payload: { run_timeout_ms: DEFAULT_RUN_TIMEOUT_MS }
      }
    ]
  };
  // 解析固定执行配置；没有业务 Context 渲染阶段。
  const { resolvedExecutionPlan: plan } = resolveLocalContext(
    defaults,
    {
      schema: CONTEXT_SCHEMA,
      items: contexts.items.filter(
        (item) =>
          item.namespace === "octo.execution" ||
          (item.namespace === "octo.security" && item.name === "approval_policy")
      )
    },
    agentSource
  );
  const context = structuredClone(contexts);
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
    agentSource,
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
    modelInputParts: structuredClone(input.inputs),
    context,
    controlInstructions: env.controlInstructions ?? contextControlInstructions(context),
    workdir: env.workdir ?? plan.workdir,
    approvalMode: env.approvalMode ?? plan.approval_mode,
    runtimeLimits: env.runtimeLimits ?? localRuntimeLimits(plan),
    agentConfig: {
      workdir: plan.workdir,
      ...(plan.model ? { model: plan.model } : {}),
      ...(plan.effort ? { effort: plan.effort } : {}),
      ...(plan.provider_agent_id ? { providerAgentId: plan.provider_agent_id } : {}),
      ...env.agentConfig
    }
  };
  assertInvokeRequest(request);
  return { adapterType: plan.adapter_type, protocolMode, request };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
