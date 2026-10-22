import type { ContextEnvelope, InvokeRequest } from "@mininglamp-oss/octo-runtime-protocol";

const MODEL_CONTEXT_PATTERNS = [/^extra\.[^/]+\/[^/]+$/, /^octo\.content\/(inline|references)$/];

/** 仅渲染允许进入模型的本轮业务 Context；Markdown 指引保留原文，排序后的 payload 用 CDATA 包裹，不修改输入。 */
export function renderModelContexts(context: ContextEnvelope): string {
  const items = context.items.filter((item) =>
    MODEL_CONTEXT_PATTERNS.some((pattern) => pattern.test(item.namespace + "/" + item.name))
  );
  if (!items.length) return "";
  return [
    "<!-- Context information begins: the following is the current context -->",
    "<contexts>",
    ...items.map((item) => {
      // 拆分 CDATA 终止符为相邻区段，避免材料中的标记提前结束数据边界；不解析内部内容。
      const data = JSON.stringify(sorted(item.payload)).replaceAll("]]>", "]]]]><![CDATA[>");
      return [
        `  <context-item namespace="${item.namespace}" name="${item.name}">`,
        ...(item.guidance ? [`    <guidence>${item.guidance}</guidence>`] : []),
        `    <data><![CDATA[${data}]]></data>`,
        "  </context-item>"
      ].join("\n");
    }),
    "</contexts>",
    "<!-- Context information ends -->"
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
