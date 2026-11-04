import { attachKernel } from "./client.js";
import { dirname } from "node:path";
import {
  assertIpcEndpoint,
  kernelStartupPaths,
  validateRuntimeHome,
  prepareHomeDirectory
} from "./runtime-home.js";
import { startKernelServer, type KernelServerOptions } from "./server.js";
import type { KernelClient, KernelStatus } from "./types.js";
import {
  beforeDeadline,
  ServiceInitializationError,
  type ServiceCleanupResult,
  type ServiceLifecycle,
  type ServicePhase
} from "./lifecycle.js";

export interface KernelServiceOptions extends KernelServerOptions {
  /** 宿主选择并预先准备的绝对目录；SDK 不选择默认 Home 或创建根。 */
  home: string;
}
export interface KernelServiceStatus {
  phase: ServicePhase;
  endpoint: string;
  pid: number;
  kernel?: KernelStatus;
}
export interface KernelService extends ServiceLifecycle<KernelServiceStatus> {
  readonly client: KernelClient;
}

/**
 * 宿主传入已存在的 Home、本地 RPC 地址和已装配的 Adapter；initialize 校验后启动并开放 client。
 * socket、Core 和本服务创建的日志由 close 回收；宿主依赖仍由宿主拥有。
 * 即使与调用方同进程，client 也始终通过 RPC，不能绕过 Run 接纳和观察管理。
 */
export function createKernelService(options: KernelServiceOptions): KernelService {
  if (
    !options ||
    typeof options.endpoint !== "string" ||
    !options.endpoint ||
    !Array.isArray(options.adapters)
  )
    throw new TypeError("Kernel requires endpoint and adapters");
  // 旧 JS 接入不能静默退回文件加载或忽略 worker 环境；模块装配完全归宿主。
  for (const field of ["workerEntrypoint", "manifest", "adapterModules", "env"])
    if (field in options)
      throw new TypeError(`Kernel does not accept ${field}; compose adapters in the host`);
  const configuration = {
    ...options,
    adapters: [...(options.adapters as KernelServiceOptions["adapters"])],
    adapterConfigurations:
      options.adapterConfigurations && structuredClone(options.adapterConfigurations),
    logging: options.logging && { ...options.logging }
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
      starting = Promise.resolve()
        .then(async () => {
          combined.throwIfAborted();
          const home = validateRuntimeHome(
            configuration.home,
            kernelStartupPaths(
              configuration.endpoint,
              configuration.stateDirectory,
              configuration.logging?.directory
            )
          );
          assertIpcEndpoint(configuration.endpoint);
          if (process.platform !== "win32") {
            // 只为 Home 内的端点准备内部目录；自选外部 endpoint 的父目录由高级宿主准备。
            // helper 按完整 .. 路径分量判断边界，合法的 ..hidden 子目录仍属于 Home。
            prepareHomeDirectory(home, dirname(configuration.endpoint));
          }
          return startKernelServer(configuration, combined);
        })
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
          const cleanup = await close();
          // 取消可能先赢得 race，而实际启动回滚随后失败；等待 close 后再合并已确认的错误。
          // 保留最初取消原因和 server 的完整清理链，不把 incomplete 简化成只有取消原因。
          // 截止时仍未结束的回滚继续由 starting 观察，不改写已经返回的清理结果。
          const cause =
            startupFailure instanceof AggregateError && startupFailure !== error
              ? new AggregateError([error, startupFailure], "KERNEL_START_CLEANUP_INCOMPLETE", {
                  cause: error
                })
              : error;
          throw new ServiceInitializationError(cause, cleanup);
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
