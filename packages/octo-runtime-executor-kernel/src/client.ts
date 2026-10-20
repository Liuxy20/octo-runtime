import net from "node:net";
import { randomUUID } from "node:crypto";
import {
  assertHostFrame,
  assertHostFrameIdentity,
  assertHostRunReceipt,
  createInputInvoke,
  identifyInvokeInput,
  isHostTerminal,
  HOST_RPC_MAX_LINE_BYTES,
  INVOKE_REQUEST_MAX_BYTES,
  type HostFrame,
  type InvokeInput,
  type InvokeEnvironment
} from "@mininglamp-oss/octo-runtime-protocol";
import {
  KernelError,
  type KernelClient,
  type KernelStatus,
  type LookupKey,
  type RunRef,
  type RunSnapshot
} from "./types.js";
import { InvocationRegistry, type TrackedInvocation } from "./invocation-lifecycle.js";

/**
 * 连接本机 socket/Windows Pipe，返回不拥有 Kernel 进程的客户端。
 * invoke 提供登记、取消和尾流观察；关闭连接或迭代器不会隐式取消已接纳 Run。
 */
export function attachKernel(options: { endpoint: string }): KernelClient {
  const sockets = new Set<net.Socket>();
  let closed = false;
  const open = async (signal?: AbortSignal, timeout = 5000): Promise<net.Socket> => {
    if (closed) throw new KernelError("CLIENT_CLOSED");
    if (sockets.size >= 32) throw new KernelError("CLIENT_CAPACITY_EXHAUSTED");
    signal?.throwIfAborted();
    const socket = net.createConnection(options.endpoint);
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    const abort = () => socket.destroy(new KernelError("SUBSCRIPTION_ABORTED"));
    signal?.addEventListener("abort", abort, { once: true });
    socket.once("close", () => signal?.removeEventListener("abort", abort));
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        socket.off("connect", connected);
        socket.off("error", failed);
        socket.off("close", disconnected);
        if (error) reject(error);
        else resolve();
      };
      const connected = () => finish();
      const failed = (error: Error) => finish(error);
      const disconnected = () =>
        finish(new KernelError(closed ? "CLIENT_CLOSED" : "CONNECTION_CLOSED"));
      const timer = setTimeout(
        () => {
          socket.destroy();
          finish(new KernelError("KERNEL_UNAVAILABLE"));
        },
        Math.min(5000, timeout)
      );
      socket.once("connect", connected);
      socket.once("error", failed);
      socket.once("close", disconnected);
    }).catch(() => {
      socket.destroy();
      throw new KernelError(closed ? "CLIENT_CLOSED" : "KERNEL_UNAVAILABLE");
    });
    return socket;
  };
  const exchange = async (
    method: string,
    params: unknown = {},
    timeout = 5000,
    signal?: AbortSignal,
    beforeSend?: () => void,
    sent?: () => void
  ): Promise<unknown> => {
    const until = Date.now() + timeout;
    const socket = await open(signal, timeout);
    const timer = setTimeout(
      () => socket.destroy(new KernelError("KERNEL_TIMEOUT")),
      Math.max(1, until - Date.now())
    );
    const id = randomUUID();
    try {
      signal?.throwIfAborted();
      beforeSend?.();
      send(socket, id, method, params);
      sent?.();
      for await (const value of lines(socket)) return response(value, id);
      throw new KernelError(closed ? "CLIENT_CLOSED" : "CONNECTION_CLOSED");
    } catch (error) {
      if (closed) throw new KernelError("CLIENT_CLOSED");
      throw error;
    } finally {
      clearTimeout(timer);
      socket.destroy();
    }
  };
  const query = async (
    key: LookupKey,
    expectedInstance?: string,
    deadline = Date.now() + 5000,
    signal?: AbortSignal
  ): Promise<RunSnapshot> => {
    const info = (await exchange(
      "agent_run.get",
      {
        key: lookupForKey(key),
        kernel_instance_id: expectedInstance
      },
      remaining(deadline),
      signal
    )) as RunSnapshot;
    assertHostRunReceipt(receiptFor(info.ref));
    if (expectedInstance !== undefined && info.ref.kernel_instance_id !== expectedInstance)
      throw new KernelError("KERNEL_INSTANCE_CHANGED");
    if (!sameLookup(info.ref, key)) throw new KernelError("RUN_IDENTITY_MISMATCH");
    if (info.terminal) {
      assertHostFrame(info.terminal);
      assertHostFrameIdentity(info.terminal, receiptFor(info.ref));
      if (!isHostTerminal(info.terminal)) throw new KernelError("HOST_FRAME_INVALID");
    }
    registry.reconcile(info.ref, info.terminal);
    return info;
  };
  const cancel = async (
    ref: RunRef,
    reason?: string,
    deadline = Date.now() + 5000,
    signal?: AbortSignal
  ): Promise<{ accepted: boolean }> => {
    try {
      const result = (await exchange(
        "agent_run.cancel",
        { ref, reason },
        remaining(deadline),
        signal
      )) as { accepted: boolean };
      if (typeof result?.accepted !== "boolean") throw new KernelError("OPERATION_OUTCOME_UNKNOWN");
      return result;
    } catch (error) {
      if (
        error instanceof KernelError &&
        !["CONNECTION_CLOSED", "KERNEL_TIMEOUT", "SUBSCRIPTION_ABORTED"].includes(error.code)
      )
        throw error;
      throw new KernelError("OPERATION_OUTCOME_UNKNOWN");
    }
  };
  const registry = new InvocationRegistry({ get: query, cancel });
  const control = async (method: string, params: unknown): Promise<void> => {
    try {
      await exchange(method, params);
    } catch (error) {
      if (
        error instanceof KernelError &&
        !["CONNECTION_CLOSED", "KERNEL_TIMEOUT"].includes(error.code)
      )
        throw error;
      throw new KernelError("OPERATION_OUTCOME_UNKNOWN");
    }
  };
  const client: KernelClient = {
    topology: "kernel-ipc",
    ownership: "attached",
    invocations: registry,
    invoke: createInputInvoke(async function* (input, environment = {}) {
      if (closed) throw new KernelError("CLIENT_CLOSED");
      environment.signal?.throwIfAborted();
      const request = identifyInvokeInput(input);
      const record = registry.begin(lookupFor(request));
      // signal 属于执行控制，不传给 subscribe：取消后仍须读到 Provider 会话更新与真实终态。
      const abort = () => {
        void registry.cancel(record, "caller_aborted").catch(() => undefined);
      };
      environment.signal?.addEventListener("abort", abort, { once: true });
      try {
        let ref: RunRef;
        try {
          ref = (await submit(request, environment, record)).ref;
          registry.accepted(record, ref);
        } catch (error) {
          registry.rejected(record, error);
          throw error;
        }
        // 终态会释放登记，但 yield 后的业务持久化/投递仍由消费者负责，owner 不能据此提前 close。
        let terminal = false;
        for await (const frame of client.subscribe(ref)) {
          terminal = isHostTerminal(frame);
          if (
            request.protocol_mode === "canonical" &&
            frame.kind === "control" &&
            frame.control.type === "error"
          ) {
            const snapshot = await query(ref, ref.kernel_instance_id).catch(() => undefined);
            if (
              snapshot?.terminal?.kind === "control" &&
              snapshot.terminal.control.type === "state" &&
              snapshot.terminal.control.state === "lost"
            )
              throw new KernelError("RUN_OUTCOME_UNKNOWN");
          }
          yield frame;
          if (
            terminal &&
            frame.kind === "control" &&
            frame.control.type === "state" &&
            frame.control.state === "lost"
          )
            throw new KernelError("RUN_OUTCOME_UNKNOWN");
        }
        if (!terminal) throw new KernelError("HOST_ENDED_WITHOUT_TERMINAL");
        if (record.cancelTask) await record.cancelTask;
      } catch (error) {
        registry.interrupted(record, error);
        throw error;
      } finally {
        environment.signal?.removeEventListener("abort", abort);
        registry.interrupted(record);
      }
    }),
    cancelInvocation: async (id, reason) => registry.cancel(registry.active(id), reason),
    respondInteraction: async (id, response) => client.respond(registry.ref(id), response),
    respondNativeInteraction: async (id, response) =>
      client.respondNative(registry.ref(id), response),
    status: async () => (await exchange("status")) as KernelStatus,
    list: async () => (await exchange("adapter.list")) as Awaited<ReturnType<KernelClient["list"]>>,
    get: query,
    submit: (input, environment) => submit(input, environment),
    async *subscribe(ref, afterSeq = 0, signal) {
      // 断线仅续读同一实例、同一流的连续序号；不能把恢复观察变成再次执行 Provider。
      let after = afterSeq;
      let repair = 0;
      let repairUntil: number | undefined;
      while (true) {
        signal?.throwIfAborted();
        if (closed) throw new KernelError("CLIENT_CLOSED");
        let socket: net.Socket | undefined;
        let timer: NodeJS.Timeout | undefined;
        try {
          if (repairUntil !== undefined && Date.now() >= repairUntil)
            throw new KernelError("KERNEL_UNAVAILABLE");
          socket = await open(
            signal,
            repairUntil === undefined ? 5000 : Math.max(1, repairUntil - Date.now())
          );
          const current = socket;
          timer = setTimeout(
            () => current.destroy(new KernelError("KERNEL_TIMEOUT")),
            repairUntil === undefined ? 5000 : Math.max(1, Math.min(5000, repairUntil - Date.now()))
          );
          const id = randomUUID();
          send(socket, id, "agent_run.subscribe", { ref, after_seq: after });
          let acknowledged = false;
          let terminalAt: number | undefined;
          for await (const value of lines(socket)) {
            if (!acknowledged) {
              const info = response(value, id) as RunSnapshot;
              if (info.ref.kernel_instance_id !== ref.kernel_instance_id)
                throw new KernelError("KERNEL_INSTANCE_CHANGED");
              assertHostRunReceipt(receiptFor(info.ref));
              if (
                !sameLookup(info.ref, ref) ||
                info.ref.stream_id !== ref.stream_id ||
                info.ref.protocol !== ref.protocol
              )
                throw new KernelError("RUN_IDENTITY_MISMATCH");
              acknowledged = true;
              clearTimeout(timer);
              if (info.terminal) {
                assertHostFrame(info.terminal);
                assertHostFrameIdentity(info.terminal, receiptFor(ref));
                if (!isHostTerminal(info.terminal)) throw new KernelError("HOST_FRAME_INVALID");
                registry.reconcile(info.ref, info.terminal);
                terminalAt = info.latest_seq;
              }
              if (terminalAt !== undefined && after >= terminalAt) return;
              continue;
            }
            const notification = value as {
              method?: string;
              params?: {
                code?: string;
                kernel_instance_id?: string;
                seq?: number;
                event?: HostFrame;
              };
            };
            if (notification.method === "agent_run.stream_error")
              throw new KernelError(notification.params?.code ?? "STREAM_FAILED");
            if (
              notification.method !== "agent_run.event" ||
              notification.params?.kernel_instance_id !== ref.kernel_instance_id
            )
              throw new KernelError("HOST_FRAME_INVALID");
            const frame = notification.params.event;
            assertHostFrame(frame);
            assertHostFrameIdentity(frame, receiptFor(ref));
            if (frame.seq !== after + 1 || notification.params.seq !== frame.seq)
              throw new KernelError("STREAM_GAP");
            after = frame.seq;
            registry.observe(ref, frame);
            yield frame;
            if (isHostTerminal(frame)) return;
          }
          throw new KernelError("CONNECTION_CLOSED");
        } catch (error) {
          if (closed) throw new KernelError("CLIENT_CLOSED");
          signal?.throwIfAborted();
          if (
            !(error instanceof KernelError) &&
            error instanceof Error &&
            "code" in error &&
            typeof error.code === "string"
          )
            throw new KernelError(error.code);
          if (
            error instanceof KernelError &&
            !["CONNECTION_CLOSED", "KERNEL_UNAVAILABLE", "KERNEL_TIMEOUT"].includes(error.code)
          )
            throw error;
          if (repair >= 3) throw new KernelError("KERNEL_UNAVAILABLE");
          repairUntil ??= Date.now() + 10_000;
          if (Date.now() >= repairUntil) throw new KernelError("KERNEL_UNAVAILABLE");
          await new Promise((resolve) => setTimeout(resolve, [100, 250, 500][repair++]));
        } finally {
          clearTimeout(timer);
          socket?.destroy();
        }
      }
    },
    cancel,
    respond: (ref, response) => control("agent_run.respond", { ref, response }),
    respondNative: (ref, response) => control("agent_run.native.respond", { ref, response }),
    close() {
      closed = true;
      registry.close();
      for (const socket of sockets) socket.destroy();
    }
  };
  async function submit(
    input: InvokeInput,
    environment: InvokeEnvironment = {},
    record?: TrackedInvocation
  ): Promise<{ ref: RunRef }> {
    if (closed) throw new KernelError("CLIENT_CLOSED");
    environment.signal?.throwIfAborted();
    if (environment.streamLimits !== undefined)
      throw new KernelError("KERNEL_STREAM_LIMITS_UNSUPPORTED");
    const request = identifyInvokeInput(input);
    const requestLine = JSON.stringify({
      jsonrpc: "2.0",
      id: "0".repeat(36),
      method: "agent_run.invoke",
      params: { input: request, executionEnvOverrides: environment.executionEnvOverrides }
    });
    if (Buffer.byteLength(requestLine) + 1 > INVOKE_REQUEST_MAX_BYTES)
      throw new KernelError("INVOKE_REQUEST_TOO_LARGE");
    const instance = (await client.status()).kernel_instance_id;
    environment.signal?.throwIfAborted();
    if (record) record.instance = instance;
    let ref: RunRef;
    let submitted = false;
    try {
      const result = (await exchange(
        "agent_run.invoke",
        {
          input: request,
          executionEnvOverrides: environment.executionEnvOverrides,
          kernel_instance_id: instance
        },
        30_000,
        // 请求发出后中断等待会让接纳结果不明；先取得/查询 ACK，再按原身份请求取消。
        undefined,
        () => {
          environment.signal?.throwIfAborted();
          if (record) registry.assertSubmission();
        },
        () => {
          submitted = true;
          if (record) record.submitted = true;
        }
      )) as { kernel_instance_id: string; receipt: RunRef };
      assertHostRunReceipt(result.receipt);
      if (result.kernel_instance_id !== instance) throw new KernelError("KERNEL_INSTANCE_CHANGED");
      ref = { ...result.receipt, kernel_instance_id: result.kernel_instance_id };
      if (!sameLookup(ref, lookupFor(request))) throw new KernelError("RUN_IDENTITY_MISMATCH");
    } catch (error) {
      if (!submitted) throw error;
      if (
        error instanceof KernelError &&
        !["KERNEL_TIMEOUT", "CONNECTION_CLOSED"].includes(error.code)
      )
        throw error;
      // ACK 丢失后只按原身份查询，不重新提交，避免创建第二次执行。
      const key = lookupFor(request);
      let recovered: RunRef | undefined;
      const until = Date.now() + 10_000;
      for (const delay of [100, 250, 500]) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        if (Date.now() >= until) break;
        try {
          recovered = (await query(key, instance, Math.min(until, Date.now() + 5000))).ref;
          break;
        } catch (queryError) {
          if (
            queryError instanceof KernelError &&
            ["KERNEL_INSTANCE_CHANGED", "RUN_IDENTITY_MISMATCH"].includes(queryError.code)
          )
            throw queryError;
        }
      }
      if (!recovered) throw new KernelError("ACCEPTANCE_UNKNOWN");
      ref = recovered;
    }
    if (!record && environment.signal?.aborted) await client.cancel(ref, "caller_aborted");
    return { ref };
  }
  return client;
}
function remaining(deadline: number): number {
  const timeout = deadline - Date.now();
  if (timeout <= 0) throw new KernelError("KERNEL_TIMEOUT");
  return timeout;
}
function receiptFor(ref: RunRef) {
  const { kernel_instance_id: _instance, ...receipt } = ref;
  void _instance;
  return receipt;
}
function lookupForKey(key: LookupKey): LookupKey {
  return {
    run_id: key.run_id,
    invocation_id: key.invocation_id,
    agent_session_id: key.agent_session_id,
    session_generation: key.session_generation,
    protocol_mode: key.protocol_mode
  };
}
function sameLookup(left: LookupKey, right: LookupKey): boolean {
  return (
    left.run_id === right.run_id &&
    left.invocation_id === right.invocation_id &&
    left.agent_session_id === right.agent_session_id &&
    left.session_generation === right.session_generation &&
    left.protocol_mode === right.protocol_mode
  );
}
function lookupFor(input: ReturnType<typeof identifyInvokeInput>): LookupKey {
  return {
    run_id: input.runId,
    invocation_id: input.invocationId,
    agent_session_id: input.sessionId,
    session_generation: input.sessionGeneration ?? 0,
    protocol_mode: input.protocol_mode ?? "native"
  };
}
function send(socket: net.Socket, id: string, method: string, params: unknown): void {
  const line = `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
  if (Buffer.byteLength(line) > INVOKE_REQUEST_MAX_BYTES)
    throw new KernelError("INVOKE_REQUEST_TOO_LARGE");
  socket.write(line);
}
function response(value: unknown, id: string): unknown {
  const reply = value as {
    id?: unknown;
    error?: { data?: Record<string, unknown> };
    result?: unknown;
  };
  if (reply.id !== id) throw new KernelError("INVALID_RESPONSE");
  if (reply.error)
    throw new KernelError(
      typeof reply.error.data?.code === "string" ? reply.error.data.code : "KERNEL_REQUEST_FAILED",
      reply.error.data
    );
  return reply.result;
}
async function* lines(socket: net.Socket): AsyncGenerator<unknown> {
  let pending: Buffer = Buffer.alloc(0);
  try {
    for await (const chunk of socket) {
      const bytes = chunk as Buffer;
      pending = pending.length ? Buffer.concat([pending, bytes]) : bytes;
      let offset: number;
      while ((offset = pending.indexOf(10)) >= 0) {
        if (offset > HOST_RPC_MAX_LINE_BYTES) throw new KernelError("HOST_FRAME_TOO_LARGE");
        const line = pending.subarray(0, offset);
        pending = pending.subarray(offset + 1);
        yield JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(line)) as unknown;
      }
      if (pending.length > HOST_RPC_MAX_LINE_BYTES) throw new KernelError("HOST_FRAME_TOO_LARGE");
    }
    if (pending.length) throw new KernelError("CONNECTION_CLOSED");
  } catch (error) {
    if (error instanceof KernelError) throw error;
    if (error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message))
      throw new KernelError(error.message);
    throw new KernelError("CONNECTION_CLOSED");
  }
}
