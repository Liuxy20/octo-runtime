import type { Writable } from "node:stream";
import { performance } from "node:perf_hooks";

interface WriteEntry {
  owner?: object;
  line: string;
  bytes: number;
  control: boolean;
  deadline: number;
  onError: (error: Error) => void;
  onWritten?: () => void;
  settled: boolean;
  callbackDone: boolean;
  needsDrain: boolean;
  drained: boolean;
}

/** 本地传输原因独立于 Provider 返回的 RPC 错误，不能用 stderr 推断认证状态。 */
export function codexTransportError(code: string, cause?: unknown): Error {
  return Object.assign(
    new Error(
      cause instanceof Error ? `${code}: ${cause.message}` : code,
      cause === undefined ? undefined : { cause }
    ),
    { code }
  );
}

/**
 * 每个 app-server 独占的 stdin 发送器。写回调仅确认本地写入，不能证明命令执行。
 * 所有普通 RPC/回复共用 FIFO；控制预留只用于拒绝与中断，仍遵守 Writable 背压。
 * stop 结算所有等待并解除监听；已交给 Writable 的字节无法撤回或安全重试。
 */
export class CodexStdinWriter {
  readonly #normal: WriteEntry[] = [];
  readonly #control: WriteEntry[] = [];
  #active?: WriteEntry;
  #failure?: Error;
  #admissionError?: Error;
  #timer?: NodeJS.Timeout;
  #scheduled = false;
  #lastProgress = performance.now();
  readonly #limits;

  constructor(
    readonly output: Writable,
    readonly onFailure: (error: Error) => void,
    limits: {
      maxItems?: number;
      maxBytes?: number;
      controlItems?: number;
      controlBytes?: number;
      stallMs?: number;
      deliveryMs?: number;
    } = {}
  ) {
    this.#limits = {
      maxItems: 4096,
      maxBytes: 64 * 1024 * 1024,
      controlItems: 8,
      controlBytes: 64 * 1024,
      stallMs: 5000,
      deliveryMs: 30_000,
      ...limits
    };
    for (const value of Object.values(this.#limits))
      if (!Number.isSafeInteger(value) || value < 1) throw new Error("Invalid stdin writer limit");
    output.on("drain", this.#drain);
    output.on("error", this.#error);
    output.on("close", this.#closed);
  }

  /** 入队同步冻结序列化行；返回的取消函数只删除未写出的条目，不重发在途字节。 */
  write(
    message: Record<string, unknown>,
    onError: (error: Error) => void,
    onWritten?: () => void,
    options: { control?: boolean; timeoutMs?: number; owner?: object } = {}
  ): () => void {
    const denied = this.#failure ?? (!options.control ? this.#admissionError : undefined);
    if (denied) {
      onError(denied);
      return () => {};
    }
    let line: string;
    try {
      line = `${JSON.stringify(message)}\n`;
    } catch (cause) {
      const error = codexTransportError("CODEX_STDIN_WRITE_FAILED", cause);
      this.#fail(error);
      onError(error);
      return () => {};
    }
    const control = options.control === true;
    const entries = [...(control ? this.#control : this.#normal)];
    if (this.#active?.control === control) entries.push(this.#active);
    const bytes = Buffer.byteLength(line);
    const code =
      entries.length >= (control ? this.#limits.controlItems : this.#limits.maxItems)
        ? "CODEX_STDIN_QUEUE_ITEMS_EXCEEDED"
        : entries.reduce((sum, entry) => sum + entry.bytes, bytes) >
            (control ? this.#limits.controlBytes : this.#limits.maxBytes)
          ? "CODEX_STDIN_QUEUE_BYTES_EXCEEDED"
          : undefined;
    if (code) {
      const error = codexTransportError(code);
      this.#fail(error);
      onError(error);
      return () => {};
    }
    if (!this.#active && !this.#normal.length && !this.#control.length)
      this.#lastProgress = performance.now();
    const entry: WriteEntry = {
      owner: options.owner,
      line,
      bytes,
      control,
      deadline:
        performance.now() + Math.min(options.timeoutMs ?? Infinity, this.#limits.deliveryMs),
      onError,
      onWritten,
      settled: false,
      callbackDone: false,
      needsDrain: false,
      drained: false
    };
    (control ? this.#control : this.#normal).push(entry);
    this.#schedule();
    this.#arm();
    return () => {
      const queue = control ? this.#control : this.#normal;
      const index = queue.indexOf(entry);
      if (index < 0) return;
      queue.splice(index, 1);
      // RPC 所有者已经结算超时，删除条目不能再次调用它的错误回调。
      entry.settled = true;
      this.#arm();
    };
  }

  /** 终态先撤销未送达决定，再 best-effort 中断；不能等 drain 才处理取消。 */
  cancelPending(error: Error): void {
    this.#admissionError ??= error;
    const entries = [...this.#normal.splice(0), ...this.#control.splice(0)];
    if (this.#active) entries.push(this.#active);
    for (const entry of entries) this.#reject(entry, error);
    this.#arm();
  }

  /** 共享服务只撤销原调用的未写入条目；已写出的字节不重放，也不关闭其他 owner 的准入。 */
  cancelOwner(owner: object, error: Error): void {
    for (const queue of [this.#normal, this.#control]) {
      for (let i = queue.length - 1; i >= 0; i--) {
        if (queue[i].owner !== owner) continue;
        const [entry] = queue.splice(i, 1);
        this.#reject(entry, error);
      }
    }
    if (this.#active?.owner === owner) this.#reject(this.#active, error);
    this.#arm();
  }

  /** 所有者关闭时只结算资源；不额外制造新的执行失败。 */
  stop(error: Error): void {
    if (this.#failure) return;
    this.#failure = error;
    clearTimeout(this.#timer);
    this.output.off("drain", this.#drain);
    this.output.off("error", this.#error);
    this.output.off("close", this.#closed);
    const entries = [...this.#normal.splice(0), ...this.#control.splice(0)];
    if (this.#active) entries.push(this.#active);
    this.#active = undefined;
    for (const entry of entries) this.#reject(entry, error);
  }

  #reject(entry: WriteEntry, error: Error): void {
    if (entry.settled) return;
    entry.settled = true;
    entry.onError(error);
  }

  #fail(error: Error): void {
    if (this.#failure) return;
    this.stop(error);
    this.onFailure(error);
  }

  readonly #error = (cause: Error): void =>
    this.#fail(codexTransportError("CODEX_STDIN_WRITE_FAILED", cause));
  readonly #closed = (): void => this.#fail(codexTransportError("CODEX_TRANSPORT_FAILED"));
  readonly #drain = (): void => {
    if (!this.#active || this.#active.drained) return;
    this.#active.drained = true;
    this.#lastProgress = performance.now();
    this.#schedule();
  };

  #schedule(): void {
    if (this.#scheduled || this.#failure) return;
    this.#scheduled = true;
    queueMicrotask(() => {
      this.#scheduled = false;
      this.#pump();
    });
  }

  #pump(): void {
    if (this.#failure) return;
    if (this.#active) {
      if (!this.#active.callbackDone || (this.#active.needsDrain && !this.#active.drained)) {
        this.#arm();
        return;
      }
      this.#active = undefined;
    }
    const entry = this.#control.shift() ?? this.#normal.shift();
    if (!entry) {
      this.#arm();
      return;
    }
    this.#active = entry;
    if (entry.deadline <= performance.now()) {
      this.#fail(codexTransportError("CODEX_STDIN_DELIVERY_TIMEOUT"));
      return;
    }
    try {
      // 先登记 active，再调用 write；同步回调/提前 drain 也必须看到同一条记录。
      entry.needsDrain = !this.output.write(entry.line, (cause?: Error | null) => {
        if (this.#failure || this.#active !== entry) return;
        if (cause) {
          this.#error(cause);
          return;
        }
        entry.callbackDone = true;
        this.#lastProgress = performance.now();
        if (!entry.settled) {
          entry.settled = true;
          entry.onWritten?.();
        }
        this.#schedule();
      });
    } catch (cause) {
      this.#error(cause instanceof Error ? cause : new Error(String(cause)));
    }
    this.#arm();
  }

  #arm(): void {
    clearTimeout(this.#timer);
    if (this.#failure) return;
    const entries = [...this.#normal, ...this.#control];
    if (this.#active) entries.push(this.#active);
    if (!entries.length) return;
    const delivery = Math.min(...entries.map((entry) => entry.deadline));
    const stall = this.#lastProgress + this.#limits.stallMs;
    this.#timer = setTimeout(
      () => {
        if (performance.now() < Math.min(delivery, stall)) {
          this.#arm();
          return;
        }
        this.#fail(
          codexTransportError(
            stall < delivery ? "CODEX_STDIN_STALLED" : "CODEX_STDIN_DELIVERY_TIMEOUT"
          )
        );
      },
      Math.max(1, Math.min(delivery, stall) - performance.now())
    );
    this.#timer.unref?.();
  }
}
