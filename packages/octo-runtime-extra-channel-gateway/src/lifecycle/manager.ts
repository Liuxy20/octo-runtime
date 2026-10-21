import type { ImBotConfig } from "../contracts.js";
import type { JsonObject } from "@mininglamp-oss/octo-runtime-host-sdk";
import type { ImChannelManagerDependencies } from "../ports.js";
import { ImRuntime } from "../application/im-channel.js";
import { HostSessionStore } from "../application/host-session-store.js";
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

interface Endpoint {
  runtime?: ImRuntime;
  store?: HostSessionStore;
  closing?: Promise<void>;
}

/** 串行替换单个 Bot；工厂句柄归 Manager，只有旧 endpoint 完整释放才允许替换。 */
export class ImChannelManager {
  readonly #endpoints = new Map<string, Endpoint>();
  #queue: Promise<void> = Promise.resolve();
  #operations = 0;
  #closed = false;
  #closing?: Promise<void>;
  readonly #abort = new AbortController();
  constructor(readonly dependencies: ImChannelManagerDependencies) {
    if (
      dependencies.createSessionStore !== undefined &&
      typeof dependencies.createSessionStore !== "function"
    )
      throw new Error("IM_SESSION_STORE_FACTORY_INVALID");
    if (dependencies.sessions && dependencies.createSessionStore)
      throw new Error("IM_SESSION_STORE_CONFLICT");
  }
  get status(): Record<string, unknown>[] {
    return [...this.#endpoints.values()].flatMap(({ runtime }) =>
      runtime ? [{ ...runtime.status }] : []
    );
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
      if (current) await this.#closeEndpoint(current);
      if (this.#closed) throw new Error("IM_MANAGER_CLOSED");
      const endpoint: Endpoint = {};
      // 工厂可能重入 close；先登记空 endpoint，随后创建的句柄也属于这次关闭。
      this.#endpoints.set(key, endpoint);
      const signal = shutdownSignal([
        this.#abort.signal,
        ...(this.dependencies.signal ? [this.dependencies.signal] : [])
      ]);
      try {
        let sessions = this.dependencies.sessions;
        if (snapshot.enabled !== false && this.dependencies.createSessionStore) {
          endpoint.store = new HostSessionStore(signal);
          sessions = endpoint.store.create(
            (config) => this.dependencies.createSessionStore!(config),
            structuredClone(snapshot) as unknown as JsonObject
          );
        }
        if (this.#closed || signal.aborted) throw new Error("IM_MANAGER_CLOSED");
        const runtime = new ImRuntime(snapshot, { ...this.dependencies, signal, sessions });
        endpoint.runtime = runtime;
        await runtime.start();
        return { ...runtime.status };
      } catch (error) {
        // 不能因构造或 start 失败遗失已分配句柄；清理失败时原记录继续阻止替换。
        try {
          await this.#closeEndpoint(endpoint);
          if (this.#endpoints.get(key) === endpoint) this.#endpoints.delete(key);
        } catch {
          throw new Error("IM_ENDPOINT_CLEANUP_INCOMPLETE", { cause: error });
        }
        throw error;
      }
    });
  }
  remove(id: string): Promise<void> {
    return this.#enqueue(async () => {
      const endpoint = this.#endpoints.get(id);
      if (endpoint) await this.#closeEndpoint(endpoint);
      this.#endpoints.delete(id);
    });
  }
  #closeEndpoint(
    endpoint: Endpoint,
    until = shutdownDeadline(this.dependencies.signal)
  ): Promise<void> {
    if (endpoint.closing) return endpoint.closing;
    endpoint.store?.drain(until);
    endpoint.closing = Promise.resolve().then(async () => {
      const errors: unknown[] = [];
      try {
        await withShutdownDeadline(until, () =>
          withinShutdown(
            Promise.resolve().then(() => endpoint.runtime?.close()),
            until,
            "IM_DISPOSE_FAILED"
          )
        );
      } catch (error) {
        errors.push(error);
      }
      try {
        await endpoint.store?.close(until);
      } catch (error) {
        errors.push(error);
      }
      if (errors.length) throw new AggregateError(errors, "IM_DISPOSE_FAILED");
    });
    return endpoint.closing;
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
    for (const endpoint of this.#endpoints.values()) endpoint.store?.drain(until);
    withShutdownDeadline(until, () => abortForShutdown(this.#abort));
    this.#closing = (async () => {
      const results = await Promise.allSettled([
        withinShutdown(this.#queue, until, "IM_DISPOSE_FAILED"),
        ...[...this.#endpoints.values()].map((endpoint) => this.#closeEndpoint(endpoint, until))
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
