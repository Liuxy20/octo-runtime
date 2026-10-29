import type { ContextItem } from "@mininglamp-oss/octo-runtime-protocol";
import { artifactContext, type ImArtifactPolicy } from "../delivery/artifact-policy.js";
import { MENTION_GUIDANCE } from "../transport/mentions.js";

export const DEFAULT_STABLE_CONTEXT_REFRESH_INTERVAL_TURNS = 30;

/** 同代次排队共享，binding 只保存快照；待刷新仅在实际携带规则的执行成功后清除。 */
export interface ImStableContextState {
  turnCount: number;
  refreshPending: boolean;
}

/** 只计算下一轮计划；准备失败或同轮重试不能提前推进用户任务轮数。 */
export function planStableContext(
  state: ImStableContextState,
  interval = DEFAULT_STABLE_CONTEXT_REFRESH_INTERVAL_TURNS
): { turn: number; refresh: boolean } {
  const turn = state.turnCount + 1;
  if (!Number.isSafeInteger(turn) || turn < 1) throw new Error("IM_CONTEXT_TURN_LIMIT");
  return { turn, refresh: state.refreshPending || turn === 1 || turn % interval === 0 };
}

/** Gateway 自有稳定说明；普通轮省略的内容仅供本次显式新会话恢复，不缓存宿主材料。 */
export function stableChannelContexts(policy: ImArtifactPolicy): ContextItem[] {
  return [
    {
      namespace: "extra.im",
      name: "mention-instructions",
      guidance: MENTION_GUIDANCE,
      payload: { automatic: true }
    },
    artifactContext(policy),
    {
      namespace: "extra.im",
      name: "history-instructions",
      guidance:
        "Understand the current intent using relevant conversation history, honor the latest relevant corrections, and do not restart past tasks merely because they appear in history.",
      payload: { automatic: true }
    }
  ];
}
