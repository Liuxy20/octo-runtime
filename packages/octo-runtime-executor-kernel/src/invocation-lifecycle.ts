import { setTimeout as delay } from "node:timers/promises";
import { admissionClosedError } from "./submission-error.js";
import { isHostTerminal, type HostFrame } from "@mininglamp-oss/octo-runtime-protocol";
import {
  KernelError,
  type KernelInvocationRecord,
  type KernelInvocationLifecycle,
  type KernelInvocationDrainResult,
  type LookupKey,
  type RunRef,
  type RunSnapshot
} from "./types.js";

export interface TrackedInvocation {
  key: LookupKey;
  ref?: RunRef;
  instance?: string;
  submitted: boolean;
  phase: KernelInvocationRecord["phase"];
  cancellation: KernelInvocationRecord["cancellation"];
  lastSeq: number;
  observationError?: string;
  reason?: string;
  cancelTask?: Promise<{ accepted: boolean }>;
  admitted: Promise<void>;
  settleAdmission(): void;
  admissionError?: Error;
}

/**
 * 每个 client 独立保存 invoke 的身份、取消和观察状态；执行与断线恢复由 client.ts 负责。
 * 最多登记 128 项，不缓存正文；未知结果继续占用额度，不能通过删除记录伪造排空成功。
 */
export class InvocationRegistry implements KernelInvocationLifecycle {
  readonly #records = new Map<string, TrackedInvocation>();
  #stopped = false;
  #draining?: Promise<KernelInvocationDrainResult>;
  #drainDeadline?: number;
  #closed = false;
  #cancelling = 0;
  readonly #cancelQueue: (() => Promise<void>)[] = [];
  readonly #cancelControllers = new Set<AbortController>();
  constructor(
    private readonly transport: {
      get(
        key: LookupKey,
        instance: string,
        deadline: number,
        signal: AbortSignal
      ): Promise<RunSnapshot>;
      cancel(
        ref: RunRef,
        reason: string,
        deadline: number,
        signal: AbortSignal
      ): Promise<{ accepted: boolean }>;
    }
  ) {}

  begin(key: LookupKey): TrackedInvocation {
    this.assertSubmission();
    if (this.#records.has(key.invocation_id)) throw new KernelError("EXECUTION_IDENTITY_CONFLICT");
    if (this.#records.size >= 128) throw new KernelError("CLIENT_INVOCATION_CAPACITY_EXHAUSTED");
    let settleAdmission!: () => void;
    const admitted = new Promise<void>((resolve) => {
      settleAdmission = resolve;
    });
    const record: TrackedInvocation = {
      key,
      submitted: false,
      phase: "admitting",
      cancellation: "none",
      lastSeq: 0,
      admitted,
      settleAdmission
    };
    this.#records.set(key.invocation_id, record);
    return record;
  }

  assertSubmission(): void {
    if (this.#stopped) throw admissionClosedError();
  }

  accepted(record: TrackedInvocation, ref: RunRef, terminal?: HostFrame): void {
    record.ref = ref;
    record.instance = ref.kernel_instance_id;
    record.phase = "accepted";
    record.settleAdmission();
    if (terminal) this.observe(ref, terminal);
    if (record.reason !== undefined && !terminal && this.#records.get(ref.invocation_id) === record)
      void this.cancel(record, record.reason).catch(() => undefined);
  }

  reconcile(ref: RunRef, terminal?: HostFrame): void {
    const record = this.#records.get(ref.invocation_id);
    if (
      !record ||
      (record.instance && record.instance !== ref.kernel_instance_id) ||
      Object.entries(record.key).some(([field, value]) => Reflect.get(ref, field) !== value)
    )
      return;
    if (
      record.ref &&
      (record.ref.stream_id !== ref.stream_id || record.ref.protocol !== ref.protocol)
    )
      throw new KernelError("RUN_IDENTITY_MISMATCH");
    if (!record.ref) this.accepted(record, ref, terminal);
    else if (terminal) this.observe(ref, terminal);
  }

  rejected(record: TrackedInvocation, error: unknown): void {
    if (record.ref) {
      record.settleAdmission();
      this.interrupted(record, error);
      return;
    }
    record.admissionError = error instanceof Error ? error : new KernelError("ACCEPTANCE_UNKNOWN");
    record.observationError = errorCode(error);
    record.phase = "acceptance_unknown";
    record.settleAdmission();
    const rejectedByServer =
      error instanceof KernelError &&
      error.data !== undefined &&
      !["KERNEL_INSTANCE_CHANGED", "RUN_IDENTITY_MISMATCH"].includes(error.code);
    // 仅未发送或明确拒绝可安全移除；已发送但 ACK 未知时保留身份，后续 drain 只能查询确认。
    if (!record.submitted || rejectedByServer) this.#records.delete(record.key.invocation_id);
  }

  observe(ref: RunRef, frame: HostFrame): void {
    const record = this.#records.get(ref.invocation_id);
    if (
      !record ||
      !record.ref ||
      record.ref.stream_id !== ref.stream_id ||
      record.ref.kernel_instance_id !== ref.kernel_instance_id
    )
      return;
    record.lastSeq = Math.max(record.lastSeq, frame.seq);
    if (!isHostTerminal(frame)) return;
    if (
      frame.kind === "control" &&
      frame.control.type === "state" &&
      frame.control.state === "lost"
    ) {
      record.phase = "unobserved";
      record.observationError = "RUN_OUTCOME_UNKNOWN";
    } else this.#records.delete(ref.invocation_id);
  }

  interrupted(record: TrackedInvocation, error?: unknown): void {
    if (this.#records.get(record.key.invocation_id) !== record || !record.ref) return;
    record.phase = "unobserved";
    if (error !== undefined) record.observationError = errorCode(error);
  }

  active(id: string): TrackedInvocation {
    const record = this.#records.get(id);
    if (!record) throw new KernelError("INVOCATION_NOT_TRACKED");
    return record;
  }

  ref(id: string): RunRef {
    const record = this.active(id);
    if (!record.ref) throw new KernelError("INVOCATION_NOT_ACCEPTED");
    return record.ref;
  }

  cancel(record: TrackedInvocation, reason = "caller_cancelled"): Promise<{ accepted: boolean }> {
    if (record.ref && this.#records.get(record.key.invocation_id) !== record)
      return Promise.resolve({ accepted: false });
    if (record.observationError === "RUN_OUTCOME_UNKNOWN")
      return Promise.reject(new KernelError("RUN_OUTCOME_UNKNOWN"));
    record.reason ??= reason;
    if (record.cancellation === "none") record.cancellation = "requested";
    // 取消可能早于接纳 ACK：记住首次原因，等同一执行获得 RunRef 后发出一次控制请求。
    if (!record.ref)
      return record.admitted.then(() => {
        if (!record.ref) throw record.admissionError ?? new KernelError("ACCEPTANCE_UNKNOWN");
        return this.cancel(record, reason);
      });
    if (!record.cancelTask) {
      const controller = new AbortController();
      this.#cancelControllers.add(controller);
      record.cancelTask = new Promise<{ accepted: boolean }>((resolve, reject) => {
        this.#cancelQueue.push(async () => {
          try {
            if (this.#closed) throw new KernelError("CLIENT_CLOSED");
            if (this.#records.get(record.key.invocation_id) !== record) {
              resolve({ accepted: false });
              return;
            }
            if (record.observationError === "RUN_OUTCOME_UNKNOWN")
              throw new KernelError("RUN_OUTCOME_UNKNOWN");
            const deadline = Math.min(Date.now() + 5000, this.#drainDeadline ?? Infinity);
            if (deadline <= Date.now()) throw new KernelError("OPERATION_OUTCOME_UNKNOWN");
            resolve(
              await this.transport.cancel(record.ref!, record.reason!, deadline, controller.signal)
            );
          } catch (error) {
            reject(error instanceof Error ? error : new KernelError("OPERATION_OUTCOME_UNKNOWN"));
          }
        });
        this.#pumpCancellations();
      })
        .then((result) => {
          record.cancellation = "acknowledged";
          return result;
        })
        .catch((error: unknown) => {
          record.cancellation = "unknown";
          record.observationError = errorCode(error);
          throw error;
        })
        .finally(() => this.#cancelControllers.delete(controller));
      // Automatic signal cancellation may outlive its consumer; always consume rejection.
      void record.cancelTask.catch(() => undefined);
    }
    return record.cancelTask;
  }

  #pumpCancellations(): void {
    while (this.#cancelling < 4 && this.#cancelQueue.length) {
      this.#cancelling++;
      void this.#cancelQueue.shift()!().finally(() => {
        this.#cancelling--;
        this.#pumpCancellations();
      });
    }
  }

  snapshot(): readonly KernelInvocationRecord[] {
    return [...this.#records.values()].map((record) => ({
      key: { ...record.key },
      ...(record.ref ? { ref: { ...record.ref } } : {}),
      phase: record.phase,
      cancellation: record.cancellation,
      lastSeq: record.lastSeq,
      ...(record.observationError ? { observationError: record.observationError } : {})
    }));
  }

  stopAdmission(): void {
    this.#stopped = true;
  }

  close(): void {
    this.#closed = true;
    this.stopAdmission();
    for (const controller of this.#cancelControllers) controller.abort();
  }

  drain(options: { deadline: number; reason: string }): Promise<KernelInvocationDrainResult> {
    if (!Number.isSafeInteger(options.deadline) || options.deadline - Date.now() > 2_147_483_647)
      throw new KernelError("INVOCATION_DEADLINE_INVALID");
    // 首次关闭锁定绝对期限；重复调用不能延长预算，也不能启动第二轮取消副作用。
    if (this.#draining) return this.#draining;
    this.stopAdmission();
    this.#drainDeadline = options.deadline;
    return (this.#draining = this.#drain(options));
  }

  async #drain({
    deadline,
    reason
  }: {
    deadline: number;
    reason: string;
  }): Promise<KernelInvocationDrainResult> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => {
        controller.abort();
        for (const cancelController of this.#cancelControllers) cancelController.abort();
      },
      Math.max(0, deadline - Date.now())
    );
    try {
      while (this.#records.size && !controller.signal.aborted && Date.now() < deadline) {
        const records = [...this.#records.values()];
        // 最多四路查询/控制 IO；只查终态元数据，不新增正文订阅，避免与业务消费者争夺尾流。
        let index = 0;
        await Promise.all(
          Array.from({ length: Math.min(4, records.length) }, async () => {
            while (index < records.length && !controller.signal.aborted && Date.now() < deadline) {
              const record = records[index++];
              record.reason ??= reason;
              if (record.cancellation === "none") record.cancellation = "requested";
              if (!record.instance) continue;
              try {
                const info = await this.transport.get(
                  record.key,
                  record.instance,
                  deadline,
                  controller.signal
                );
                if (!record.ref) this.accepted(record, info.ref);
                if (info.terminal) this.observe(info.ref, info.terminal);
                if (!this.#records.has(record.key.invocation_id)) continue;
                // lost 表示执行结果未知，必须留在 unresolved，不能据此重放可能已有副作用的执行。
                if (record.observationError !== "RUN_OUTCOME_UNKNOWN")
                  await this.cancel(record, reason);
              } catch (error) {
                if (record.observationError !== "RUN_OUTCOME_UNKNOWN")
                  record.observationError = errorCode(error);
              }
            }
          })
        );
        if (this.#records.size && Date.now() < deadline) {
          await delay(Math.min(100, deadline - Date.now()), undefined, {
            signal: controller.signal
          }).catch(() => undefined);
        }
      }
      return { complete: this.#records.size === 0, unresolved: this.snapshot() };
    } finally {
      clearTimeout(timer);
      controller.abort();
      for (const cancelController of this.#cancelControllers) cancelController.abort();
    }
  }
}

export function errorCode(error: unknown): string {
  return error instanceof KernelError
    ? error.code
    : error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)
      ? error.message
      : "INVOCATION_OBSERVATION_FAILED";
}
