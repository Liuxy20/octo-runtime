import type { ImModuleDependencies } from "../ports.js";
import type { ImInvocationInput } from "./dispatcher.js";
/** IM 业务恢复编排。Host 每次仍只执行一个 invoke，不承担重放决策。 */
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import {
  KernelError,
  isInvocationNotSubmitted
} from "@mininglamp-oss/octo-runtime-executor-kernel";
import {
  failurePayload,
  type FailureEnvelope,
  type CanonicalEvent,
  type InvokeEnvironment
} from "@mininglamp-oss/octo-runtime-protocol";
import type { ImBotConfig, ImTaskAttempt } from "../contracts.js";

export const DEFAULT_CODEX_RETRY = Object.freeze({
  enabled: true,
  max_consecutive_retries: 5,
  max_total_retries: 20,
  recovery_timeout_ms: 120_000,
  initial_delay_ms: 2_000,
  max_delay_ms: 30_000
});

export interface ImTaskClock {
  now(): number;
  schedule(callback: () => void, ms: number): () => void;
  wait(ms: number, signal: AbortSignal): Promise<void>;
  random(): number;
}
const clock: ImTaskClock = {
  now: () => performance.now(),
  schedule(callback, ms) {
    const timer = setTimeout(callback, ms);
    timer.unref();
    return () => clearTimeout(timer);
  },
  wait: async (ms, signal) => {
    await delay(ms, undefined, { signal });
  },
  random: Math.random
};

type AttemptCompletion = "terminal_confirmed" | "not_submitted" | "unresolved";
interface ActiveAttempt {
  invocationId: string;
  completion?: AttemptCompletion;
  finished: Promise<AttemptCompletion>;
}

/** 预算内最多 101 次尝试；只保留身份和终态，不在此缓存模型历史。 */
export class ImTask {
  readonly attempts: ImTaskAttempt[] = [];
  /** 与 Channel 展示、诊断共用的本次未提交事实；不注入执行源事件。 */
  notSubmittedFailure?: FailureEnvelope;
  readonly #policy;
  readonly #abort = new AbortController();
  readonly #retryStop = new AbortController();
  readonly #signal: AbortSignal;
  #active?: ActiveAttempt;
  #cancelPending?: Promise<{ accepted: boolean }>;
  #total = 0;
  #consecutive = 0;
  #recoveryStarted?: number;
  #recoveryTimer?: () => void;
  #replaySafe = true;
  #started = false;
  #draining = false;
  stopReason?: string;
  constructor(
    readonly kernel: ImModuleDependencies["kernel"],
    readonly request: ImInvocationInput,
    readonly adapterType: string,
    config: ImBotConfig,
    readonly environment: InvokeEnvironment,
    readonly onAttempt: (request: ImInvocationInput) => void,
    readonly time: ImTaskClock = clock
  ) {
    this.#policy = { ...DEFAULT_CODEX_RETRY, ...config.codex_retry };
    this.#signal = AbortSignal.any([
      this.#abort.signal,
      ...(environment.signal ? [environment.signal] : [])
    ]);
  }
  /** reset 只阻止后续尝试，不把 reset 变成取消当前 Provider 执行。 */
  stopRetries(): void {
    this.#retryStop.abort();
  }
  /** owner stop 只取消执行和后续尝试；当前订阅须继续消费真实终态。 */
  async drain(reason = "IM shutdown"): Promise<void> {
    this.#draining = true;
    this.stopRetries();
    const active = this.#active;
    if (!active || active.completion === "not_submitted") return;
    try {
      this.#cancelPending ??= this.kernel.cancelInvocation(active.invocationId, reason);
      await this.#cancelPending;
    } catch (error) {
      // Kernel 可在订阅 ACK 时先确认终态并释放登记，业务迭代器此时仍可能等待交互展示。
      // 登记缺失本身不是完成证据；只接受同次原流确认终态或可信未提交，仍受 owner 共享期限约束。
      if (
        !isInvocationNotSubmitted(error) &&
        (!(error instanceof KernelError && error.code === "INVOCATION_NOT_TRACKED") ||
          (await active.finished) === "unresolved")
      )
        throw error;
    }
  }
  async cancel(reason = "IM user stop"): Promise<boolean> {
    this.#abort.abort(reason);
    return this.cancelExecution(reason);
  }
  /** 展示故障只请求停止执行及重试，保留观察 signal；返回取消受理结果，不代表执行终态。 */
  async cancelExecution(reason: string): Promise<boolean> {
    this.stopRetries();
    if (!this.#active || this.#active.completion === "not_submitted") return true;
    this.#cancelPending ??= this.kernel.cancelInvocation(this.#active.invocationId, reason);
    try {
      return (await this.#cancelPending).accepted;
    } catch (error) {
      if (isInvocationNotSubmitted(error)) return true;
      throw error;
    }
  }
  #stop(reason: string): void {
    this.stopReason ??= reason;
    void this.cancel(reason).catch(() => undefined);
  }
  async #settleCancellation(): Promise<void> {
    await this.#cancelPending?.catch(() => undefined);
  }
  #recovering(): void {
    if (this.#recoveryStarted !== undefined) return;
    this.#recoveryStarted = this.time.now();
    this.#recoveryTimer = this.time.schedule(
      () => this.#stop("IM_RETRY_RECOVERY_TIMEOUT"),
      this.#policy.recovery_timeout_ms
    );
  }
  #progress(): void {
    this.#recoveryTimer?.();
    this.#recoveryTimer = undefined;
    this.#recoveryStarted = undefined;
    this.#consecutive = 0;
  }
  #countRetry(): boolean {
    if (
      this.#consecutive >= this.#policy.max_consecutive_retries ||
      this.#total >= this.#policy.max_total_retries
    ) {
      this.stopReason = "IM_RETRY_LIMIT_EXCEEDED";
      return false;
    }
    this.#consecutive++;
    this.#total++;
    return true;
  }
  #observe(event: CanonicalEvent): void {
    // 工具和交互可能产生外部副作用；首次出现后不再自动重放本轮。
    if (event.type.startsWith("tool_call.") || event.type === "interaction.requested")
      this.#replaySafe = false;
    if (this.adapterType !== "codex" || !this.#policy.enabled) return;
    if (event.type === "run.notice" && event.payload.code === "retry_scheduled") {
      this.#recovering();
      if (!this.#countRetry()) this.#stop(this.stopReason!);
    } else if (
      (event.type === "message.delta" && !!event.payload.text) ||
      (event.type === "tool_call.update" && event.payload.status === "completed")
    ) {
      this.#progress();
    }
  }
  #retryDelay(event: CanonicalEvent): number | undefined {
    if (
      this.adapterType !== "codex" ||
      !this.#policy.enabled ||
      !this.#replaySafe ||
      this.#retryStop.signal.aborted ||
      this.#signal.aborted ||
      event.type !== "run.failed"
    )
      return;
    const failure = event.payload.failure;
    // 只消费统一错误证据；retryable 本身不是自动重放授权。
    if (
      !failure?.retryable ||
      failure.source.adapter !== "codex" ||
      !["OH-PRV-4005", "OH-PRV-4006"].includes(failure.code)
    )
      return;
    this.#recovering();
    if (!this.#countRetry()) return;
    const backoff = Math.min(
      this.#policy.max_delay_ms,
      this.#policy.initial_delay_ms * 2 ** Math.min(this.#consecutive - 1, 16)
    );
    return Math.max(
      failure.retryAfterMs ?? 0,
      Math.min(this.#policy.max_delay_ms, Math.ceil(backoff * (1 + this.time.random() * 0.2)))
    );
  }
  async *events(): AsyncGenerator<CanonicalEvent> {
    if (this.#started) throw new Error("IM_TASK_ALREADY_STARTED");
    this.#started = true;
    const deadline =
      this.time.now() +
      Number(
        this.request.contexts.items.find(
          (item) => item.namespace === "octo.execution" && item.name === "limits"
        )?.payload.run_timeout_ms ?? 86_400_000
      );
    const clearDeadline = this.time.schedule(
      () => this.#stop("IM_TASK_DEADLINE"),
      deadline - this.time.now()
    );
    let request = this.request;
    try {
      while (!this.#signal.aborted && !this.#draining) {
        const remaining = Math.ceil(deadline - this.time.now());
        if (remaining < 100) {
          this.#stop("IM_TASK_DEADLINE");
          break;
        }
        // 重试复用同一轮 Context，只更新剩余执行预算；复制后修改，保留原始快照供幂等记录使用。
        request = { ...request, contexts: structuredClone(request.contexts) };
        for (const item of request.contexts.items)
          if (item.namespace === "octo.execution" && item.name === "limits")
            item.payload.run_timeout_ms = remaining;
        this.onAttempt(request);
        let finish!: (completion: AttemptCompletion) => void;
        const active: ActiveAttempt = {
          invocationId: request.invocationId,
          finished: new Promise<AttemptCompletion>((resolve) => {
            finish = resolve;
          })
        };
        this.#active = active;
        this.#cancelPending = undefined;
        const attempt: ImTask["attempts"][number] = {
          runId: request.runId,
          invocationId: request.invocationId,
          outcome: "running"
        };
        this.attempts.push(attempt);
        let terminal: CanonicalEvent | undefined;
        let completion: AttemptCompletion = "unresolved";
        try {
          for await (const event of this.kernel.invoke(request, {
            ...this.environment,
            signal: this.#signal
          })) {
            if (terminal) throw new Error("IM_FRAME_AFTER_TERMINAL");
            this.#observe(event);
            if (event.type === "session.update")
              request = {
                ...request,
                providerSession: structuredClone(event.payload.providerSession)
              };
            if (["run.completed", "run.failed", "run.cancelled"].includes(event.type))
              terminal = event;
            else yield event;
          }
          // 看到终态后仍须正常耗尽：终态后的传输/控制错误不能被 drain 当成成功。
          if (!terminal) throw new Error("IM_RUN_WITHOUT_TERMINAL");
          completion = "terminal_confirmed";
        } catch (error) {
          if (isInvocationNotSubmitted(error)) {
            completion = "not_submitted";
            active.completion = completion;
            this.stopRetries();
            this.notSubmittedFailure = failurePayload(error, {
              stage: "channel_admission",
              defaultDomain: "runtime",
              invocationNotSubmitted: true,
              source: { component: "octo-runtime", adapter: this.adapterType },
              runId: request.runId
            }).failure;
            attempt.outcome = "not_submitted";
            attempt.failureCode = this.notSubmittedFailure.code;
            attempt.diagnosticId = this.notSubmittedFailure.diagnosticId;
          } else attempt.outcome = "unknown";
          throw error;
        } finally {
          // 必须等待消费结束及取消回执；未知结果不会进入下一次 invoke。
          await this.#settleCancellation();
          this.#active = undefined;
          // #cancelPending 只保存原始取消回执，不能反过来等待 finished，否则这里会循环等待。
          finish(completion);
        }
        if (!terminal) throw new Error("IM_RUN_WITHOUT_TERMINAL");
        attempt.outcome = terminal.type;
        if (terminal.type === "run.failed") {
          attempt.failureCode = terminal.payload.failure?.code;
          attempt.diagnosticId = terminal.payload.failure?.diagnosticId;
        }
        if (this.#signal.aborted) {
          yield terminal.type === "run.completed" ? terminal : this.#stoppedEvent();
          return;
        }
        const waitMs = this.#retryDelay(terminal);
        if (waitMs === undefined) {
          yield terminal;
          return;
        }
        const recoveryLeft =
          this.#policy.recovery_timeout_ms - (this.time.now() - this.#recoveryStarted!);
        if (waitMs >= Math.min(deadline - this.time.now(), recoveryLeft)) {
          this.stopReason = "IM_RETRY_WAIT_EXCEEDS_BUDGET";
          yield terminal;
          return;
        }
        yield {
          protocolVersion: 2,
          type: "run.notice",
          payload: {
            noticeId: `im:retry:${this.#total}`,
            code: "retry_scheduled",
            severity: "warning",
            params: { attempt: this.attempts.length + 1 }
          }
        };
        try {
          await this.time.wait(waitMs, AbortSignal.any([this.#signal, this.#retryStop.signal]));
        } catch {
          yield this.#signal.aborted ? this.#stoppedEvent() : terminal;
          return;
        }
        if (this.#retryStop.signal.aborted) {
          yield terminal;
          return;
        }
        request = {
          ...request,
          runId: `run_${randomUUID()}`,
          invocationId: `invoke_${randomUUID()}`,
          runMetadata: {
            ...request.runMetadata,
            taskRunId: this.request.runId,
            attempt: this.attempts.length + 1
          }
        };
      }
      yield this.#stoppedEvent();
    } finally {
      clearDeadline();
      this.#recoveryTimer?.();
    }
  }
  #stoppedEvent(): CanonicalEvent {
    return this.stopReason
      ? {
          protocolVersion: 2,
          type: "run.failed",
          payload: {
            code: this.stopReason,
            message:
              this.stopReason === "IM_TASK_DEADLINE"
                ? "本轮任务已达到总运行时限。"
                : "模型服务连续故障，已达到自动恢复预算。"
          }
        }
      : { protocolVersion: 2, type: "run.cancelled", payload: { reason: "IM user stop" } };
  }
}
