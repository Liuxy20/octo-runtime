/** 本轮触发事实：只补查已准入消息的会话和身份，缺失信息不从正文或 UID 猜测。 */
import type { ContextItem } from "@mininglamp-oss/octo-runtime-protocol";
import type { ScopedOctoBotConfig } from "../contracts.js";
import { getJson } from "./api/client.js";
import { groupScope } from "./normalize.js";
import type { ImMessage } from "./wukong.js";
import { messageSentAt } from "./message-time.js";
import {
  resolveMessageIdentities,
  unknownIdentity,
  type MessageIdentityCache
} from "./message-identities.js";

type ObjectData = Record<string, unknown>;
const requestOptions = { retryOn429: false, logRateLimit: false, maxResponseBytes: 1_048_576 };

function object(value: unknown): ObjectData {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as ObjectData) : {};
}

function name(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/** 返回模型可读 JSON；外部取消继续传播，补充信息失败只留下真实 ID 和未知值。 */
export async function buildMessageTrigger(
  config: ScopedOctoBotConfig,
  message: ImMessage,
  token: string,
  signal: AbortSignal,
  cache?: MessageIdentityCache
): Promise<ContextItem | undefined> {
  if (typeof message.channelId !== "string" || typeof message.messageId !== "string")
    return undefined;
  signal.throwIfAborted();
  const mention = object(message.payload?.mention);
  const targets = [
    ...new Set(
      Array.isArray(mention.uids)
        ? mention.uids.filter((uid): uid is string => typeof uid === "string" && !!uid)
        : []
    )
  ];
  const senderUid = typeof message.fromUid === "string" ? message.fromUid : "";
  // 批量 API 上限 200；超过查询上限的 @ 目标仍保留 UID，名称和类型标未知。
  const uids = [...new Set([senderUid, config.bot_id, ...targets])].filter(
    (uid) => uid && Buffer.byteLength(uid) <= 64
  );
  const scope = groupScope(message.channelId);
  const inGroup = [2, 5].includes(message.channelType);
  const inTopic = message.channelType === 5 && !!scope.shortId;
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(5_000)]);
  const optional = async <T>(read: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await read();
    } catch {
      signal.throwIfAborted();
      return undefined;
    }
  };
  const groupPath = `/v1/bot/groups/${encodeURIComponent(scope.groupNo)}`;
  const [users, detail] = await Promise.all([
    resolveMessageIdentities(config, uids, token, signal, cache, deadline),
    inGroup
      ? optional(() =>
          getJson<ObjectData>(
            config.api_url,
            token,
            inTopic ? `${groupPath}/threads/${encodeURIComponent(scope.shortId!)}` : groupPath,
            deadline,
            requestOptions
          )
        )
      : undefined
  ]);
  signal.throwIfAborted();
  const data = object(detail);
  const matchingGroup = data.group_no === scope.groupNo;
  const matchingTopic = matchingGroup && data.short_id === scope.shortId;
  const known = (uid: string) => users.get(uid) ?? unknownIdentity(uid);
  const sentAt = messageSentAt(message.timestamp, "seconds");
  const enabled = (value: unknown): boolean => value === true || value === 1;
  return {
    namespace: "extra.im",
    name: "message-trigger",
    guidance:
      "Current message: conversation=channel ID/type, sender=actor, recipient=this Bot, sentAt=system-zone time, mentions=actual @ targets; null=unknown.",
    payload: {
      messageId: message.messageId,
      sentAt,
      conversation: {
        id: message.channelId,
        type: inTopic ? "group_topic" : inGroup ? "group" : "dm",
        ...(inGroup
          ? {
              group: {
                id: scope.groupNo,
                name: matchingGroup ? name(inTopic ? data.group_name : data.name) : null
              }
            }
          : {}),
        ...(inTopic
          ? {
              topic: {
                id: scope.shortId,
                name: matchingTopic ? name(data.name) : null
              }
            }
          : {})
      },
      sender: senderUid ? known(senderUid) : { uid: null, name: null, type: "unknown" },
      recipient: { botId: config.bot_id, name: known(config.bot_id).name },
      mentions: {
        targets: targets.map(known),
        ...(enabled(mention.ais) ? { allBots: true } : {}),
        ...(enabled(mention.all) ? { allMembers: true } : {}),
        ...(enabled(mention.humans) ? { allHumans: true } : {})
      }
    }
  };
}
