import { performance } from "node:perf_hooks";
import type { JsonObject } from "@mininglamp-oss/octo-runtime-host-sdk";
import { shutdownDeadline, withinShutdown } from "@mininglamp-oss/octo-runtime-host-sdk/shutdown";
import type { CreateSessionStore } from "../ports.js";
import type { ImSessionStore } from "./session-store.js";

const required = ["read", "save", "reset", "occurrence", "remember"] as const;
const optional = ["patchGap", "invalidateRules", "patchRules"] as const;

/**
 * 逐 Bot 的宿主句柄租约；先登记再创建，尾写结束或截止后撤权，再释放自己的句柄。
 * 不认识数据库，不关闭宿主连接；实际 close 和先前失败结果均不会被重复关闭覆盖。
 */
export class HostSessionStore {
  #release?: () => unknown;
  #creation?: Promise<void>;
  #closing?: Promise<void>;
  #invalidClose = false;
  #until = Infinity;
  #revoked = false;
  readonly #errors: unknown[] = [];
  readonly #stop = () => this.drain(shutdownDeadline(this.signal));

  constructor(readonly signal?: AbortSignal) {
    signal?.addEventListener("abort", this.#stop, { once: true });
    if (signal?.aborted) this.#stop();
  }

  /** 同步工厂只接受实现完整接口的对象；错误 Promise 仍跟踪迟到资源以便回收。 */
  create(factory: CreateSessionStore, config: JsonObject): ImSessionStore {
    let raw: unknown;
    try {
      raw = factory(config);
    } catch {
      throw new Error("IM_SESSION_STORE_FACTORY_FAILED");
    }
    this.#capture(raw);
    let asynchronous: boolean;
    try {
      asynchronous = !!raw && typeof (raw as PromiseLike<unknown>).then === "function";
    } catch {
      throw new Error("IM_SESSION_STORE_INVALID");
    }
    if (asynchronous) {
      this.#creation = Promise.resolve(raw).then(
        (value) => {
          this.#capture(value);
        },
        () => undefined
      );
      // 初始化可能立即回滚；这里消费 rejection，close 仍等待真实创建与释放。
      void this.#creation.catch(() => undefined);
      throw new Error("IM_SESSION_STORE_FACTORY_ASYNC");
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw new Error("IM_SESSION_STORE_INVALID");
    const view: Record<string, unknown> = {};
    try {
      for (const name of [...required, ...optional]) {
        const method: unknown = Reflect.get(raw, name);
        if (method === undefined && optional.some((key) => key === name)) continue;
        if (typeof method !== "function") throw new Error("IM_SESSION_STORE_INVALID");
        view[name] = (...args: unknown[]) => {
          if (this.#revoked || performance.now() >= this.#until)
            throw new Error("IM_SESSION_STORE_CLOSED");
          try {
            const result: unknown = Reflect.apply(method, raw, args);
            return result;
          } catch (error) {
            if (this.#until !== Infinity) this.#errors.push(error);
            throw error;
          }
        };
      }
      if (this.#invalidClose) throw new Error("IM_SESSION_STORE_INVALID");
    } catch {
      throw new Error("IM_SESSION_STORE_INVALID");
    }
    return Object.freeze(view) as unknown as ImSessionStore;
  }

  #capture(raw: unknown): void {
    if (!raw || (typeof raw !== "object" && typeof raw !== "function")) return;
    try {
      const close: unknown = Reflect.get(raw, "close");
      this.#invalidClose = close !== undefined && typeof close !== "function";
      if (typeof close === "function") this.#release = () => Reflect.apply(close, raw, []);
    } catch {
      this.#invalidClose = true;
      this.#errors.push(new Error("IM_SESSION_STORE_INVALID"));
    }
  }

  /** 与 Manager/Runtime 共用最早绝对期限；取消通知本身不禁止必要尾写。 */
  drain(until: number): void {
    this.#until = Math.min(this.#until, until);
  }

  close(until: number): Promise<void> {
    if (this.#closing) return this.#closing;
    this.drain(until);
    this.#revoked = true;
    this.signal?.removeEventListener("abort", this.#stop);
    // 先保存真实操作，超时只停止等待；迟到创建仍会继续执行一次句柄释放。
    const releasing = Promise.resolve().then(async () => {
      await this.#creation;
      await this.#release?.();
    });
    this.#closing = (async () => {
      try {
        await withinShutdown(releasing, this.#until, "IM_SESSION_STORE_CLOSE_INCOMPLETE");
      } catch (error) {
        this.#errors.push(error);
      }
      if (this.#errors.length)
        throw new AggregateError(this.#errors, "IM_SESSION_STORE_DISPOSE_FAILED");
    })();
    return this.#closing;
  }
}
