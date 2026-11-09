import { assertStartupLogging } from "./startup-logging.js";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { chmod, rm } from "node:fs/promises";
import { join } from "node:path";
import { assertIpcEndpoint, runtimePathFailure } from "./runtime-home.js";
import {
  readBoundedLines,
  RuntimeLogging,
  type RuntimeLoggingOptions,
  type AdapterProbeOptions
} from "@mininglamp-oss/octo-runtime-adapter-sdk";
import {
  assertHostRunReceipt,
  assertServiceProcessSnapshot,
  createInputInvoke,
  contextItem,
  INVOKE_REQUEST_MAX_BYTES,
  HOST_RPC_MAX_LINE_BYTES,
  KERNEL_IPC_VERSION,
  resolveStreamLimitPolicy,
  type InvokeInput,
  type InvokeEnvironment,
  type ServiceProcessSnapshot
} from "@mininglamp-oss/octo-runtime-protocol";
import { HostRunService } from "./host-run-service.js";
import { AgentExecutor, type HostedAdapter } from "@mininglamp-oss/octo-runtime-executor-core";
import { beforeDeadline } from "./lifecycle.js";
import { withStartupContext, type StartupContext } from "./startup-diagnostics.js";
import { probeOptions, type ExecutionSource } from "./execution-source.js";
import { acquireEndpoint } from "./endpoint.js";
import { InvocationManifest } from "./invocation-manifest.js";
import {
  KernelError,
  type LookupKey,
  type RunRef,
  type RunSnapshot,
  type KernelStatus
} from "./types.js";

export interface KernelServerOptions {
  endpoint: string;
  /** 宿主已 import/构造的实例；保留对象身份，不跨进程序列化。 */
  adapters: readonly HostedAdapter[];
  /** 宿主拥有的服务只读快照；Kernel 不因此获得关闭或恢复权。 */
  serviceProcesses?: () => readonly ServiceProcessSnapshot[];
  /** 宿主显式收尾回调：Core 排空后、所有权证据释放前调用；失败须抛出。deadline 为 performance.now() 绝对毫秒。 */
  finalizeHostResources?: (deadline: number) => Promise<void>;
  adapterConfigurations?: Record<string, AdapterProbeOptions>;
  stateDirectory?: string;
  /** 记录 Kernel/Core 的生命周期；调用方选择日志目录。 */
  logging?: RuntimeLoggingOptions;
  configurations?: (runtimeId?: string) => Record<string, AdapterProbeOptions>;
}

function validateParams(method: string, params: Record<string, unknown>): void {
  const fields: Record<string, string[]> = {
    status: [],
    "adapter.list": [],
    "agent_run.invoke": ["input", "executionEnvOverrides", "kernel_instance_id"],
    "agent_run.get": ["key", "kernel_instance_id"],
    "agent_run.subscribe": ["ref", "after_seq"],
    "agent_run.cancel": ["ref", "reason"],
    "agent_run.respond": ["ref", "response"],
    "agent_run.native.respond": ["ref", "response"]
  };
  const allowed = fields[method];
  if (!allowed) throw new KernelError("METHOD_NOT_FOUND");
  if (Object.keys(params).some((key) => !allowed.includes(key)))
    throw new KernelError("INVALID_PARAMS");
  if (
    method === "agent_run.invoke" &&
    (!record(params.input) ||
      (params.executionEnvOverrides !== undefined && !record(params.executionEnvOverrides)))
  )
    throw new KernelError("INVALID_PARAMS");
  if (method === "agent_run.get") {
    const key = params.key;
    if (
      !record(key) ||
      Object.keys(key).length !== 5 ||
      Object.keys(key).some(
        (field) =>
          ![
            "run_id",
            "invocation_id",
            "agent_session_id",
            "session_generation",
            "protocol_mode"
          ].includes(field)
      ) ||
      ["run_id", "invocation_id", "agent_session_id"].some(
        (field) => typeof key[field] !== "string" || !key[field]
      ) ||
      !Number.isSafeInteger(key.session_generation) ||
      Number(key.session_generation) < 0 ||
      !["native", "canonical"].includes(String(key.protocol_mode)) ||
      (params.kernel_instance_id !== undefined && typeof params.kernel_instance_id !== "string")
    )
      throw new KernelError("INVALID_PARAMS");
  }
  if (allowed.includes("ref")) {
    if (
      !record(params.ref) ||
      typeof params.ref.kernel_instance_id !== "string" ||
      !params.ref.kernel_instance_id
    )
      throw new KernelError("INVALID_PARAMS");
    const { kernel_instance_id: instance, ...receipt } = params.ref;
    void instance;
    try {
      assertHostRunReceipt(receipt);
    } catch {
      throw new KernelError("INVALID_PARAMS");
    }
  }
  if (allowed.includes("response") && !record(params.response))
    throw new KernelError("INVALID_PARAMS");
  if (params.reason !== undefined && typeof params.reason !== "string")
    throw new KernelError("INVALID_PARAMS");
}

/**
 * 在宿主进程创建本地 RPC 端点，独占端点租约、Run 事件源和 AgentExecutor。
 * 启动失败也执行回收；close 失败会保留所有权证据，客户端断开不等同于 owner 关闭。
 */
export async function startKernelServer(options: KernelServerOptions, signal?: AbortSignal) {
  assertIpcEndpoint(options.endpoint);
  assertStartupLogging(options.logging, { component: "executor-kernel", phase: "initializing" });
  const instance = randomUUID();
  const logging = new RuntimeLogging(options.logging);
  let manifest: InvocationManifest | undefined;
  const executor = new AgentExecutor({ log: logging.kernel });
  let ready = false;
  // 每轮只读取一次宿主配置；复制后冻结自有快照，不冻结宿主持有的原对象。
  const configure = (input: InvokeInput) => {
    const type = contextItem(input.agentEnv, "octo.execution", "adapter")?.payload.type;
    const config = probeOptions(
      (options.configurations?.(
        typeof input.runMetadata?.runtimeId === "string" ? input.runMetadata.runtimeId : undefined
      ) ?? options.adapterConfigurations)?.[typeof type === "string" ? type : "codex"]
    );
    return (
      config &&
      Object.freeze({
        providerOptions: config.providerOptions && Object.freeze({ ...config.providerOptions }),
        streamLimits: resolveStreamLimitPolicy(config.streamLimits)
      })
    );
  };
  const transport: ExecutionSource = {
    list: (configs) =>
      executor.describe(configs ?? options.configurations?.() ?? options.adapterConfigurations),
    probe: (type, config) => Promise.resolve().then(() => executor.probe(type, config)),
    cancel: (id, reason) =>
      Promise.resolve().then(() => ({ cancelled: executor.cancel(id, reason) })),
    respondInteraction: (id, response) => executor.respondInteraction(id, response),
    respondNative: (id, response) => executor.respondNative(id, response),
    invoke: createInputInvoke((input, environment) => transport.invokeFrames(input, environment)),
    invokeFrames: (input, environment) => executor.invokeFrames(input, environment)
  };
  const runs = new HostRunService(transport);
  const sockets = new Set<net.Socket>();
  let closing: Promise<void> | undefined;
  let listening = false;
  let releaseEndpoint: (() => Promise<void>) | undefined;
  // 宿主快照只参与诊断；校验并复制，绝不把可变对象或控制句柄交给 IPC。
  const serviceProcesses = () => {
    const snapshots = [...executor.processes(), ...(options.serviceProcesses?.() ?? [])];
    if (snapshots.length > 256) throw new Error("SERVICE_PROCESS_SNAPSHOT_LIMIT");
    for (const snapshot of snapshots) assertServiceProcessSnapshot(snapshot);
    return snapshots.map((snapshot) => ({ ...snapshot }));
  };
  const status = (): KernelStatus => ({
    ipc_version: KERNEL_IPC_VERSION,
    kernel_instance_id: instance,
    pid: process.pid,
    execution_ready: !closing && ready,
    service_processes: serviceProcesses()
  });
  const snapshot = (key: LookupKey, expected?: string): RunSnapshot => {
    if (expected !== undefined && expected !== instance)
      throw new KernelError("KERNEL_INSTANCE_CHANGED");
    if (!key || typeof key !== "object" || typeof key.run_id !== "string")
      throw new KernelError("INVALID_PARAMS");
    const { oldest_seq, latest_seq, terminal, ...receipt } = runs.get(key.run_id);
    for (const field of [
      "run_id",
      "invocation_id",
      "agent_session_id",
      "session_generation",
      "protocol_mode"
    ] as const) {
      if (key[field] !== receipt[field]) throw new KernelError("RUN_IDENTITY_MISMATCH");
    }
    return {
      ref: { ...receipt, kernel_instance_id: instance },
      oldest_seq,
      latest_seq,
      ...(terminal ? { terminal } : {})
    };
  };
  const validateRef = (value: unknown): RunSnapshot => {
    const ref = value as RunRef;
    if (!ref || typeof ref.kernel_instance_id !== "string") throw new KernelError("INVALID_PARAMS");
    const result = snapshot(ref, ref.kernel_instance_id);
    if (ref.stream_id !== result.ref.stream_id || ref.protocol !== result.ref.protocol)
      throw new KernelError("RUN_IDENTITY_MISMATCH");
    return result;
  };
  const handle = async (line: string, socket: net.Socket): Promise<void> => {
    let id: string | null = null;
    let streaming = false;
    try {
      let request: unknown;
      try {
        request = JSON.parse(line);
      } catch {
        throw new KernelError("PARSE_ERROR");
      }
      if (
        !record(request) ||
        request.jsonrpc !== "2.0" ||
        typeof request.id !== "string" ||
        !request.id ||
        Buffer.byteLength(request.id) > 128 ||
        typeof request.method !== "string"
      )
        throw new KernelError("INVALID_REQUEST");
      id = request.id;
      if (
        Object.keys(request).some((key) => !["jsonrpc", "id", "method", "params"].includes(key)) ||
        !record(request.params)
      )
        throw new KernelError("INVALID_PARAMS");
      const params = request.params;
      validateParams(request.method, params);
      let result: unknown;
      switch (request.method) {
        case "status":
          result = status();
          break;
        case "adapter.list":
          result = await runs.list();
          break;
        case "agent_run.invoke": {
          if (params.kernel_instance_id !== undefined && params.kernel_instance_id !== instance)
            throw new KernelError("KERNEL_INSTANCE_CHANGED");
          // 此处尚未调用执行源；专用证据只标记本次拒绝，不能推广到已接纳或 ACK 未知的请求。
          if (!status().execution_ready)
            throw new KernelError("KERNEL_UNAVAILABLE", { invocation_not_submitted: true });
          const input = params.input as InvokeInput;
          const config = configure(input);
          // 连接选项走本地调用环境；调用方的 AgentEnv 保序透传。
          const receipt = await runs.submit(input, {
            providerOptions: config?.providerOptions,
            streamLimits: config?.streamLimits,
            executionEnvOverrides:
              params.executionEnvOverrides as InvokeEnvironment["executionEnvOverrides"]
          });
          result = { kernel_instance_id: instance, receipt };
          break;
        }
        case "agent_run.get":
          result = snapshot(
            params.key as LookupKey,
            params.kernel_instance_id as string | undefined
          );
          break;
        case "agent_run.subscribe": {
          const info = validateRef(params.ref);
          if (typeof params.after_seq !== "number") throw new KernelError("STREAM_CURSOR_INVALID");
          let after = params.after_seq;
          // 先校验 cursor 再发送 ACK，避免错误被解释成空订阅成功。
          runs.read(info.ref.run_id, info.ref.stream_id, after);
          const release = runs.acquireSubscription();
          try {
            await write(socket, { jsonrpc: "2.0", id, result: info });
            streaming = true;
            while (!socket.destroyed) {
              const page = runs.read(info.ref.run_id, info.ref.stream_id, after);
              for (const event of page.events) {
                await write(socket, {
                  jsonrpc: "2.0",
                  method: "agent_run.event",
                  params: {
                    kernel_instance_id: instance,
                    run_id: info.ref.run_id,
                    stream_id: info.ref.stream_id,
                    seq: event.seq,
                    event: event.event
                  }
                });
                after = event.seq;
              }
              if (page.terminal && after >= page.latest_seq) {
                socket.end();
                return;
              }
              if (!page.events.length)
                await new Promise<void>((resolve) => {
                  const done = () => {
                    clearTimeout(timer);
                    socket.off("close", done);
                    resolve();
                  };
                  const timer = setTimeout(done, 25);
                  socket.once("close", done);
                });
            }
          } finally {
            release();
          }
          return;
        }
        case "agent_run.cancel": {
          const info = validateRef(params.ref);
          const response = info.terminal
            ? { cancelled: false }
            : await runs.cancelRun(
                info.ref.run_id,
                typeof params.reason === "string" ? params.reason : undefined
              );
          result = { accepted: response.cancelled };
          break;
        }
        case "agent_run.respond": {
          const info = validateRef(params.ref);
          await runs.respond(
            info.ref.run_id,
            params.response as Parameters<HostRunService["respond"]>[1]
          );
          result = {};
          break;
        }
        case "agent_run.native.respond": {
          const info = validateRef(params.ref);
          await runs.respondNativeRun(
            info.ref.run_id,
            params.response as Parameters<HostRunService["respondNativeRun"]>[1]
          );
          result = {};
          break;
        }
        default:
          throw new KernelError("METHOD_NOT_FOUND");
      }
      await write(socket, { jsonrpc: "2.0", id, result });
      socket.end();
    } catch (error) {
      const code = safeCode(error);
      const rpcCode =
        (
          {
            PARSE_ERROR: -32700,
            INVALID_REQUEST: -32600,
            METHOD_NOT_FOUND: -32601,
            INVALID_PARAMS: -32602
          } as Record<string, number>
        )[code] ?? -32001;
      if (!socket.destroyed) {
        await write(
          socket,
          streaming
            ? {
                jsonrpc: "2.0",
                method: "agent_run.stream_error",
                params: { code, kernel_instance_id: instance }
              }
            : {
                jsonrpc: "2.0",
                id,
                error: {
                  code: rpcCode,
                  message: "Kernel request failed",
                  data: {
                    code,
                    // Core 错误使用 camelCase 属性；此处转换为公开 socket 协议字段，client 保留整个 data。
                    ...(code === "ASYNC_ANSWER_REJECTED" &&
                    record(error) &&
                    Number.isSafeInteger(error.providerRpcCode)
                      ? { provider_rpc_code: error.providerRpcCode }
                      : {}),
                    ...(error instanceof KernelError &&
                    error.data?.invocation_not_submitted === true
                      ? { invocation_not_submitted: true, kernel_instance_id: instance }
                      : {})
                  }
                }
              }
        ).catch(() => undefined);
        socket.end();
      }
    }
  };
  const server = net.createServer((socket) => {
    socket.on("error", () => socket.destroy());
    if (sockets.size >= 64) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.setTimeout(5000, () => socket.destroy());
    const stop = readBoundedLines(socket, INVOKE_REQUEST_MAX_BYTES, {
      onError: () => socket.destroy(),
      onClose: () => {},
      onTooLarge: () => socket.destroy(),
      onLine: (line) => {
        stop();
        socket.pause();
        socket.setTimeout(0);
        void handle(line, socket);
      }
    });
  });
  const teardown = async (until = Date.now() + 5000): Promise<void> => {
    ready = false;
    logging.kernel("info", "kernel.closing", { pid: process.pid });
    runs.beginDrain();
    for (const socket of sockets) socket.destroy();
    const errors: unknown[] = [];
    const attempt = async (operation: () => Promise<unknown>) => {
      try {
        await beforeDeadline(operation(), until);
        return true;
      } catch (error) {
        errors.push(error);
        return false;
      }
    };
    if (listening)
      await attempt(() => new Promise<void>((resolve) => server.close(() => resolve())));
    // 先停接纳，再取消 Core 并等待 Adapter finally；终态不代替资源释放确认。
    // 同进程不能强杀阻塞的 JS。所有等待共享绝对期限，超时保留所有权证据。
    const executorStopped = await attempt(async () => {
      const result = await executor.shutdown(
        "Kernel shutdown",
        Math.max(1, until - Date.now() - 1200)
      );
      if (result.cleanup !== "complete") throw new Error("EXECUTOR_CLEANUP_INCOMPLETE");
    });
    await attempt(() => beforeDeadline(runs.close(), until - 1000));
    await attempt(
      () =>
        options.finalizeHostResources?.(performance.now() + Math.max(0, until - Date.now())) ??
        Promise.resolve()
    );
    // 原生日志由同一 owner 持有：Core/finally 排空后才关闭，且仍只用原截止时间。
    logging.kernel(
      errors.length ? "error" : "info",
      errors.length ? "kernel.cleanup_incomplete" : "kernel.execution_drained",
      errors.length ? { code: "KERNEL_CLEANUP_INCOMPLETE" } : { pid: process.pid }
    );
    await attempt(() => logging.close());
    if (executorStopped && !errors.length) {
      await attempt(() => manifest?.close() ?? Promise.resolve());
      if (listening && process.platform !== "win32")
        await attempt(() => rm(options.endpoint, { force: true }));
      if (!errors.length) await attempt(() => releaseEndpoint?.() ?? Promise.resolve());
    }
    if (errors.length) {
      // 原生宿主仍存活时也必须暴露真实关闭失败；持久化失败不能覆盖原清理原因。
      await attempt(() => manifest?.markCleanupIncomplete() ?? Promise.resolve());
      throw new AggregateError(errors, "KERNEL_CLEANUP_INCOMPLETE");
    }
  };
  let startupContext: StartupContext = { operation: "register-adapters", configKey: "adapters" };
  try {
    signal?.throwIfAborted();
    for (const adapter of options.adapters) {
      executor.register(adapter);
      logging.kernel("info", "adapter.registered", { adapter_type: adapter.metadata.type });
    }
    startupContext = {
      resource: "ipc-endpoint",
      endpoint: options.endpoint,
      operation: "acquire-endpoint"
    };
    signal?.throwIfAborted();
    releaseEndpoint = await acquireEndpoint(options.endpoint);
    signal?.throwIfAborted();
    const statePath = options.stateDirectory
      ? join(options.stateDirectory, "kernel-invocations.json")
      : process.platform !== "win32"
        ? `${options.endpoint}.runs`
        : undefined;
    if (statePath) {
      startupContext = { resource: "kernel-state", path: statePath, operation: "open-manifest" };
      manifest = (await InvocationManifest.open(statePath)).manifest;
      await manifest.markNativeOwner();
    }
    signal?.throwIfAborted();
    startupContext = { resource: "ipc-endpoint", endpoint: options.endpoint, operation: "listen" };
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.endpoint, () => {
        listening = true;
        resolve();
      });
    });
    signal?.throwIfAborted();
    if (process.platform !== "win32") await chmod(options.endpoint, 0o600);
    signal?.throwIfAborted();
    ready = true;
    logging.kernel("info", "kernel.ready", { pid: process.pid });
  } catch (cause) {
    const io = cause as NodeJS.ErrnoException;
    const error =
      startupContext.resource &&
      ["ipc-endpoint", "kernel-state"].includes(startupContext.resource) &&
      ["ENOENT", "ENOTDIR", "EACCES", "EPERM", "EROFS", "ENAMETOOLONG"].includes(io?.code ?? "")
        ? runtimePathFailure(
            cause,
            typeof io.path === "string" ? io.path : (startupContext.path ?? options.endpoint),
            startupContext.resource,
            typeof io.syscall === "string" ? io.syscall : "listen"
          )
        : cause;
    // 附加已确认的启动步骤，不改变原错误类型、公共码或底层 cause。
    withStartupContext(error, {
      component: "executor-kernel",
      phase: "initializing",
      context: startupContext
    });
    logging.kernel("error", "kernel.start_failed", { code: safeCode(error) });
    try {
      await teardown();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "KERNEL_START_CLEANUP_INCOMPLETE", {
        cause: cleanupError
      });
    }
    throw error;
  }
  return {
    status,
    close(until?: number): Promise<void> {
      return (closing ??= teardown(until));
    }
  };
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function safeCode(error: unknown): string {
  if (record(error) && typeof error.code === "string" && /^[A-Z][A-Z0-9_]{1,80}$/.test(error.code))
    return error.code;
  return error instanceof Error && /^[A-Z][A-Z0-9_]{1,80}$/.test(error.message)
    ? error.message
    : "KERNEL_REQUEST_FAILED";
}
async function write(socket: net.Socket, value: unknown): Promise<void> {
  if (socket.destroyed) throw new KernelError("CONNECTION_CLOSED");
  const line = `${JSON.stringify(value)}\n`;
  if (Buffer.byteLength(line) > HOST_RPC_MAX_LINE_BYTES)
    throw new KernelError("HOST_FRAME_TOO_LARGE");
  if (socket.write(line)) return;
  await new Promise<void>((resolve, reject) => {
    const done = (error?: Error) => {
      clearTimeout(timer);
      socket.off("drain", drain);
      socket.off("close", close);
      if (error) reject(error);
      else resolve();
    };
    const drain = () => done();
    const close = () => done(new KernelError("CONNECTION_CLOSED"));
    const timer = setTimeout(() => {
      socket.destroy();
      close();
    }, 5000);
    socket.once("drain", drain);
    socket.once("close", close);
  });
}
