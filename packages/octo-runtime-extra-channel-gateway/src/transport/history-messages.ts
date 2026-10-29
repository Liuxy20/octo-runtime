import type { MessageIdentity } from "./message-identities.js";
import { historyContent, historyObject, supportedHistoryType } from "./history-content.js";
import { messageSentAt } from "./message-time.js";
import { IM_HISTORY_MESSAGE_LIMIT } from "../application/context-gap.js";

export interface HistoryMessage {
  uid: string;
  username: string | null;
  sentAt: string | null;
  content: Record<string, unknown>;
  truncated?: true;
}

/** 输入按新到旧；输出按旧到新，8000 码点预算包含 JSON，截断只影响正文。 */
export function historyMessages(
  entries: Array<{
    from_uid: string;
    content: string;
    timestamp?: number | null;
    type?: number;
    payload?: unknown;
    message_seq?: number;
  }>,
  identities: ReadonlyMap<string, MessageIdentity> = new Map(),
  excludedSeqs: readonly number[] = []
): { messages: HistoryMessage[]; truncated: boolean; recoveryMessages?: HistoryMessage[] } {
  const messages: HistoryMessage[] = [];
  const excluded = new Set<HistoryMessage>();
  const size = (value: HistoryMessage[]): number => Array.from(JSON.stringify(value)).length;
  let truncated = false;
  for (const entry of entries.slice(0, IM_HISTORY_MESSAGE_LIMIT)) {
    // 先对完整窗口执行原预算；恢复与主历史只是同一材料的互不重叠分区。
    const prepend = (record: HistoryMessage) => {
      messages.unshift(record);
      if (entry.message_seq !== undefined && excludedSeqs.includes(entry.message_seq))
        excluded.add(record);
    };
    if (!supportedHistoryType(entry.type)) continue;
    const payload = historyObject(entry.payload ?? { type: entry.type, content: entry.content });
    const plain = entry.type === 1 && !Object.keys(historyObject(payload.reply)).length;
    if (plain && (typeof entry.content !== "string" || !entry.content.trim())) continue;
    const body = plain ? undefined : historyContent(payload, identities);
    const record: HistoryMessage = {
      uid: entry.from_uid,
      username: identities.get(entry.from_uid)?.name ?? null,
      sentAt: messageSentAt(entry.timestamp, "milliseconds"),
      content: plain ? { type: "text", text: entry.content } : body!.content,
      ...(body?.truncated ? { truncated: true } : {})
    };
    if (size([record, ...messages]) <= 8000) {
      prepend(record);
      truncated ||= body?.truncated === true;
      continue;
    }
    // 尾部保留最新正文；JSON 转义也占预算，二分选择可容纳的 Unicode 尾段。
    if (!plain) {
      const omitted: HistoryMessage = {
        uid: record.uid,
        username: record.username,
        sentAt: record.sentAt,
        content: { type: "omitted", reason: "history-budget" },
        truncated: true
      };
      if (size([omitted, ...messages]) <= 8000) prepend(omitted);
      truncated = true;
      break;
    }
    const tail = Array.from(entry.content).slice(-8000);
    let low = 0,
      high = tail.length;
    const shortened = (length: number): HistoryMessage => ({
      ...record,
      content: { type: "text", text: length ? tail.slice(-length).join("") : "" },
      truncated: true
    });
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (size([shortened(middle), ...messages]) <= 8000) low = middle;
      else high = middle - 1;
    }
    if (low > 0) prepend(shortened(low));
    truncated = true;
    break;
  }
  return {
    messages: messages.filter((record) => !excluded.has(record)),
    truncated,
    ...(excluded.size
      ? { recoveryMessages: messages.filter((record) => excluded.has(record)) }
      : {})
  };
}
