import {
  closeWorker,
  spawnWorker,
  WorkerCleanupError,
  type SpawnWorkerOptions,
  type WorkerProcess
} from "./process.js";
import { noopRuntimeLog, type RuntimeLog } from "@mininglamp-oss/octo-runtime-adapter-sdk";
import type { KernelStatus } from "./types.js";
import { KernelError } from "./types.js";
import { WorkerHeartbeat } from "./heartbeat.js";

type Recovery = NonNullable<KernelStatus["worker"]["recovery"]>;

/** 监督所属 worker；清理阻塞持续重试，只恢复新请求，不重新执行已丢失的 Run。 */
export class WorkerSupervisor {
  #worker?: WorkerProcess;
  #generation = 0;
  #attempt = 0;
  #state: KernelStatus["worker"]["state"] = "starting";
  #closing = false;
  #recovery?: Promise<void>;
  #timer?: NodeJS.Timeout;
  #heartbeat?: WorkerHeartbeat;
  #activeTime = 0;
  #attempts: number[] = [];
  #slowRecovery = false;
  #abort = new AbortController();
  #cleanupFailure?: AggregateError;
  #closeUntil?: number;
  #diagnostic?: Recovery;
  constructor(
    private readonly options: SpawnWorkerOptions,
    private readonly recordWorker?: (pid: number | undefined) => Promise<void>,
    private readonly log: RuntimeLog = noopRuntimeLog
  ) {}
  get status(): KernelStatus["worker"] {
    return {
      pid: this.#worker?.child.pid,
      generation: this.#generation,
      state: this.#state,
      restart_attempt: this.#attempt,
      ...(this.#diagnostic ? { recovery: { ...this.#diagnostic } } : {})
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
  #emit(event: string, data: Record<string, unknown> = {}): void {
    // 宿主日志异常不得终止监督循环，错误正文和 worker stderr 不进入状态日志。
    try {
      this.log(event === "worker.ready" ? "info" : "warn", event, {
        pid: this.#worker?.child.pid,
        generation: this.#generation,
        attempt: this.#attempt,
        ...data
      });
    } catch {
      /* 日志不是恢复前置条件。 */
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
      if (error instanceof WorkerCleanupError) this.#cleanupFailure = error;
      throw error;
    }
    if (this.#closing) {
      try {
        await closeWorker(worker, this.#closeUntil ?? Date.now() + 5000, true);
      } catch (error) {
        throw (this.#cleanupFailure = new AggregateError([error], "WORKER_CLEANUP_INCOMPLETE"));
      }
      return;
    }
    this.#worker = worker;
    this.#generation++;
    this.#state = "ready";
    this.#diagnostic = undefined;
    this.#emit("worker.ready");
    const heartbeat = new WorkerHeartbeat();
    this.#heartbeat = heartbeat;
    let elapsed = 0;
    worker.child.on("message", (message: unknown) => {
      if (
        this.#worker === worker &&
        message &&
        typeof message === "object" &&
        "type" in message &&
        message.type === "worker.pong"
      )
        heartbeat.pong("probe" in message ? message.probe : undefined);
    });
    worker.child.once("exit", () => this.#failed(worker, "exit"));
    worker.child.once("error", () => this.#failed(worker, "error"));
    this.#timer = setInterval(() => {
      if (this.#closing || this.#worker !== worker || this.#state !== "ready") return;
      const probe = heartbeat.tick();
      this.#activeTime += heartbeat.activeMs - elapsed;
      elapsed = heartbeat.activeMs;
      if (probe.type === "expired") {
        this.#failed(worker, "heartbeat");
        return;
      }
      if (probe.type === "ping" && worker.child.connected)
        worker.child.send({ type: "kernel.ping", probe: probe.id }, (error) => {
          if (error) this.#failed(worker, "ipc");
        });
    }, 1000);
    this.#timer.unref();
    if (worker.child.exitCode !== null || worker.child.signalCode !== null)
      this.#failed(worker, "exit");
  }
  #failed(worker: WorkerProcess, trigger: Recovery["trigger"]): void {
    if (this.#closing || this.#worker !== worker || this.#state !== "ready") return;
    clearInterval(this.#timer);
    this.#state = "recovering";
    this.#diagnostic = {
      trigger,
      stage: "cleanup",
      code: "WORKER_LOST",
      occurred_at: new Date().toISOString(),
      ...(worker.child.exitCode !== null ? { exit_code: worker.child.exitCode } : {}),
      ...(worker.child.signalCode !== null ? { signal: worker.child.signalCode } : {})
    };
    this.#emit("worker.lost", this.#diagnostic);
    worker.client.close(new KernelError("WORKER_LOST"));
    // 连续健康运行才重置快速恢复预算；睡眠或仅仅等待不能洗掉连续故障。
    if ((this.#heartbeat?.healthyMs ?? 0) >= 60_000) {
      this.#attempts = [];
      this.#attempt = 0;
      this.#slowRecovery = false;
    }
    this.#recovery = this.#recover(worker).catch((error: unknown) => {
      this.#cleanupFailure = new AggregateError([error], "WORKER_RECOVERY_BLOCKED");
      if (!this.#closing) this.#state = "exhausted";
      this.#emit("worker.recovery_blocked", { code: failureCode(error) });
    });
  }
  async #wait(delay: number): Promise<void> {
    if (this.#abort.signal.aborted) return;
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        this.#abort.signal.removeEventListener("abort", finish);
        resolve();
      };
      const timer = setTimeout(finish, delay);
      this.#abort.signal.addEventListener("abort", finish, { once: true });
    });
  }
  /** 阻塞时单路按 1/2/5 秒重新确认；失败不洗掉记录，关闭会取消等待并保留未清理事实。 */
  async #retry(stage: "cleanup" | "manifest", operation: () => Promise<void>): Promise<boolean> {
    let retry = operation;
    let attempt = 0;
    while (!this.#closing) {
      try {
        await retry();
        this.#cleanupFailure = undefined;
        this.#state = "recovering";
        return true;
      } catch (error) {
        if (error instanceof WorkerCleanupError)
          retry = () => error.retryCleanup(Date.now() + 4800);
        this.#cleanupFailure =
          error instanceof AggregateError
            ? error
            : new AggregateError([error], "WORKER_RECOVERY_BLOCKED");
        if (this.#closing) return false;
        const delay = [1000, 2000, 5000][Math.min(attempt++, 2)];
        this.#state = "exhausted";
        this.#diagnostic = {
          ...this.#diagnostic!,
          stage,
          code: failureCode(error),
          retry_at: new Date(Date.now() + delay).toISOString()
        };
        this.#emit("worker.recovery_blocked", { ...this.#diagnostic, delay_ms: delay });
        await this.#wait(delay);
      }
    }
    return false;
  }
  async #recover(worker: WorkerProcess): Promise<void> {
    // 只在真实回收和清单写入都成功后放行替代；任何旧 Run 都不会重新 invoke。
    // Windows 在首次清理前已退出时沿用 skipped 路径；仍存活的故障 worker 不等待正常排空。
    // 已发生的清理失败继续由原 close Promise 和重试入口保留，不能因稍后退出而放行。
    if (
      !(await this.#retry("cleanup", () =>
        closeWorker(
          worker,
          Date.now() + 4800,
          worker.child.exitCode === null && worker.child.signalCode === null
        )
      ))
    )
      return;
    if (!(await this.#retry("manifest", () => this.recordWorker?.(undefined) ?? Promise.resolve())))
      return;
    this.#worker = undefined;
    while (!this.#closing) {
      this.#attempts = this.#attempts.filter((at) => this.#activeTime - at < 60_000);
      if (this.#attempts.length >= 3) this.#slowRecovery = true;
      const delay = this.#slowRecovery ? 15_000 : [250, 1000, 4000][this.#attempts.length];
      this.#diagnostic = {
        ...this.#diagnostic!,
        stage: "backoff",
        retry_at: new Date(Date.now() + delay).toISOString()
      };
      this.#emit("worker.retry_scheduled", { ...this.#diagnostic, delay_ms: delay });
      await this.#wait(delay);
      if (this.#closing) return;
      if (!this.#slowRecovery) this.#attempts.push(this.#activeTime);
      this.#attempt = Math.min(Number.MAX_SAFE_INTEGER, this.#attempt + 1);
      this.#diagnostic = { ...this.#diagnostic, stage: "starting" };
      delete this.#diagnostic.retry_at;
      try {
        await this.#spawn();
        return;
      } catch (error) {
        this.#diagnostic = { ...this.#diagnostic, code: failureCode(error) };
        this.#emit("worker.start_failed", {
          ...this.#diagnostic,
          ...(error instanceof WorkerCleanupError ? { pid: error.pid } : {})
        });
        if (error instanceof WorkerCleanupError) {
          if (!(await this.#retry("cleanup", () => Promise.reject(error)))) return;
          if (
            !(await this.#retry(
              "manifest",
              () => this.recordWorker?.(undefined) ?? Promise.resolve()
            ))
          )
            return;
        }
      }
    }
  }
  async close(until = Date.now() + 5000): Promise<void> {
    this.#closing = true;
    this.#closeUntil ??= until;
    this.#abort.abort();
    clearInterval(this.#timer);
    await this.#recovery;
    if (this.#worker) await closeWorker(this.#worker, this.#closeUntil);
    if (this.#cleanupFailure) throw this.#cleanupFailure;
    await this.recordWorker?.(undefined);
    this.#state = "stopped";
  }
}

function failureCode(error: unknown): string {
  // 聚合回收错误取其真实 cause；只输出稳定错误码，禁止输出异常正文或 stderr。
  for (let depth = 0; depth < 5 && error instanceof Error; depth++, error = error.cause) {
    const code = "code" in error ? error.code : undefined;
    if (typeof code === "string" && /^[A-Z][A-Z0-9_]{0,95}$/.test(code)) return code;
    if (!error.cause && /^[A-Z][A-Z0-9_]{0,95}$/.test(error.message)) return error.message;
  }
  return "WORKER_RECOVERY_FAILED";
}
