import { randomUUID } from "node:crypto";
import {
  CONTEXT_SCHEMA,
  assertContextEnvelope,
  type ContextItem
} from "@mininglamp-oss/octo-runtime-protocol";
import { assertBoundedJson, type ChannelDependencies } from "./context-loader.js";
import type { JsonObject } from "./extras.js";

export interface DependencyChannel {
  send(message: object): void;
  on(listener: (message: unknown) => void): () => void;
}
interface Call {
  type: string;
  extra_instance_id: string;
  scope_epoch: string;
  call_id: string;
  method?: string;
  config?: JsonObject;
  remaining_ms?: number;
  items?: ContextItem[];
  error?: string;
}
function message(value: unknown, instance: string, epoch: string): Call | undefined {
  if (!value || typeof value !== "object") return;
  const item = value as Call;
  if (
    item.extra_instance_id !== instance ||
    item.scope_epoch !== epoch ||
    typeof item.call_id !== "string" ||
    item.call_id.length > 128 ||
    typeof item.type !== "string"
  )
    return;
  return item;
}
/** 容量归宿主函数的真实 Promise；调用方超时、断线、切换 scope 均不提前归还额度。 */
export class DependencyPool {
  readonly #calls = new Map<string, { abort: AbortController; task: Promise<void> }>();
  #closed = false;
  constructor(readonly capacity = 8) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 32)
      throw new Error("IM_CONTEXT_LOADING_CONFIG_INVALID");
  }
  bind(
    channel: DependencyChannel,
    instance: string,
    epoch: string,
    dependencies: ChannelDependencies
  ) {
    const owned = new Set<string>();
    let connected = true;
    const send = (value: Call) => {
      if (connected) channel.send(value);
    };
    const off = channel.on((value) => {
      const call = message(value, instance, epoch);
      if (!call) return;
      const key = `${instance}/${epoch}/${call.call_id}`;
      if (call.type === "dependency.cancel") {
        this.#calls.get(key)?.abort.abort();
        return;
      }
      if (call.type !== "dependency.call" || this.#calls.has(key)) return;
      const reply = (error: string) =>
        send({ ...identity(call), type: "dependency.result", error });
      if (this.#closed || !dependencies.loadContexts) {
        reply("DEPENDENCY_DISCONNECTED");
        return;
      }
      if (this.#calls.size >= this.capacity) {
        reply("IM_CONTEXT_LOADING_BUSY");
        return;
      }
      if (
        call.method !== "loadContexts" ||
        !call.config ||
        typeof call.remaining_ms !== "number" ||
        call.remaining_ms < 1 ||
        call.remaining_ms > 30_000 ||
        Buffer.byteLength(JSON.stringify(call)) > 1024 * 1024 + 4096
      ) {
        reply("IM_CONTEXT_RESULT_INVALID");
        return;
      }
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), call.remaining_ms);
      const task = Promise.resolve().then(async () => {
        try {
          abort.signal.throwIfAborted();
          const items = await dependencies.loadContexts!(structuredClone(call.config!), {
            signal: abort.signal
          });
          abort.signal.throwIfAborted();
          assertBoundedJson(items);
          assertContextEnvelope({ schema: CONTEXT_SCHEMA, items });
          send({
            ...identity(call),
            type: "dependency.result",
            items: structuredClone(items) as ContextItem[]
          });
        } catch (error) {
          reply(
            abort.signal.aborted
              ? "IM_CONTEXT_LOADING_CANCELLED"
              : error instanceof Error && /^IM_CONTEXT_[A-Z_]+$/.test(error.message)
                ? error.message
                : "IM_CONTEXT_RESULT_INVALID"
          );
        } finally {
          clearTimeout(timer);
          this.#calls.delete(key);
          owned.delete(key);
          send({ ...identity(call), type: "dependency.settled" });
        }
      });
      this.#calls.set(key, { abort, task });
      owned.add(key);
      void task.catch(() => undefined);
    });
    return () => {
      connected = false;
      off();
      for (const key of owned) this.#calls.get(key)?.abort.abort();
    };
  }
  async close(): Promise<void> {
    this.#closed = true;
    for (const call of this.#calls.values()) call.abort.abort();
    await Promise.allSettled([...this.#calls.values()].map((call) => call.task));
  }
  get inFlight(): number {
    return this.#calls.size;
  }
}
function identity(call: Call): Call {
  return {
    type: call.type,
    extra_instance_id: call.extra_instance_id,
    scope_epoch: call.scope_epoch,
    call_id: call.call_id
  };
}

export function createDependencyProxy(
  channel: DependencyChannel,
  instance: string,
  epoch: string,
  timeoutMs = 5000
): ChannelDependencies & { close(): void } {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000)
    throw new Error("IM_CONTEXT_LOADING_CONFIG_INVALID");
  const pending = new Map<string, { finish(error?: Error, items?: ContextItem[]): void }>();
  const tombstones = new Set<string>();
  let closed = false;
  const off = channel.on((value) => {
    const call = message(value, instance, epoch);
    if (!call) return;
    if (call.type === "dependency.settled") {
      tombstones.delete(call.call_id);
      return;
    }
    if (call.type !== "dependency.result") return;
    const entry = pending.get(call.call_id);
    if (!entry) return;
    if (call.error) entry.finish(new Error(call.error));
    else {
      try {
        assertBoundedJson(call.items);
        assertContextEnvelope({ schema: CONTEXT_SCHEMA, items: call.items });
        entry.finish(undefined, call.items);
      } catch {
        entry.finish(new Error("IM_CONTEXT_RESULT_INVALID"));
      }
    }
  });
  return {
    loadContexts: (config, { signal }) =>
      new Promise<ContextItem[]>((resolve, reject) => {
        if (closed) {
          reject(new Error("DEPENDENCY_DISCONNECTED"));
          return;
        }
        if (signal.aborted) {
          reject(new Error("IM_CONTEXT_LOADING_CANCELLED"));
          return;
        }
        if (pending.size + tombstones.size >= 32) {
          reject(new Error("IM_CONTEXT_LOADING_BUSY"));
          return;
        }
        const id = randomUUID();
        const base = { extra_instance_id: instance, scope_epoch: epoch, call_id: id };
        const finish = (error?: Error, items?: ContextItem[]) => {
          if (!pending.delete(id)) return;
          clearTimeout(timer);
          signal.removeEventListener("abort", cancel);
          if (error) {
            if (
              ["IM_CONTEXT_LOADING_CANCELLED", "IM_CONTEXT_LOADING_TIMEOUT"].includes(error.message)
            )
              tombstones.add(id);
            reject(error);
          } else resolve(items!);
        };
        const cancel = () => {
          channel.send({ ...base, type: "dependency.cancel" });
          finish(new Error("IM_CONTEXT_LOADING_CANCELLED"));
        };
        const timer = setTimeout(() => {
          channel.send({ ...base, type: "dependency.cancel" });
          finish(new Error("IM_CONTEXT_LOADING_TIMEOUT"));
        }, timeoutMs);
        pending.set(id, { finish });
        signal.addEventListener("abort", cancel, { once: true });
        try {
          channel.send({
            ...base,
            type: "dependency.call",
            method: "loadContexts",
            remaining_ms: timeoutMs,
            config
          });
        } catch {
          finish(new Error("DEPENDENCY_DISCONNECTED"));
        }
      }),
    close() {
      closed = true;
      off();
      for (const entry of pending.values()) entry.finish(new Error("DEPENDENCY_DISCONNECTED"));
    }
  };
}
