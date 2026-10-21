import type { ContextEnvelope, InvokeRequest } from "@mininglamp-oss/octo-runtime-protocol";

const MODEL_CONTEXT_PATTERNS = [/^extra\.[^/]+\/[^/]+$/, /^octo\.content\/(inline|references)$/];

/** 仅渲染允许进入模型的业务 Context；固定格式使用英文，业务内容保留原文，对象键排序使同一快照稳定。 */
export function renderModelContexts(context: ContextEnvelope): string {
  const items = context.items.filter((item) =>
    MODEL_CONTEXT_PATTERNS.some((pattern) => pattern.test(item.namespace + "/" + item.name))
  );
  if (!items.length) return "";
  return [
    "<--- Context information begins: the following is the current context --->",
    "<contexts>",
    ...items.map((item) =>
      [
        `  <context-item namespace="${item.namespace}" name="${item.name}">`,
        ...(item.guidance ? [`    Guidance: ${item.guidance}`] : []),
        `    Data: ${JSON.stringify(sorted(item.payload))}`,
        "  </context-item>"
      ].join("\n")
    ),
    "</contexts>",
    "<--- Context information ends --->"
  ].join("\n");
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, child]) => [key, sorted(child)])
    );
  return value;
}

/**
 * Core 冻结原请求后、派发 Adapter 前调用一次；接入方不应预先渲染而造成 Context 重复。
 * 正常输入与 fresh fallback 同步添加上下文，保证恢复路径没有额外丢失本轮业务快照。
 */
export function withModelContexts(request: InvokeRequest): InvokeRequest {
  const rendered = renderModelContexts(request.context);
  if (!rendered) return request;
  return {
    ...request,
    modelInput: [rendered, request.modelInput].filter(Boolean).join("\n\n"),
    ...(request.modelInputParts
      ? { modelInputParts: [{ type: "text" as const, text: rendered }, ...request.modelInputParts] }
      : {}),
    ...(request.freshFallbackModelInput
      ? { freshFallbackModelInput: [rendered, request.freshFallbackModelInput].join("\n\n") }
      : {}),
    ...(request.freshFallbackModelInputParts
      ? {
          freshFallbackModelInputParts: [
            { type: "text" as const, text: rendered },
            ...request.freshFallbackModelInputParts
          ]
        }
      : {})
  };
}
