/** 群/话题的位置只证明本轮准备与材料交接，不代表模型已阅读完整历史。 */
import type { ContextItem } from "@mininglamp-oss/octo-runtime-protocol";
import { createHash } from "node:crypto";

export const IM_HISTORY_MESSAGE_LIMIT = 20;

export interface ImGapMetadata {
  processEpoch: string;
  revision: number;
  latestObservedSeq?: number;
  preparedTriggerSeq?: number;
  pendingAfterSeq?: number | null;
  continuityUnknown?: boolean;
  observationVisibility?: "unknown" | "partial";
  localOutputSeqs: number[];
  assistantOutputs?: {
    providerSessionId: string;
    messages: Array<{ seq: number; fingerprint: string }>;
  };
}

export interface ImGapTurnToken {
  sessionId: string;
  generation: number;
  processEpoch: string;
  /** 仅源流正常完成后、成功 final 交付前设置；普通发送位置不代表 assistant 已有内容。 */
  providerSessionId?: string;
}

export interface ImGapPlan {
  mode: "none" | "bootstrap" | "delta" | "unavailable";
  beforeSeq?: number;
  afterSeq?: number;
  messageLimit?: number;
  positionSpan?: number;
  earlierOmitted?: boolean;
  retrieval?: "provided" | "partial" | "empty" | "unavailable" | "omitted";
  reason?: string;
  excludedOutputs?: Array<{ seq: number; fingerprint: string }>;
  recoveryHistory?: ContextItem;
}

/** 只核对普通正文/文件卡；历史被编辑或形状不明时不排除，不以 URL 或 UID 判重。 */
export function assistantOutputFingerprint(payload: Record<string, unknown>): string | undefined {
  if (![1, 8].includes(Number(payload.type)) || payload.reply) return undefined;
  return createHash("sha256")
    .update(
      JSON.stringify([
        payload.type,
        payload.content ?? "",
        payload.url,
        payload.name,
        payload.size,
        payload.extension,
        payload.mention
      ])
    )
    .digest("hex");
}

export function validMessageSeq(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 0xffffffff;
}

export function gapMetadata(processEpoch: string, previous?: ImGapMetadata): ImGapMetadata {
  return previous?.processEpoch === processEpoch
    ? structuredClone(previous)
    : { processEpoch, revision: 0, localOutputSeqs: [], observationVisibility: "unknown" };
}

export function planHistoryGap(
  trigger: number | undefined,
  metadata: ImGapMetadata | undefined,
  processEpoch: string,
  capable = true
): ImGapPlan {
  if (!validMessageSeq(trigger)) return { mode: "unavailable", reason: "missing-position" };
  const current = metadata?.processEpoch === processEpoch ? metadata : undefined;
  const prepared = current?.preparedTriggerSeq;
  if (prepared !== undefined && trigger <= prepared)
    return { mode: "unavailable", reason: "position-rollback" };
  if (trigger === 1) return { mode: "none" };
  const pending = current?.pendingAfterSeq;
  const after =
    !capable || current?.continuityUnknown || pending === null
      ? undefined
      : pending === undefined
        ? prepared
        : Math.min(pending, prepared ?? pending);
  if (after === undefined)
    return {
      mode: "bootstrap",
      beforeSeq: trigger,
      messageLimit: IM_HISTORY_MESSAGE_LIMIT,
      earlierOmitted: true,
      reason: capable ? "unknown-baseline" : "store-capability-unavailable"
    };
  const span = trigger - after - 1;
  // 发送位置不足以证明 assistant 覆盖；读取同一窗口才能核对编辑及准备本轮恢复材料。
  if (span <= 0) return { mode: "none", afterSeq: after };
  return {
    mode: "delta",
    afterSeq: after,
    beforeSeq: trigger,
    positionSpan: span,
    messageLimit: Math.min(IM_HISTORY_MESSAGE_LIMIT, span),
    earlierOmitted: span > IM_HISTORY_MESSAGE_LIMIT
  };
}

export function historyGapContext(
  source: Record<string, unknown>,
  triggerId: string,
  plan: ImGapPlan,
  triggerSequence = plan.beforeSeq
): ContextItem | undefined {
  if (plan.mode === "none") return undefined;
  const item: ContextItem = {
    namespace: "extra.im",
    name: "history-gap",
    guidance:
      "This data describes the range, availability, and omissions of channel history for the current turn.",
    payload: {
      source,
      automatic: true,
      mode: plan.mode,
      status: plan.retrieval ?? "unavailable",
      materialProvided: plan.retrieval === "provided" || plan.retrieval === "partial",
      trigger: {
        messageId: triggerId,
        ...(validMessageSeq(triggerSequence) ? { messageSeq: triggerSequence } : {})
      },
      ...(plan.beforeSeq !== undefined
        ? {
            range: {
              beforeSeq: plan.beforeSeq,
              ...(plan.afterSeq !== undefined ? { afterSeq: plan.afterSeq } : {})
            }
          }
        : {}),
      ...(plan.reason ? { reason: plan.reason } : {}),
      ...(plan.messageLimit !== undefined ? { messageLimit: plan.messageLimit } : {}),
      ...(plan.positionSpan !== undefined ? { positionSpan: plan.positionSpan } : {}),
      earlierOmitted: plan.earlierOmitted === true
    }
  };
  return Buffer.byteLength(JSON.stringify(item)) <= 4096 ? item : compactHistoryGap(item);
}

export function compactHistoryGap(item: ContextItem): ContextItem | undefined {
  const compact: ContextItem = {
    namespace: item.namespace,
    name: item.name,
    guidance:
      "This data describes the range, availability, and omissions of channel history for the current turn.",
    payload: {
      source: item.payload.source,
      automatic: true,
      mode: item.payload.mode,
      status: item.payload.status,
      materialProvided: item.payload.materialProvided === true,
      earlierOmitted: item.payload.earlierOmitted === true,
      ...(item.payload.reason ? { reason: item.payload.reason } : {}),
      ...(item.payload.trigger ? { trigger: item.payload.trigger } : {}),
      ...(item.payload.range ? { range: item.payload.range } : {})
    }
  };
  return Buffer.byteLength(JSON.stringify(compact)) <= 1024 ? compact : undefined;
}

export function commitHistoryGap(
  current: ImGapMetadata,
  trigger: number | undefined,
  plan: ImGapPlan,
  history: ContextItem | undefined
): ImGapMetadata {
  const next = structuredClone(current);
  if (validMessageSeq(trigger))
    next.preparedTriggerSeq = Math.max(next.preparedTriggerSeq ?? 0, trigger);
  if (plan.mode === "bootstrap" || plan.mode === "delta") {
    const provided =
      (plan.retrieval === "provided" || plan.retrieval === "partial") &&
      history?.namespace === "extra.im" &&
      history.name === "history" &&
      history.payload.automatic === true &&
      history.payload.upperMessageSeq === trigger;
    if (provided || plan.retrieval === "empty") {
      delete next.pendingAfterSeq;
      delete next.continuityUnknown;
    } else {
      const after = plan.afterSeq ?? null;
      next.pendingAfterSeq =
        next.pendingAfterSeq === null || after === null
          ? null
          : Math.min(next.pendingAfterSeq ?? after, after);
    }
  }
  if (plan.mode === "unavailable") next.continuityUnknown = true;
  return next;
}
