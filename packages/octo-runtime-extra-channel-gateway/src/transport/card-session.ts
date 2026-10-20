import { imBotIdentity } from "../lifecycle/configuration.js";
/**
 * 单 Run 卡片会话：首次创建、后续编辑同一消息，并用序号和终态屏障收敛状态。
 * 终态卡片失败由 finish 返回，最终文本仍由执行编排投递；回执不代表客户端已经渲染。
 */
import type { ImAddress } from "../contracts.js";
import type { OctoConnector } from "./connector.js";
import { stableEffectKey } from "./connector.js";
import type { ImDeliveryDispatcher } from "../delivery/dispatcher.js";
import { ProgressScheduler } from "../delivery/scheduler.js";
import { buildReasoningFrame } from "./reasoning-frame.js";
import type { RunPresentation } from "../presentation/run-projector.js";

export class CardSession {
  #messageId?: string;
  #seq = 0;
  #terminalFailed = false;
  readonly #scheduler: ProgressScheduler<RunPresentation>;
  readonly effectKey: string;
  constructor(
    readonly connector: OctoConnector,
    readonly delivery: ImDeliveryDispatcher,
    readonly address: ImAddress,
    runId: string,
    readonly stopTyping: () => void,
    readonly onDiagnostic: (code: string) => void
  ) {
    this.effectKey = stableEffectKey(imBotIdentity(connector.config), address, runId, "progress");
    this.#scheduler = new ProgressScheduler(
      async (snapshot) => {
        try {
          await this.#send(snapshot);
        } catch (error) {
          if (snapshot.terminal || snapshot.resultUnknown) this.#terminalFailed = true;
          throw error;
        }
      },
      () => onDiagnostic("IM_CARD_FAILED")
    );
  }
  update(snapshot: RunPresentation): void {
    if (snapshot.terminal || snapshot.phase === "waiting") this.stopTyping();
    this.#scheduler.enqueue(snapshot, !!snapshot.terminal || !!snapshot.resultUnknown);
  }
  async #send(snapshot: RunPresentation): Promise<void> {
    const settled = !!snapshot.terminal || !!snapshot.resultUnknown;
    const template = await this.connector.reasoningTemplate();
    if (!template) {
      if (settled && this.#messageId) this.#terminalFailed = true;
      this.onDiagnostic("IM_CARD_UNAVAILABLE");
      return;
    }
    const frame = buildReasoningFrame(snapshot, template);
    if (!frame) {
      if (settled) this.#terminalFailed = true;
      this.onDiagnostic("IM_CARD_BUDGET_EXCEEDED");
      return;
    }
    // 模板查询期间可能已收到终态；旧快照必须在出站前再次检查。
    if (this.#scheduler.terminal && !settled) return;
    const seq = ++this.#seq;
    const receipt = await this.delivery.deliver(
      `${this.effectKey}:${seq}`,
      () =>
        this.connector.card(
          this.address,
          template,
          frame,
          this.effectKey,
          this.#messageId,
          seq,
          !settled
        ),
      { transient: !settled, obsolete: () => this.#scheduler.terminal && !settled }
    );
    if (receipt.state === "delivered") {
      // 后续更新绑定第一次成功发送的消息，不另起卡片；可见卡片接替 typing 提示。
      this.#messageId = receipt.messageId;
      this.stopTyping();
    } else {
      if (settled) this.#terminalFailed = true;
      this.onDiagnostic(receipt.code ?? "IM_CARD_FAILED");
    }
  }
  async finish(): Promise<void> {
    this.stopTyping();
    await this.#scheduler.flush();
    if (this.#terminalFailed) throw new Error("IM_CARD_FINALIZATION_FAILED");
  }
  get messageId(): string | undefined {
    return this.#messageId;
  }
}
