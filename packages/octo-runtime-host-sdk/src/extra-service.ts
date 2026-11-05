import net from "node:net";
import { AgentExecutor } from "@mininglamp-oss/octo-runtime-executor-core";
import { performance } from "node:perf_hooks";
import { chmod, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  RuntimeLogging,
  readBoundedLines,
  type RuntimeLoggingOptions
} from "@mininglamp-oss/octo-runtime-adapter-sdk";
import {
  assertStartupLogging,
  acquireEndpoint,
  assertIpcEndpoint,
  assertRuntimePath,
  validateRuntimeHome,
  prepareHomeDirectory,
  runtimePathFailure,
  attachKernel,
  ServiceInitializationError,
  withStartupContext,
  type KernelClient,
  type ServiceCleanupResult,
  type ServiceLifecycle,
  type StartupContext,
  type ServicePhase
} from "@mininglamp-oss/octo-runtime-executor-kernel";
import {
  assertExtraName,
  ExtraPlugins,
  type ExtraPluginModule,
  type JsonObject
} from "./extras.js";
import { shutdownDeadline, withShutdownDeadline, withinShutdown } from "./shutdown.js";
import { snapshotExtraDependencies } from "./extra-dependencies.js";
import {
  createDirectExecutionScope,
  createIpcExecutionScope,
  type ExtraExecution,
  type ExtraExecutionScope
} from "./execution.js";

interface ExtraServiceCommonOptions<D extends object> {
  module: ExtraPluginModule<D>;
  config: JsonObject;
  dependencies: Readonly<D>;
  enabled?: boolean;
  controlEndpoint?: string;
  logging?: RuntimeLoggingOptions;
}
/** IPC/legacy 继续校验宿主 Home；direct 可以完全不配置 Home 和控制端点。 */
export type ExtraServiceOptions<D extends object = Record<string, never>> =
  ExtraServiceCommonOptions<D> &
    (
      | { execution: Extract<ExtraExecution, { kind: "direct" }>; endpoint?: never; home?: string }
      | { execution: Extract<ExtraExecution, { kind: "ipc" }>; endpoint?: never; home: string }
      | { execution?: never; endpoint: string; home: string }
    );
export interface ExtraServiceStatus {
  phase: ServicePhase;
  name: string;
  pid: number;
  execution: { kind: "direct" | "ipc"; available: boolean };
  kernel_available?: boolean;
  plugin: JsonObject;
}
export type ExtraService = ServiceLifecycle<ExtraServiceStatus>;

// 未确认清理的实例仍占有名称；不同 Kernel/Home 的同名 Extra 相互独立。
const owners = new Map<string, { failed: boolean }>();
const directOwners = new WeakMap<AgentExecutor, Map<string, { failed: boolean }>>();
let ownerCount = 0;

/** 装配插件与独立调用 scope；只借用宿主的 Core 或既有 Kernel，关闭不接管执行服务。 */
export function createExtraService<D extends object>(
  options: ExtraServiceOptions<D>
): ExtraService {
  try {
    return constructExtraService(options);
  } catch (error) {
    throw withStartupContext(error, {
      component: "extra",
      phase: "created",
      context: { operation: "validate-options", resource: "extra" }
    });
  }
}

function constructExtraService<D extends object>(options: ExtraServiceOptions<D>): ExtraService {
  // 以字段存在性拒绝混用，显式 undefined 不能绕过互斥；保存 executor 原对象身份。
  let execution: ExtraExecution;
  if ("execution" in options) {
    if ("endpoint" in options) throw new TypeError("EXTRA_EXECUTION_MIXED");
    const value = options.execution;
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new TypeError("EXTRA_EXECUTION_INVALID");
    if (value.kind === "direct") {
      if ("endpoint" in value || !(value.executor instanceof AgentExecutor))
        throw new TypeError(
          "EXTRA_EXECUTOR_INVALID: use the AgentExecutor exported by the same Runtime installation"
        );
      execution = { kind: "direct", executor: value.executor };
    } else if (value.kind === "ipc") {
      if ("executor" in value || typeof value.endpoint !== "string" || !value.endpoint)
        throw new TypeError("EXTRA_EXECUTION_INVALID");
      execution = { kind: "ipc", endpoint: value.endpoint };
    } else throw new TypeError("EXTRA_EXECUTION_INVALID");
  } else {
    if (typeof options.endpoint !== "string" || !options.endpoint)
      throw new TypeError("EXTRA_EXECUTION_REQUIRED");
    execution = { kind: "ipc", endpoint: options.endpoint };
  }
  assertExtraName(options.module.name);
  assertStartupLogging(options.logging, { component: options.module.name, phase: "created" });
  const name = options.module.name;
  const config = structuredClone(options.config);
  const module = { ...options.module };
  const pendingDependencies = new Set<Promise<unknown>>();
  const endpoint = execution.kind === "ipc" ? execution.endpoint : undefined;
  const home = options.home;
  const controlEndpoint = options.controlEndpoint;
  const enabled = options.enabled !== false;
  const logging = options.logging && { ...options.logging };
  let ownerships = owners;
  if (execution.kind === "direct") {
    ownerships = directOwners.get(execution.executor) ?? new Map<string, { failed: boolean }>();
    directOwners.set(execution.executor, ownerships);
  }
  const key =
    endpoint === undefined
      ? name
      : `${process.platform === "win32" ? endpoint.toLowerCase() : resolve(endpoint)}\0${name}`;
  const owner = new AbortController();
  let dependenciesOpen = true;
  let shutdownUntil: number | undefined;
  const dependencies = snapshotExtraDependencies(options.dependencies, (invoke) => (...args) => {
    // 取消通知不撤销尾部保存权限；清理完成或绝对截止后才禁止调用宿主函数。
    if (!dependenciesOpen || performance.now() >= (shutdownUntil ?? Infinity))
      throw new Error("EXTRA_DEPENDENCIES_CLOSED");
    if (pendingDependencies.size >= 128) throw new Error("EXTRA_DEPENDENCY_CAPACITY_EXHAUSTED");
    const result = invoke(...args);
    if (result && typeof (result as PromiseLike<unknown>).then === "function") {
      // 每次调用独立占额；宿主复用同一 Promise 时也不能绕过在途上限。
      const operation = Promise.resolve(result).then((value) => value);
      pendingDependencies.add(operation);
      void operation.finally(() => pendingDependencies.delete(operation)).catch(() => undefined);
    }
    return result;
  });
  const ownership = { failed: false };
  let acquired = false;
  let phase: ServicePhase = "created";
  let client: KernelClient | undefined;
  let scope: ExtraExecutionScope | undefined;
  let logs: RuntimeLogging | undefined;
  let plugins: ExtraPlugins | undefined;
  let starting: Promise<void> | undefined;
  let initialized: Promise<void> | undefined;
  let closing: Promise<ServiceCleanupResult> | undefined;
  let cleanupDeadline: number | undefined;
  let draining: Promise<void> | undefined;
  let server: net.Server | undefined;
  let binding: Promise<void> | undefined;
  let release: (() => Promise<void>) | undefined;
  let healthTimer: NodeJS.Timeout | undefined;
  let healthCheck: Promise<boolean> | undefined;
  let lastAvailable: boolean | undefined;
  const logState = (event: string, state: string, code?: string) =>
    logs?.extra(name)(code ? "warn" : "info", event, { state, ...(code ? { code } : {}) });
  const kernelAvailable = (): Promise<boolean> => {
    if (healthCheck) return healthCheck;
    healthCheck = (scope?.available() ?? Promise.resolve(false))
      .then((available) => {
        if (!owner.signal.aborted && available !== lastAvailable) {
          lastAvailable = available;
          logState(
            `${execution.kind === "ipc" ? "kernel" : "execution"}.${available ? "available" : "unavailable"}`,
            available ? "available" : "unavailable"
          );
        }
        return available;
      })
      .finally(() => {
        healthCheck = undefined;
      });
    return healthCheck;
  };
  const watchKernel = (): void => {
    // Allow one probe at a time and schedule after settlement; emit transitions, not idle heartbeats.
    void kernelAvailable().finally(() => {
      if (owner.signal.aborted || !logging) return;
      healthTimer = setTimeout(watchKernel, 5000);
      healthTimer.unref();
    });
  };
  const sockets = new Set<net.Socket>();
  let finishClosed!: (result: ServiceCleanupResult) => void;
  const closed = new Promise<ServiceCleanupResult>((resolve) => {
    finishClosed = resolve;
  });
  const status = async (): Promise<ExtraServiceStatus> => ({
    phase,
    name,
    pid: process.pid,
    execution: { kind: execution.kind, available: await kernelAvailable() },
    ...(execution.kind === "ipc" ? { kernel_available: await kernelAvailable() } : {}),
    plugin: !enabled
      ? { phase: "disabled" }
      : phase === "ready" && plugins
        ? await plugins.inspect(name)
        : { phase }
  });
  const drainRuns = async (): Promise<void> => {
    if (!scope) return;
    const result = await scope.drain({
      deadline: (cleanupDeadline ??= Date.now() + 5000),
      reason: "extra_shutdown"
    });
    if (!result.complete) throw new Error("EXTRA_RUN_CLEANUP_INCOMPLETE");
  };
  const beginDrain = (signal?: AbortSignal): Promise<void> => {
    shutdownUntil ??= shutdownDeadline(signal);
    cleanupDeadline ??= Date.now() + Math.max(0, Math.floor(shutdownUntil - performance.now()));
    scope?.stopAdmission();
    // 回滚通知先于加载器等待 disposer；立即取消源调用，避免消费者与清理互相等待。
    if (!draining) {
      draining = drainRuns();
      void draining.catch(() => undefined);
    }
    return draining;
  };
  const close = (): Promise<ServiceCleanupResult> => {
    if (closing) return closing;
    phase = "closing";
    logState("service.closing", phase);
    clearTimeout(healthTimer);
    shutdownUntil ??= shutdownDeadline();
    const draining = beginDrain();
    owner.abort();
    withShutdownDeadline(shutdownUntil, () => plugins?.stopAdmission());
    for (const socket of sockets) socket.destroy();
    closing = (async () => {
      const until = shutdownUntil;
      const errors: { resource: string; code: string }[] = [];
      const attempt = async (resource: string, operation: () => void | Promise<void>) => {
        try {
          await withinShutdown(Promise.resolve().then(operation), until, "EXTRA_CLEANUP_TIMEOUT");
        } catch {
          errors.push({ resource, code: "EXTRA_CLEANUP_INCOMPLETE" });
        }
      };
      await attempt("initialization", () => starting?.catch(() => undefined));
      // 插件先停业务准入并等待自己的消费者；与源调用排空并行，避免收尾互相等待。
      await Promise.all([
        attempt("runs", () => draining),
        attempt("plugin", async () => {
          try {
            await withShutdownDeadline(until, () => plugins?.close());
          } finally {
            dependenciesOpen = false;
          }
        })
      ]);
      dependenciesOpen = false;
      // 权限撤销后集合不再增长，才能完整等待清理中新开始的真实依赖操作。
      await attempt("dependencies", async () => {
        await Promise.allSettled([...pendingDependencies]);
      });
      await attempt("control-server", async () => {
        // 到期只结束等待；绑定稍后完成时，此操作仍须继续关闭迟到的监听句柄。
        await binding?.catch(() => undefined);
        if (server?.listening)
          await new Promise<void>((resolve, reject) => {
            server!.close((error) => (error ? reject(error) : resolve()));
          });
      });
      await attempt("execution", () => scope?.release());
      if (!errors.length)
        await attempt("control-endpoint", async () => {
          if (!release) return;
          if (controlEndpoint && process.platform !== "win32")
            await rm(controlEndpoint, { force: true });
          await release();
        });
      logState(
        errors.length ? "service.cleanup_incomplete" : "service.closed",
        errors.length ? "failed" : "closed",
        errors.length ? "EXTRA_CLEANUP_INCOMPLETE" : undefined
      );
      await attempt("logs", () => logs?.close());
      if (acquired) {
        if (errors.length) ownership.failed = true;
        else {
          ownerships.delete(key);
          ownerCount--;
        }
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
    status,
    close,
    closed,
    initialize({ signal } = {}) {
      if (initialized) return initialized;
      if (phase !== "created") return Promise.reject(new Error("SERVICE_CLOSED"));
      phase = "initializing";
      let onAbort!: () => void;
      const cancelled = new Promise<never>((_, reject) => {
        onAbort = () =>
          reject(
            owner.signal.reason instanceof Error
              ? owner.signal.reason
              : new Error("SERVICE_INITIALIZATION_CANCELLED", { cause: owner.signal.reason })
          );
        owner.signal.addEventListener("abort", onAbort, { once: true });
      });
      const abort = () => {
        shutdownUntil ??= shutdownDeadline();
        void beginDrain();
        owner.abort();
        withShutdownDeadline(shutdownUntil, () => plugins?.stopAdmission());
      };
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      let startupContext: StartupContext = { resource: "extra", operation: "initialize" };
      starting = (async () => {
        owner.signal.throwIfAborted();
        const paths = [
          ...(controlEndpoint && process.platform !== "win32"
            ? [{ path: `${controlEndpoint}.owner.recovery`, resource: "endpoint-ownership" }]
            : []),
          ...(logging
            ? [
                {
                  path: resolve(logging.directory, "extras", `${name}-status-20000101T00.log.lock`),
                  resource: "extra-log",
                  optional: true
                }
              ]
            : [])
        ];
        if (execution.kind === "ipc" || home !== undefined) validateRuntimeHome(home!, paths);
        else {
          // 没有隐式 Home；控制目录必须已由宿主准备，日志继续沿可选 best-effort 合同。
          if (controlEndpoint && process.platform !== "win32")
            validateRuntimeHome(dirname(controlEndpoint), paths);
          else for (const path of paths) assertRuntimePath(path.path, path.resource);
        }
        if (endpoint !== undefined) assertIpcEndpoint(endpoint);
        if (controlEndpoint) assertIpcEndpoint(controlEndpoint);
        const previous = ownerships.get(key);
        if (previous)
          throw new Error(previous.failed ? "EXTRA_DISPOSE_FAILED" : "EXTRA_ALREADY_LOADED");
        if (ownerCount >= 64) throw new Error("EXTRA_CAPACITY_EXHAUSTED");
        ownerships.set(key, ownership);
        ownerCount++;
        acquired = true;
        if (execution.kind === "ipc") {
          client = attachKernel({ endpoint: execution.endpoint });
          scope = createIpcExecutionScope(client);
        } else {
          if (!execution.executor.status().available) throw new Error("EXECUTOR_CLOSED");
          scope = createDirectExecutionScope(execution.executor);
        }
        logs = new RuntimeLogging(logging);
        logState("service.initializing", phase);
        if (logging) watchKernel();
        plugins = new ExtraPlugins(
          [],
          { execution: scope.context, ...(client ? { kernel: client } : {}) },
          () => logs!.extra(name)
        );
        if (enabled)
          await plugins.load(
            {
              ...module,
              default(context, config) {
                // 初始化失败先停准入并排空；不 abort owner，以保留加载器抛出的原始 cause。
                context.signal.addEventListener(
                  "abort",
                  () => {
                    void beginDrain(context.signal);
                  },
                  { once: true }
                );
                return module.default(context, config);
              }
            },
            config,
            dependencies
          );
        owner.signal.throwIfAborted();
        if (controlEndpoint) {
          startupContext = {
            resource: "extra-control",
            endpoint: controlEndpoint,
            operation: "listen"
          };
          if (process.platform !== "win32" && home !== undefined)
            prepareHomeDirectory(home, dirname(controlEndpoint));
          owner.signal.throwIfAborted();
          release = await acquireEndpoint(controlEndpoint);
          owner.signal.throwIfAborted();
          server = net.createServer((socket) => {
            if (owner.signal.aborted) {
              socket.destroy();
              return;
            }
            sockets.add(socket);
            socket.once("close", () => sockets.delete(socket));
            socket.on("error", () => socket.destroy());
            socket.setTimeout(5000, () => socket.destroy());
            const off = readBoundedLines(socket, 4096, {
              onError: () => socket.destroy(),
              onTooLarge: () => socket.destroy(),
              onClose() {},
              onLine(line) {
                off();
                try {
                  const request = JSON.parse(line) as { id?: string; method?: string };
                  if (request.method !== "status") throw new Error("METHOD_NOT_FOUND");
                  void status().then(
                    (value) =>
                      socket.end(
                        `${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { name, pid: process.pid, status: { ...value.plugin, execution: value.execution, ...(value.kernel_available === undefined ? {} : { kernel_available: value.kernel_available }) } } })}\n`
                      ),
                    () => socket.destroy()
                  );
                } catch {
                  socket.destroy();
                }
              }
            });
          });
          await (binding = new Promise<void>((resolve, reject) => {
            server!.once("error", reject);
            server!.listen(controlEndpoint, resolve);
          }));
          if (process.platform !== "win32") await chmod(controlEndpoint, 0o600);
          owner.signal.throwIfAborted();
        }
        phase = "ready";
        logState("service.ready", phase);
      })();
      initialized = Promise.race([starting, cancelled])
        .catch(async (error: unknown) => {
          const io = error as NodeJS.ErrnoException;
          if (
            startupContext.resource === "extra-control" &&
            ["ENOENT", "ENOTDIR", "EACCES", "EPERM", "EROFS", "ENAMETOOLONG"].includes(
              io?.code ?? ""
            )
          )
            error = runtimePathFailure(
              error,
              typeof io.path === "string" ? io.path : (controlEndpoint ?? home ?? ""),
              "extra-control",
              typeof io.syscall === "string" ? io.syscall : "listen"
            );
          logState("service.failed", "failed", "SERVICE_INITIALIZATION_FAILED");
          throw new ServiceInitializationError(error, await close(), {
            component: name,
            phase: "initializing",
            context: {
              endpoint: controlEndpoint ?? endpoint,
              ...startupContext
            }
          });
        })
        .finally(() => {
          signal?.removeEventListener("abort", abort);
          owner.signal.removeEventListener("abort", onAbort);
        });
      return initialized;
    }
  };
}
