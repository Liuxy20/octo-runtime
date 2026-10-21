import { attachKernel } from "./client.js";
import { startKernelServer, type KernelServerOptions } from "./server.js";
import type { KernelClient, KernelStatus } from "./types.js";
import {
  beforeDeadline,
  ServiceInitializationError,
  type ServiceCleanupResult,
  type ServiceLifecycle,
  type ServicePhase
} from "./lifecycle.js";

export type KernelServiceOptions = KernelServerOptions;
export interface KernelServiceStatus {
  phase: ServicePhase;
  endpoint: string;
  pid: number;
  kernel?: KernelStatus;
}
export interface KernelService extends ServiceLifecycle<KernelServiceStatus> {
  readonly client: KernelClient;
}

/** 服务 socket 直接属于调用进程；只允许 server 内部创建执行 worker。 */
export function createKernelService(options: KernelServiceOptions): KernelService {
  const configuration = {
    ...options,
    adapterConfigurations:
      options.adapterConfigurations && structuredClone(options.adapterConfigurations),
    env: options.env && { ...options.env }
  };
  const owner = new AbortController();
  let phase: ServicePhase = "created";
  let server: Awaited<ReturnType<typeof startKernelServer>> | undefined;
  let client: KernelClient | undefined;
  let starting: Promise<void> | undefined;
  let initialized: Promise<void> | undefined;
  let startupFailure: unknown;
  let closing: Promise<ServiceCleanupResult> | undefined;
  let finishClosed!: (result: ServiceCleanupResult) => void;
  const closed = new Promise<ServiceCleanupResult>((resolve) => {
    finishClosed = resolve;
  });
  const close = (): Promise<ServiceCleanupResult> => {
    if (closing) return closing;
    phase = "closing";
    owner.abort();
    client?.close();
    closing = (async () => {
      const until = Date.now() + 5000;
      const errors: { resource: string; code: string }[] = [];
      try {
        await beforeDeadline(starting?.catch(() => undefined) ?? Promise.resolve(), until);
        if (startupFailure instanceof AggregateError) throw startupFailure;
        await beforeDeadline(server?.close(until) ?? Promise.resolve(), until);
      } catch {
        errors.push({ resource: "kernel", code: "KERNEL_CLEANUP_INCOMPLETE" });
      }
      phase = errors.length ? "failed" : "closed";
      const result = {
        complete: !errors.length,
        errors,
        pendingResources: errors.map((error) => error.resource)
      };
      finishClosed(result);
      return result;
    })();
    return closing;
  };
  return {
    closed,
    get client() {
      if (phase !== "ready" || !client) throw new Error("KERNEL_NOT_INITIALIZED");
      return client;
    },
    initialize({ signal } = {}) {
      if (initialized) return initialized;
      if (phase !== "created") return Promise.reject(new Error("SERVICE_CLOSED"));
      phase = "initializing";
      const combined = signal ? AbortSignal.any([owner.signal, signal]) : owner.signal;
      let onAbort!: () => void;
      const cancelled = new Promise<never>((_, reject) => {
        onAbort = () =>
          reject(
            combined.reason instanceof Error
              ? combined.reason
              : new Error("SERVICE_INITIALIZATION_CANCELLED", { cause: combined.reason })
          );
        combined.addEventListener("abort", onAbort, { once: true });
        if (combined.aborted) onAbort();
      });
      // 原 server 负责部分启动的回滚；初始化失败后仍保留其清理事实。
      starting = startKernelServer(configuration, combined)
        .then((value) => {
          server = value;
          combined.throwIfAborted();
          client = attachKernel({ endpoint: configuration.endpoint });
          phase = "ready";
        })
        .catch((error: unknown) => {
          startupFailure = error;
          if (!closing) phase = "failed";
          throw error;
        });
      initialized = Promise.race([starting, cancelled])
        .catch(async (error: unknown) => {
          throw new ServiceInitializationError(error, await close());
        })
        .finally(() => combined.removeEventListener("abort", onAbort));
      return initialized;
    },
    status: () =>
      Promise.resolve({
        phase,
        endpoint: configuration.endpoint,
        pid: process.pid,
        ...(server ? { kernel: server.status() } : {})
      }),
    close
  };
}
