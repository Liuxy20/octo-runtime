import type { CanonicalEvent } from "@mininglamp-oss/octo-runtime-protocol";

export interface ModelWaitSnapshot {
  seconds?: number;
  hasOutput: boolean;
  timeout?: "cancelling" | "unconfirmed" | "terminated";
}

interface ModelWaitClock {
  now(): number;
  schedule(callback: () => void, ms: number): () => void;
}

export const MODEL_WAIT_TIMEOUT_MESSAGE = "模型已连续 5 分钟未返回输出，本轮请求已超时。";

/** Gateway 每次尝试拥有的模型等待钟；只消费统一事件，不修改执行源或中止观察流。 */
export class ImModelWait {
  readonly #tools = new Set<string>();
  readonly #interactions = new Set<string>();
  readonly #activities = new Map<string, { type: string; id?: string }>();
  readonly #messages = new Map<
    string,
    { length: number; channel: string; role?: string; exposure?: string }
  >();
  #since?: number;
  #clearTimer?: () => void;
  #stopped = true;
  #queued = false;
  #snapshot: ModelWaitSnapshot = { hasOutput: false };

  constructor(
    readonly clock: ModelWaitClock,
    readonly changed: () => void,
    readonly timedOut: () => void
  ) {}

  get snapshot(): ModelWaitSnapshot {
    return { ...this.#snapshot };
  }

  /** 新尝试从交接执行开始；队列通知及工具/交互活动另行暂停。 */
  start(): void {
    this.stop();
    this.#stopped = false;
    this.#queued = false;
    this.#tools.clear();
    this.#interactions.clear();
    this.#activities.clear();
    this.#messages.clear();
    this.#snapshot = { hasOutput: false };
    this.#resume();
  }

  accept(event: CanonicalEvent): void {
    if (this.#stopped || this.#snapshot.timeout) return;
    const p = event.payload;
    if (["run.completed", "run.failed", "run.cancelled"].includes(event.type)) {
      this.stop();
      return;
    }
    if (event.type === "run.queued") this.#queued = true;
    if (event.type === "run.started" || event.type === "model_step.started") this.#queued = false;
    if (event.type === "tool_call.create") this.#tools.add(event.payload.id);
    if (event.type === "tool_call.update") this.#tools.delete(event.payload.id);
    if (event.type === "interaction.requested") this.#interactions.add(event.payload.interactionId);
    if (event.type === "interaction.resolved")
      this.#interactions.delete(event.payload.interactionId);
    if (event.type === "activity.started") {
      this.#queued = false;
      if (["executing_tool", "waiting_input", "waiting_approval"].includes(event.payload.kind))
        this.#activities.set(event.payload.activityId, event.payload.subject);
    }
    if (event.type === "activity.finished") this.#activities.delete(event.payload.activityId);
    // 同一工具/交互的活动和正式终态可以先后到达；正式终态足以关闭对应暂停原因。
    if (event.type === "tool_call.update" || event.type === "interaction.resolved") {
      const type = event.type === "tool_call.update" ? "tool" : "interaction";
      const id = type === "tool" ? p.id : p.interactionId;
      for (const [key, subject] of this.#activities)
        if (subject.type === type && subject.id === id) this.#activities.delete(key);
    }
    if (this.#content(event)) {
      this.#snapshot.hasOutput = true;
      this.#pause();
      this.#queued = false;
    }
    if (this.#queued || this.#tools.size || this.#interactions.size || this.#activities.size)
      this.#pause();
    else this.#resume();
  }

  #content(event: CanonicalEvent): boolean {
    if (!["message.delta", "message.create", "message.update"].includes(event.type)) return false;
    const p = event.payload;
    const id = p.messageId ?? `${p.stepId ?? "run"}:${p.channel ?? "final"}`;
    const previous = this.#messages.get(id);
    const channel = p.channel ?? previous?.channel ?? "final";
    const role = p.role ?? previous?.role;
    const exposure = p.exposure ?? previous?.exposure;
    const length =
      typeof p.text !== "string"
        ? (previous?.length ?? 0)
        : event.type === "message.delta"
          ? (previous?.length ?? 0) + p.text.length
          : p.text.length;
    const retained = this.#messages.has(id) || this.#messages.size < 256;
    if (retained)
      this.#messages.set(id, {
        length: Math.max(previous?.length ?? 0, length),
        channel,
        role,
        exposure
      });
    if (role && role !== "assistant") return false;
    if (!["final", "commentary", "analysis"].includes(channel)) return false;
    if (
      channel === "analysis" &&
      !["public_reasoning", "public_summary", "public_plan"].includes(exposure ?? "")
    )
      return false;
    if (typeof p.text !== "string" || !p.text.trim()) return false;
    // 只缓存长度，不保存正文；异常多消息时拒绝把未知快照冒充新内容，delta 仍可证明输出。
    return event.type === "message.delta" || (retained && length > (previous?.length ?? 0));
  }

  #pause(): void {
    this.#clearTimer?.();
    this.#clearTimer = undefined;
    this.#since = undefined;
    delete this.#snapshot.seconds;
  }

  #resume(): void {
    if (this.#since !== undefined) return;
    this.#since = this.clock.now();
    this.#schedule();
  }

  #schedule(): void {
    const elapsed = this.clock.now() - this.#since!;
    const next = Math.min(300_000, (Math.floor(elapsed / 30_000) + 1) * 30_000);
    this.#clearTimer = this.clock.schedule(
      () => {
        this.#clearTimer = undefined;
        if (this.#stopped || this.#since === undefined) return;
        const elapsed = this.clock.now() - this.#since;
        if (elapsed >= 300_000) {
          this.#snapshot.timeout = "cancelling";
          delete this.#snapshot.seconds;
          this.#since = undefined;
          // 取消 ACK 不代表结束；未在宽限内观察到终态时仍保留 Stop，禁止 Retry。
          this.#clearTimer = this.clock.schedule(() => this.unconfirmed(), 10_000);
          this.timedOut();
        } else {
          this.#snapshot.seconds = Math.floor(elapsed / 30_000) * 30;
          this.#schedule();
        }
        this.changed();
      },
      Math.max(0, next - elapsed)
    );
  }

  unconfirmed(): void {
    if (this.#stopped || this.#snapshot.timeout !== "cancelling") return;
    this.#clearTimer?.();
    this.#clearTimer = undefined;
    this.#snapshot.timeout = "unconfirmed";
    this.changed();
  }

  /** 必须在同次源流正常耗尽且确认终态后调用，不能由 cancel ACK 调用。 */
  confirmTermination(): void {
    this.stop();
    if (this.#snapshot.timeout) this.#snapshot.timeout = "terminated";
  }

  /** Stop、排空及 dispose 共用清理；保留超时事实供终态和未知展示使用。 */
  stop(): void {
    this.#stopped = true;
    this.#pause();
    if (this.#snapshot.timeout === "cancelling") this.#snapshot.timeout = "unconfirmed";
  }
}
