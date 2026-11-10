import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { ProviderActivity } from "@mininglamp-oss/octo-runtime-adapter-sdk";
import { isTerminal, type CanonicalEvent } from "@mininglamp-oss/octo-runtime-protocol";
import type { WatchdogClock } from "./watchdog.js";

const THRESHOLD_MS = 60_000;
const clock: WatchdogClock = {
  now: () => performance.now(),
  schedule(callback, delay) {
    const timer = setTimeout(callback, delay);
    timer.unref?.();
    return () => clearTimeout(timer);
  }
};

/**
 * 每轮 canonical 执行独占的模型输出观察器；不改变 watchdog 预算或 Provider。
 * Core 在源 next 完成时交入事实，在等待下一个结果时订阅通知；只保留一个待发槽。
 * 消息身份、公开性和文本增量由 Core 已有的消息准备步骤判断，不再维护第二套消息缓存。
 */
export class ModelOutputSilence {
  readonly #tools = new Set<string>();
  readonly #interactions = new Set<string>();
  readonly #activities = new Map<string, { type: string; id?: string }>();
  #queued = false;
  #since: number | undefined;
  #reported = false;
  #disposed = false;
  #pending?: CanonicalEvent;
  #wake?: () => void;
  #cancelTimer?: () => void;

  constructor(readonly time: WatchdogClock = clock) {
    this.#since = time.now();
  }

  /** 唯一等待者；解除监听同时释放 timer，避免输出密集时累积 Promise 监听。 */
  listen(wake: () => void): () => void {
    this.#wake = wake;
    if (this.#pending) wake();
    else this.#arm();
    return () => {
      if (this.#wake !== wake) return;
      this.#wake = undefined;
      this.#cancelTimer?.();
      this.#cancelTimer = undefined;
    };
  }

  take(): CanonicalEvent | undefined {
    const notice = this.#pending;
    this.#pending = undefined;
    // 槽交付后才允许新区间计时；使用真实输出更新的 since，不从交付时刻重算。
    this.#arm();
    return notice;
  }

  /** 原生侧工具事实补充 canonical；usage、传输心跳及一般进展均不算模型文本。 */
  activity(activity: ProviderActivity): void {
    if (this.#disposed) return;
    if (
      activity.kind !== "turn_progress" ||
      activity.method !== "item_lifecycle" ||
      !activity.toolCallId
    )
      return;
    if (activity.toolState === "started") this.#tools.add(activity.toolCallId);
    else if (activity.toolState === "completed") this.#finishTool(activity.toolCallId);
    this.#sync();
  }

  /** 输入须先通过 canonical 校验；hasOutput 只接受 Core 准备后的公开新增文本事实。 */
  canonical(event: CanonicalEvent, hasOutput = false): void {
    if (this.#disposed) return;
    if (isTerminal(event)) {
      this.dispose();
      return;
    }
    const p = event.payload;
    if (event.type === "run.queued") this.#queued = true;
    if (event.type === "run.started" || event.type === "model_step.started") this.#queued = false;
    if (event.type === "tool_call.create") this.#tools.add(String(p.id));
    if (
      event.type === "tool_call.update" &&
      ["completed", "failed", "cancelled", "stopped"].includes(String(p.status))
    )
      this.#finishTool(String(p.id));
    if (event.type === "interaction.requested" && p.delivery !== "async")
      this.#interactions.add(String(p.interactionId));
    if (event.type === "interaction.resolved") {
      const id = String(p.interactionId);
      this.#interactions.delete(id);
      for (const [key, subject] of this.#activities)
        if (subject.type === "interaction" && subject.id === id) this.#activities.delete(key);
    }
    if (event.type === "activity.started") {
      this.#queued = false;
      if (["executing_tool", "waiting_input", "waiting_approval"].includes(event.payload.kind))
        this.#activities.set(event.payload.activityId, event.payload.subject);
    }
    if (event.type === "activity.finished") this.#activities.delete(event.payload.activityId);
    if (hasOutput) this.#reset();
    this.#sync();
  }

  dispose(): void {
    this.#disposed = true;
    this.#reset();
    this.#pending = undefined;
    this.#since = undefined;
    this.#wake = undefined;
    this.#tools.clear();
    this.#interactions.clear();
    this.#activities.clear();
  }

  #finishTool(id: string): void {
    this.#tools.delete(id);
    for (const [key, subject] of this.#activities)
      if (subject.type === "tool" && subject.id === id) this.#activities.delete(key);
  }

  #reset(): void {
    this.#cancelTimer?.();
    this.#cancelTimer = undefined;
    // 重置未来静默区间，不撤回已达到阈值、尚未被 Core 取走的通知事实。
    this.#reported = false;
    this.#since = this.time.now();
  }

  #sync(): void {
    if (this.#queued || this.#tools.size || this.#interactions.size || this.#activities.size) {
      this.#reset();
      this.#since = undefined;
    } else if (this.#since === undefined) this.#reset();
    this.#arm();
  }

  #arm(): void {
    this.#cancelTimer?.();
    this.#cancelTimer = undefined;
    if (
      this.#disposed ||
      !this.#wake ||
      this.#since === undefined ||
      this.#reported ||
      this.#pending
    )
      return;
    const since = this.#since;
    this.#cancelTimer = this.time.schedule(
      () => {
        if (
          this.#disposed ||
          this.#since !== since ||
          !this.#wake ||
          this.#reported ||
          this.#pending
        )
          return;
        const silenceMs = Math.max(0, Math.floor(this.time.now() - since));
        if (silenceMs < THRESHOLD_MS) {
          this.#arm();
          return;
        }
        this.#reported = true;
        this.#pending = {
          protocolVersion: 2,
          type: "run.notice",
          payload: {
            noticeId: randomUUID(),
            code: "model_output_idle",
            severity: "info",
            params: { silenceMs, message: `${Math.floor(silenceMs / 1000)}s no LLM output` }
          }
        };
        this.#wake();
      },
      Math.max(1, THRESHOLD_MS - (this.time.now() - since))
    );
  }
}
