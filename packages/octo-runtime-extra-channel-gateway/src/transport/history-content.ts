import type { MessageIdentity } from "./message-identities.js";
import { messageSentAt } from "./message-time.js";

type Data = Record<string, unknown>;
export const historyObject = (value: unknown): Data =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Data) : {};
const field = (value: unknown, limit = 256): string | null =>
  typeof value === "string" && value.length <= limit ? value : null;
export const supportedHistoryType = (type: unknown): boolean =>
  typeof type === "number" && [1, 2, 8, 11, 14, 18].includes(type);

/** 只收集有限层级的真实来源 UID；转发自报姓名不参与可信身份映射。 */
export function historySenderUids(payloads: unknown[]): string[] {
  const result = new Set<string>();
  let nodes = 0;
  const visit = (raw: unknown, depth: number): void => {
    if (depth >= 4 || ++nodes > 128) return;
    const value = historyObject(raw);
    const quote = historyObject(value.reply);
    if (typeof quote.from_uid === "string") result.add(quote.from_uid);
    if (quote.payload) visit(quote.payload, depth + 1);
    if (value.type === 11 && Array.isArray(value.msgs))
      for (const rawMessage of value.msgs.slice(0, 128)) {
        if (nodes >= 128) break;
        const message = historyObject(rawMessage);
        if (typeof message.from_uid === "string") result.add(message.from_uid);
        visit(message.payload, depth + 1);
      }
  };
  for (const value of payloads) visit(value, 0);
  return [...result];
}

/** 历史只携带已返回的内容结构和资源地址，不下载、解引用或把嵌套材料当新任务。 */
export function historyContent(
  raw: unknown,
  identities: ReadonlyMap<string, MessageIdentity>
): { content: Data; truncated: boolean } {
  let nodes = 0,
    remaining = 12000,
    truncated = false;
  const text = (value: unknown): string => {
    if (typeof value !== "string") return "";
    const points = Array.from(value);
    if (points.length > remaining) truncated = true;
    const result = points.slice(0, remaining).join("");
    remaining -= Math.min(points.length, remaining);
    return result;
  };
  const speaker = (value: Data): Data => {
    const uid = field(value.from_uid, 64);
    return {
      uid,
      username: uid ? (identities.get(uid)?.name ?? null) : null,
      sentAt: messageSentAt(value.timestamp, "seconds")
    };
  };
  const visit = (value: unknown, depth: number): Data => {
    if (depth >= 4 || ++nodes > 128) {
      truncated = true;
      return { type: "omitted", reason: "nesting-limit" };
    }
    const payload = historyObject(value);
    let body: Data;
    if (payload.type === 1) body = { type: "text", text: text(payload.content) };
    else if (payload.type === 2)
      body = { type: "image", url: field(payload.url, 8192), read: false };
    else if (payload.type === 8)
      body = {
        type: "file",
        name: field(payload.name),
        url: field(payload.url, 8192),
        read: false
      };
    else if (payload.type === 18)
      body = {
        type: "document",
        id: field(payload.doc_id),
        name: field(payload.title),
        url: field(payload.url, 8192),
        read: false
      };
    else if (payload.type === 11) {
      const messages: Data[] = [];
      if (Array.isArray(payload.msgs))
        for (const entry of payload.msgs.slice(0, 128)) {
          if (nodes >= 128) {
            truncated = true;
            break;
          }
          const message = historyObject(entry);
          messages.push({ ...speaker(message), content: visit(message.payload, depth + 1) });
        }
      if (Array.isArray(payload.msgs) && payload.msgs.length > 128) truncated = true;
      body = { type: "forward", messages };
    } else if (payload.type === 14) {
      if (Array.isArray(payload.content)) {
        const blocks: Data[] = [];
        for (const block of payload.content.slice(0, 128)) {
          if (++nodes > 128) {
            truncated = true;
            break;
          }
          const data = historyObject(block);
          if (data.type === "text") blocks.push({ type: "text", text: text(data.text) });
          else if (data.type === "image")
            blocks.push({ type: "image", url: field(data.url, 8192), read: false });
          else blocks.push({ type: "unsupported" });
        }
        if (payload.content.length > 128) truncated = true;
        body = { type: "rich-text", blocks };
      } else
        body = {
          type: "text",
          text: text(typeof payload.plain === "string" ? payload.plain : payload.content)
        };
    } else body = { type: "unsupported" };
    const quote = historyObject(payload.reply);
    if (Object.keys(quote).length)
      body = {
        type: "reply",
        quote: { ...speaker(quote), content: visit(quote.payload, depth + 1) },
        content: body
      };
    return body;
  };
  const content = visit(raw, 0);
  return { content, truncated };
}
