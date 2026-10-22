import {
  closeWorker,
  spawnWorker,
  type SpawnWorkerOptions,
  type WorkerProcess
} from "./process.js";
import type { KernelStatus } from "./types.js";
import { KernelError } from "./types.js";
import { WorkerHeartbeat } from "./heartbeat.js";

/** Kernel exclusively owns worker replacement; incomplete cleanup prevents a second owner. */
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
      try {
        await closeWorker(worker, this.#closeUntil ?? Date.now() + 5000, true);
      } catch (error) {
        // A late startup still owns resources; failed rollback must block every future replacement.
        throw (this.#cleanupFailure = new AggregateError([error], "WORKER_CLEANUP_INCOMPLETE"));
      }
      return;
    }
    this.#worker = worker;
    this.#generation++;
    this.#state = "ready";
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
      ) {
        heartbeat.pong("probe" in message ? message.probe : undefined);
      }
    });
    worker.child.once("exit", () => this.#failed(worker));
    worker.child.once("error", () => this.#failed(worker));
    this.#timer = setInterval(() => {
      if (this.#closing || this.#worker !== worker || this.#state !== "ready") return;
      const probe = heartbeat.tick();
      this.#activeTime += heartbeat.activeMs - elapsed;
      elapsed = heartbeat.activeMs;
      if (probe.type === "expired") {
        this.#failed(worker);
        return;
      }
      if (probe.type === "ping" && worker.child.connected) {
        worker.child.send({ type: "kernel.ping", probe: probe.id }, (error) => {
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
    // Reject the old RPC first so its source emits one lost terminal. Recovery admits new work only.
    worker.client.close(new KernelError("WORKER_LOST"));
    if ((this.#heartbeat?.healthyMs ?? 0) >= 60_000) {
      this.#attempts = [];
      this.#attempt = 0;
      this.#slowRecovery = false;
    }
    this.#recovery = this.#recover(worker).catch((error: unknown) => {
      // Only unconfirmed cleanup or ownership ends recovery; ordinary startup failures stay retryable.
      this.#cleanupFailure ??= new AggregateError([error], "WORKER_RECOVERY_BLOCKED");
      if (!this.#closing) this.#state = "exhausted";
    });
  }
  async #recover(worker: WorkerProcess): Promise<void> {
    // Reap the old worker before replacement to prevent concurrent Provider owners.
    // Restore service availability only; #failed already marked old runs lost and never replays them.
    // Preserve baseline recovery for leaders that exited before close began. On Windows this
    // path cannot verify detached descendants; EOF-close checks require a live leader at entry.
    if (worker.child.exitCode !== null || worker.child.signalCode !== null) await worker.close();
    else await closeWorker(worker, Date.now() + 4800, true);
    await this.recordWorker?.(undefined);
    this.#worker = undefined;
    while (!this.#closing) {
      // Suspend time and clock changes must not replenish a recently exhausted restart budget.
      this.#attempts = this.#attempts.filter((at) => this.#activeTime - at < 60_000);
      if (this.#attempts.length >= 3) this.#slowRecovery = true;
      // Exhausting the fast budget opens a bounded-rate recovery loop, not a permanent outage.
      // Keep slow recovery across short-lived workers until 60 seconds of health is observed.
      const delay = this.#slowRecovery ? 15_000 : [250, 1000, 4000][this.#attempts.length];
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
      if (!this.#slowRecovery) this.#attempts.push(this.#activeTime);
      this.#attempt = Math.min(Number.MAX_SAFE_INTEGER, this.#attempt + 1);
      try {
        await this.#spawn();
        return;
      } catch (error) {
        if (error instanceof AggregateError) throw error;
        /* Ordinary startup failures are reaped; aggregate cleanup failures prevent replacement. */
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
