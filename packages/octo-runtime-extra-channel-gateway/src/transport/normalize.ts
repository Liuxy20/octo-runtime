/**
 * 入站准入：从真实报文识别发送者、空间、群/话题和 @ 触发条件。
 * 正文自报身份不参与授权；话题关联父群只用于范围校验，回复仍使用原始地址。
 */
import type { ScopedOctoBotConfig } from "../contracts.js";
import type { ImMessage } from "./wukong.js";
import { messageContent } from "./message-content.js";

export function groupScope(channelId: string): { groupNo: string; shortId?: string } {
  const separator = channelId.indexOf("____");
  return separator < 0
    ? { groupNo: channelId }
    : { groupNo: channelId.slice(0, separator), shortId: channelId.slice(separator + 4) };
}

export function observesImScope(
  config: ScopedOctoBotConfig,
  channelId: string,
  channelType: number,
  spaceId?: unknown
): boolean {
  return (
    Boolean(channelId) &&
    [2, 5].includes(channelType) &&
    (!spaceId || spaceId === config.spaceId) &&
    config.groups_enabled !== false &&
    (config.group_ids == null ||
      config.group_ids.length === 0 ||
      config.group_ids.includes(groupScope(channelId).groupNo))
  );
}

export function acceptsImMessage(config: ScopedOctoBotConfig, message: ImMessage): boolean {
  // 自己发出的消息永不触发 AgentRun，即使真实 @ 自己、@所有AI 或显式列入发送者名单。
  if (
    message.fromUid === config.bot_id ||
    !message.fromUid ||
    isRulesNotification(message) ||
    !message.messageId ||
    !message.channelId ||
    ![1, 2, 8, 11, 14, 18].includes(message.payload.type as number) ||
    (message.payload.type === 1 && typeof message.payload.content !== "string") ||
    (message.payload.space_id && message.payload.space_id !== config.spaceId)
  )
    return false;
  // 省略时沿用平台准入：DM 好友权限由平台负责，群/话题不增加发送者限制。
  if (config.allowed_sender_ids && !config.allowed_sender_ids.includes(message.fromUid))
    return false;
  const contentSupported = (): boolean =>
    ![11, 14].includes(message.payload.type as number) || Boolean(messageContent(message.payload));
  if (message.channelType === 1) return contentSupported();
  // .octospec/tasks/channel-group-admission/plan.md：启停与范围分开。
  // 空名单不承担“禁用”语义；只有非空名单限制父群，且永不影响上面的私聊分支。
  if (!observesImScope(config, message.channelId, message.channelType, message.payload.space_id))
    return false;
  return mentionsBot(message.payload.mention, config.bot_id) && contentSupported();
}

export function isRulesNotification(message: ImMessage): boolean {
  const event = message.payload.event;
  return (
    [2, 5].includes(message.channelType) &&
    event !== null &&
    typeof event === "object" &&
    !Array.isArray(event) &&
    ["group_md_updated", "group_md_deleted", "thread_md_updated", "thread_md_deleted"].includes(
      String((event as Record<string, unknown>).type)
    )
  );
}

/** 事件只使规则缓存失效，内容及版本仍由授权 API 核验，不产生执行授权。 */
export function rulesChange(message: ImMessage): { groupNo: string; shortId?: string } | undefined {
  if (!isRulesNotification(message)) return;
  const event = message.payload.event as Record<string, unknown>;
  const scope = groupScope(message.channelId);
  const topic = String(event.type).startsWith("thread_");
  if (
    !scope.groupNo ||
    !Number.isSafeInteger(event.version) ||
    Number(event.version) < 0 ||
    (topic
      ? message.channelType !== 5 || !scope.shortId
      : message.channelType !== 2 || scope.shortId) ||
    (event.group_no !== undefined && event.group_no !== scope.groupNo) ||
    (event.short_id !== undefined && event.short_id !== scope.shortId)
  )
    return;
  return scope;
}

export function mentionsBot(value: unknown, botId: string): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const mention = value as Record<string, unknown>;
  const flag = (value: unknown): boolean => value === 1 || value === true;
  return (
    (Array.isArray(mention.uids) && mention.uids.includes(botId)) ||
    (flag(mention.ais) && !flag(mention.all) && !flag(mention.humans))
  );
}

export function imSessionKey(config: ScopedOctoBotConfig, message: ImMessage): string {
  return [
    new URL(config.api_url).href,
    config.spaceId,
    config.bot_id,
    config.adapter.adapter_type ?? "codex",
    String(message.channelType),
    message.channelId
  ]
    .map(encodeURIComponent)
    .join("/");
}
