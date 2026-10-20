import net from "node:net";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  readBoundedLines,
  type AdapterProbeOptions
} from "@mininglamp-oss/octo-runtime-adapter-sdk";
import {
  assertHostRunReceipt,
  createInputInvoke,
  contextItem,
  INVOKE_REQUEST_MAX_BYTES,
  HOST_RPC_MAX_LINE_BYTES,
  type InvokeInput,
  type InvokeEnvironment
} from "@mininglamp-oss/octo-runtime-protocol";
import { HostRunService } from "./host-run-service.js";
import { WorkerSupervisor } from "./supervisor.js";
import type { WorkerRpc } from "./rpc.js";
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
  workerEntrypoint: string;
  manifest?: string;
  env?: NodeJS.ProcessEnv;
  adapterConfigurations?: Record<string, AdapterProbeOptions>;
  stateDirectory?: string;
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

export async function startKernelServer(options: KernelServerOptions, signal?: AbortSignal) {
  const instance = randomUUID();
  let manifest: InvocationManifest | undefined;
  const worker = new WorkerSupervisor(
    { entrypoint: options.workerEntrypoint, manifest: options.manifest, env: options.env },
    (pid) => manifest?.setWorker(pid, options.workerEntrypoint) ?? Promise.resolve()
  );
  const configure = (input: InvokeInput) => {
    const type = contextItem(input.contexts, "octo.execution", "adapter")?.payload.type;
    return (options.configurations?.(
      typeof input.runMetadata?.runtimeId === "string" ? input.runMetadata.runtimeId : undefined
    ) ?? options.adapterConfigurations)?.[typeof type === "string" ? type : "codex"];
  };
  const transport: WorkerRpc = {
    list: (configs) =>
      worker.client.list(configs ?? options.configurations?.() ?? options.adapterConfigurations),
    probe: (type, config) => worker.client.probe(type, config),
    cancel: (id, reason) => worker.client.cancel(id, reason),
    respondInteraction: (id, response) => worker.client.respondInteraction(id, response),
    respondNative: (id, response) => worker.client.respondNative(id, response),
    invoke: createInputInvoke((input, environment) => transport.invokeFrames(input, environment)),
    async *invokeFrames(input, environment) {
      const config = configure(input);
      yield* worker.client.invokeFrames(
        config
          ? {
              ...input,
              agentConfig: {
                ...input.agentConfig,
                providerOptions: {
                  ...input.agentConfig?.providerOptions,
                  ...config.providerOptions
                }
              }
            }
          : input,
        environment
      );
    }
  };
  const runs = new HostRunService(transport, (input) => configure(input)?.streamLimits);
  const sockets = new Set<net.Socket>();
  let closing: Promise<void> | undefined;
  let listening = false;
  let releaseEndpoint: (() => Promise<void>) | undefined;
  const status = (): KernelStatus => ({
    ipc_version: 1,
    kernel_instance_id: instance,
    pid: process.pid,
    worker: worker.status,
    execution_ready: !closing && worker.status.state === "ready"
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
          if (worker.status.state === "exhausted")
            throw new KernelError("WORKER_RESTART_EXHAUSTED");
          if (!status().execution_ready) throw new KernelError("KERNEL_UNAVAILABLE");
          const receipt = await runs.submit(params.input as InvokeInput, {
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
                error: { code: rpcCode, message: "Kernel request failed", data: { code } }
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
  const teardown = async (): Promise<void> => {
    runs.beginDrain();
    for (const socket of sockets) socket.destroy();
    const errors: unknown[] = [];
    const attempt = async (operation: () => Promise<unknown>) => {
      try {
        await operation();
        return true;
      } catch (error) {
        errors.push(error);
        return false;
      }
    };
    if (listening)
      await attempt(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const workerStopped = await attempt(() => worker.close());
    await attempt(() => runs.close());
    // 进程未确认回收时保留身份清单和端点租约，禁止新实例覆盖所有权。
    if (workerStopped) {
      await attempt(() => manifest?.close() ?? Promise.resolve());
      if (listening && process.platform !== "win32")
        await attempt(() => rm(options.endpoint, { force: true }));
      if (!errors.length) await attempt(() => releaseEndpoint?.() ?? Promise.resolve());
    }
    if (errors.length) throw new AggregateError(errors, "KERNEL_CLEANUP_INCOMPLETE");
  };
  try {
    signal?.throwIfAborted();
    if (process.platform !== "win32")
      await mkdir(dirname(options.endpoint), { recursive: true, mode: 0o700 });
    signal?.throwIfAborted();
    releaseEndpoint = await acquireEndpoint(options.endpoint);
    signal?.throwIfAborted();
    const statePath = options.stateDirectory
      ? join(options.stateDirectory, "kernel-invocations.json")
      : process.platform !== "win32"
        ? `${options.endpoint}.runs`
        : undefined;
    if (statePath) manifest = (await InvocationManifest.open(statePath)).manifest;
    signal?.throwIfAborted();
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
    await worker.start(signal);
    signal?.throwIfAborted();
  } catch (error) {
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
    close(): Promise<void> {
      return (closing ??= teardown());
    }
  };
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function safeCode(error: unknown): string {
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
