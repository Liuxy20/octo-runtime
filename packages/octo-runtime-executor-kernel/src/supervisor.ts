import { spawnWorker, type SpawnWorkerOptions, type WorkerProcess } from "./process.js";
import type { KernelStatus } from "./types.js";
import { KernelError } from "./types.js";

/** Kernel 独占 worker 的创建与回收；清理失败时禁止启动替代实例。 */
export class WorkerSupervisor {
  #worker?: WorkerProcess;
  #generation = 0;
  #attempt = 0;
  #state: KernelStatus["worker"]["state"] = "starting";
  #closing = false;
  #recovery?: Promise<void>;
  #timer?: NodeJS.Timeout;
  #lastPong = 0;
  #pendingPing = false;
  #stableSince = 0;
  #attempts: number[] = [];
  #abort = new AbortController();
  #cleanupFailure?: AggregateError;
  constructor(
    private readonly options: SpawnWorkerOptions,
    private readonly recordWorker?: (pid: number | undefined) => Promise<void>
  ) {}
  get status(): KernelStatus["worker"] {
    return {
      pid: this.#worker?.child.pid,
      generation: this.#generation,
      state: this.#state,
      restart_attempt: this.#attempt
    };
  }
  get client() {
    if (this.#state !== "ready" || !this.#worker) throw new KernelError("KERNEL_UNAVAILABLE");
    return this.#worker.client;
  }
  async start(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    const abort = () => this.#abort.abort();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      await this.#spawn();
      signal?.throwIfAborted();
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }
  async #spawn(): Promise<void> {
    let worker: WorkerProcess;
    try {
      worker = await spawnWorker({
        ...this.options,
        signal: this.#abort.signal,
        onSpawn: async (child) => {
          await this.recordWorker?.(child.pid);
        }
      });
    } catch (error) {
      if (error instanceof AggregateError) this.#cleanupFailure = error;
      throw error;
    }
    if (this.#closing) {
      await worker.close();
      return;
    }
    this.#worker = worker;
    this.#generation++;
    this.#state = "ready";
    this.#stableSince = Date.now();
    this.#lastPong = Date.now();
    this.#pendingPing = false;
    worker.child.on("message", (message: unknown) => {
      if (
        this.#worker === worker &&
        message &&
        typeof message === "object" &&
        "type" in message &&
        message.type === "worker.pong"
      ) {
        this.#lastPong = Date.now();
        this.#pendingPing = false;
      }
    });
    worker.child.once("exit", () => this.#failed(worker));
    worker.child.once("error", () => this.#failed(worker));
    this.#timer = setInterval(() => {
      if (Date.now() - this.#lastPong >= 5000) {
        this.#failed(worker);
        return;
      }
      if (!this.#pendingPing && worker.child.connected) {
        this.#pendingPing = true;
        worker.child.send({ type: "kernel.ping" }, (error) => {
          if (error) this.#failed(worker);
        });
      }
    }, 1000);
    this.#timer.unref();
    if (worker.child.exitCode !== null || worker.child.signalCode !== null) this.#failed(worker);
  }
  #failed(worker: WorkerProcess): void {
    if (this.#closing || this.#worker !== worker || this.#state !== "ready") return;
    clearInterval(this.#timer);
    this.#state = "recovering";
    // 先拒绝原 RPC，让 Run 源生成唯一 lost 终态；恢复只允许新 Run。
    worker.client.close(new KernelError("WORKER_LOST"));
    if (Date.now() - this.#stableSince >= 60_000) {
      this.#attempts = [];
      this.#attempt = 0;
    }
    this.#recovery = this.#recover(worker).catch(() => {
      this.#state = "exhausted";
    });
  }
  async #recover(worker: WorkerProcess): Promise<void> {
    // 旧 worker 清理成功才允许替换，避免两个 Provider 实例并行持有同一执行资源。
    // 只恢复服务可用性，不重放旧 Run；旧流已由 #failed 标为 lost。
    await worker.close();
    await this.recordWorker?.(undefined);
    this.#worker = undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (this.#closing) return;
      this.#attempts = this.#attempts.filter((at) => Date.now() - at < 60_000);
      if (this.#attempts.length >= 3) break;
      const delay = [250, 1000, 4000][this.#attempts.length];
      this.#attempts.push(Date.now());
      this.#attempt++;
      await new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          this.#abort.signal.removeEventListener("abort", finish);
          resolve();
        };
        const timer = setTimeout(finish, delay);
        this.#abort.signal.addEventListener("abort", finish, { once: true });
      });
      if (this.#closing) return;
      try {
        await this.#spawn();
        return;
      } catch (error) {
        if (error instanceof AggregateError) throw error;
        /* 普通启动失败已回收；聚合清理错误禁止继续替换。 */
      }
    }
    this.#state = "exhausted";
  }
  async close(): Promise<void> {
    this.#closing = true;
    this.#abort.abort();
    clearInterval(this.#timer);
    await this.#recovery;
    await this.#worker?.close();
    if (this.#cleanupFailure) throw this.#cleanupFailure;
    await this.recordWorker?.(undefined);
    this.#state = "stopped";
  }
}
