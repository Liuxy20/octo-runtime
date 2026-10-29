import type { ContextItem } from "@mininglamp-oss/octo-runtime-protocol";

/** 只转换渠道自动项；范围、游标及交接证据留在原始材料，不进入模型或冻结重试。 */
export function modelHistoryContexts(items: ContextItem[]): ContextItem[] {
  const automatic = (item: ContextItem, name: string) =>
    item.namespace === "extra.im" && item.name === name && item.payload.automatic === true;
  const gap = items.find((item) => automatic(item, "history-gap"));
  const note =
    gap?.payload.status === "unavailable"
      ? "Earlier messages could not be retrieved."
      : gap?.payload.status === "omitted"
        ? "Earlier messages are not included."
        : gap?.payload.status === "partial" || gap?.payload.earlierOmitted === true
          ? "Some earlier messages are not included."
          : undefined;
  const history = (messages: unknown): ContextItem => ({
    namespace: "extra.im",
    name: "history",
    guidance:
      "Earlier messages, oldest first; sentAt=system-zone time, content.type=body type; null=unknown, read=false=unread, truncated=true=shortened.",
    payload: { messages, ...(note ? { note } : {}) }
  });
  // 读取失败时也可用空消息列表说明事实；显式宿主 history 保持原值，不追加同 key 自动项。
  const hasHistory = items.some((item) => item.namespace === "extra.im" && item.name === "history");
  return items.flatMap((item) => {
    if (automatic(item, "history")) return [history(item.payload.messages)];
    if (automatic(item, "history-gap")) return note && !hasHistory ? [history([])] : [];
    return [item];
  });
}
