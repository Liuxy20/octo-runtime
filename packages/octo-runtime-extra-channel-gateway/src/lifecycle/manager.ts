import type { ImBotConfig } from "../contracts.js";
import type { ImModuleDependencies } from "../ports.js";
import { ImRuntime } from "../application/im-channel.js";
import {
  abortForShutdown,
  shutdownDeadline,
  shutdownSignal,
  withShutdownDeadline,
  withinShutdown
} from "@mininglamp-oss/octo-runtime-host-sdk/shutdown";
import {
  imBotIdentity,
  validateImConfig,
  IM_MAX_BOTS,
  IM_MAX_CONFIG_OPERATIONS
} from "./configuration.js";

/** Serial updates replace only the target connection. */
export class ImChannelManager {
  readonly #endpoints = new Map<string, ImRuntime>();
  #queue: Promise<void> = Promise.resolve();
  #operations = 0;
  #closed = false;
  #closing?: Promise<void>;
  readonly #abort = new AbortController();
  constructor(readonly dependencies: ImModuleDependencies) {}
  get status(): Record<string, unknown>[] {
    return [...this.#endpoints.values()].map((runtime) => ({ ...runtime.status }));
  }
  upsert(config: ImBotConfig): Promise<Record<string, unknown>> {
    if (this.#closed) return Promise.reject(new Error("IM_MANAGER_CLOSED"));
    if (this.#operations >= IM_MAX_CONFIG_OPERATIONS)
      return Promise.reject(new Error("IM_CONFIG_QUEUE_CAPACITY_EXHAUSTED"));
    let snapshot: ImBotConfig;
    try {
      validateImConfig(config);
      snapshot = structuredClone(config);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error("IM_CONFIG_INVALID"));
    }
    return this.#enqueue(async () => {
      validateImConfig(snapshot);
      const key = imBotIdentity(snapshot);
      const current = this.#endpoints.get(key);
      if (!current && this.#endpoints.size >= IM_MAX_BOTS)
        throw new Error("IM_ENDPOINT_CAPACITY_EXHAUSTED");
      await current?.close();
      if (this.#closed) throw new Error("IM_MANAGER_CLOSED");
      const runtime = new ImRuntime(snapshot, {
        ...this.dependencies,
        signal: shutdownSignal([
          this.#abort.signal,
          ...(this.dependencies.signal ? [this.dependencies.signal] : [])
        ])
      });
      this.#endpoints.set(key, runtime);
      await runtime.start();
      return { ...runtime.status };
    });
  }
  remove(id: string): Promise<void> {
    return this.#enqueue(async () => {
      await this.#endpoints.get(id)?.close();
      this.#endpoints.delete(id);
    });
  }
  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (this.#closed) return Promise.reject(new Error("IM_MANAGER_CLOSED"));
    if (this.#operations >= IM_MAX_CONFIG_OPERATIONS)
      return Promise.reject(new Error("IM_CONFIG_QUEUE_CAPACITY_EXHAUSTED"));
    this.#operations++;
    const task = this.#queue
      .then(() => {
        if (this.#closed) throw new Error("IM_MANAGER_CLOSED");
        return operation();
      })
      .finally(() => {
        this.#operations--;
      });
    this.#queue = task.then(
      () => undefined,
      () => undefined
    );
    return task;
  }
  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    // Cancel initialization before waiting for the queue it is blocking.
    const until = shutdownDeadline(this.dependencies.signal);
    withShutdownDeadline(until, () => abortForShutdown(this.#abort));
    this.#closing = (async () => {
      const results = await Promise.allSettled([
        withinShutdown(this.#queue, until, "IM_DISPOSE_FAILED"),
        ...[...this.#endpoints.values()].map((runtime) =>
          withShutdownDeadline(until, () => Promise.resolve().then(() => runtime.close()))
        )
      ]);
      const errors = results
        .filter((result) => result.status === "rejected")
        .map((result): unknown => result.reason);
      if (errors.length) throw new AggregateError(errors, "IM_DISPOSE_FAILED");
      this.#endpoints.clear();
    })();
    return this.#closing;
  }
}
