import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { createProcessCleanup } from "@mininglamp-oss/octo-runtime-adapter-sdk/process-cleanup";
import { assertProviderCommand } from "@mininglamp-oss/octo-runtime-adapter-sdk";
import {
  watchLineLimit,
  type ServiceProcessSnapshot
} from "@mininglamp-oss/octo-runtime-adapter-sdk";
import {
  DEFAULT_STREAM_LIMIT_POLICY,
  INVOKE_REQUEST_MAX_BYTES
} from "@mininglamp-oss/octo-runtime-protocol";
import { CodexStdinWriter, codexTransportError } from "./stdin-writer.js";
import type { CodexAppServerCommand, CodexAppServerSpawn } from "./app-server.js";

type Message = Record<string, unknown>;
type Id = string | number;
interface Pending {
  method: string;
  channel?: CodexTurnChannel;
  resolve?: (value: unknown) => void;
  reject?: (error: Error) => void;
  timer?: NodeJS.Timeout;
}
interface Incarnation {
  number: number;
  child: ChildProcessWithoutNullStreams;
  writer: CodexStdinWriter;
  reader: Interface;
  removeGuard: () => void;
  cleanup: () => Promise<void>;
  failed: boolean;
  exited: boolean;
  stderr: string;
}

/**
 * 一个调用的协议所有权；只有 service 持有进程和 stdio。
 * channel 关闭只退订自己的 thread，不能终止共享进程或撤销其他调用的写入。
 */
export class CodexTurnChannel {
  onMessage: (message: Message) => void = () => {};
  onFailure: (error: Error) => void = () => {};
  threadId?: string;
  turnId?: string;
  terminal = false;
  closed = false;
  startingTurn = false;
  startingThread = false;
  freshThread = false;
  readonly buffered: Message[] = [];
  bufferedBytes = 0;
  #close?: Promise<void>;
  constructor(
    readonly service: CodexService,
    readonly incarnation: number,
    readonly allowInputEcho = false,
    readonly rawMessageMaxBytes = DEFAULT_STREAM_LIMIT_POLICY.rawMessageMaxBytes
  ) {}
  reserveRequestId(): Id {
    return this.service.reserveRequestId();
  }
  write(
    message: Message,
    onError: (error: Error) => void,
    onWritten?: () => void,
    options: { control?: boolean; timeoutMs?: number } = {}
  ): () => void {
    return this.service.write(this, message, onError, onWritten, options);
  }
  cancelPending(error: Error): void {
    this.service.cancelPending(this, error);
  }
  close(): Promise<void> {
    return (this.#close ??= this.service.release(this));
  }
  errorMessage(error: unknown): string {
    const text = error instanceof Error ? error.message : String(error);
    const tail = this.service.stderr(this.incarnation);
    return tail.trim() ? `${text}\n\n[codex stderr]\n${tail.trim()}` : text;
  }
}

/** owner 的唯一进程与关联器；多调用共享 stdio，故障替代不重放业务动作。 */
export class CodexService {
  readonly id = randomUUID();
  #state: ServiceProcessSnapshot["state"] = "not_started";
  #current?: Incarnation;
  #generation = 0;
  #nextId = 0;
  #closing = false;
  #recoveryStopped = false;
  #supervision?: Promise<void>;
  #close?: Promise<void>;
  #failure?: Error;
  #episodeStart = 0;
  #replacements = 0;
  #stableTimer?: NodeJS.Timeout;
  readonly #stop = new AbortController();
  readonly #pending = new Map<Id, Pending>();
  readonly #channels = new Set<CodexTurnChannel>();
  readonly #threads = new Map<string, CodexTurnChannel>();
  readonly #serverRequests = new Map<Id, CodexTurnChannel>();
  readonly #early = new Map<string, Message[]>();
  #earlyBytes = 0;
  #earlyItems = 0;
  constructor(
    readonly scopeId: string,
    readonly spec: CodexAppServerCommand,
    readonly spawnFn: CodexAppServerSpawn = ownedSpawn,
    readonly rawMessageMaxBytes = DEFAULT_STREAM_LIMIT_POLICY.rawMessageMaxBytes
  ) {}

  /** 所有调用等待同一次启动；取消等待仅影响本调用，不取消共享启动。 */
  async acquire(
    signal?: AbortSignal,
    allowInputEcho = false,
    rawMessageMaxBytes = this.rawMessageMaxBytes
  ): Promise<CodexTurnChannel> {
    if (this.#closing) throw codexTransportError("CODEX_SERVICE_CLOSED");
    signal?.throwIfAborted();
    const ready = this.#state === "ready" ? Promise.resolve() : this.#supervise(false);
    let abort: (() => void) | undefined;
    try {
      await (signal
        ? Promise.race([
            ready,
            new Promise<never>((_, reject) => {
              abort = () =>
                reject(
                  signal.reason instanceof Error
                    ? signal.reason
                    : codexTransportError("CODEX_INVOCATION_CANCELLED")
                );
              signal.addEventListener("abort", abort, { once: true });
              if (signal.aborted) abort();
            })
          ])
        : ready);
    } finally {
      if (abort) signal?.removeEventListener("abort", abort);
    }
    signal?.throwIfAborted();
    if (this.#closing || this.#state !== "ready")
      throw codexTransportError("CODEX_SERVICE_UNAVAILABLE");
    const channel = new CodexTurnChannel(
      this,
      this.#generation,
      allowInputEcho,
      rawMessageMaxBytes
    );
    this.#channels.add(channel);
    return channel;
  }

  snapshot(): ServiceProcessSnapshot {
    const current = this.#current;
    return {
      scope_id: this.scopeId,
      service_id: this.id,
      incarnation: this.#generation,
      provider: "codex",
      owner_pid: process.pid,
      ...(current?.child.pid ? { pid: current.child.pid } : {}),
      state: this.#state,
      observation: !current
        ? "unknown"
        : current.exited || current.child.exitCode !== null || current.child.signalCode !== null
          ? "exited"
          : "alive",
      ownership: "owned"
    };
  }
  stderr(generation: number): string {
    return this.#current?.number === generation ? this.#current.stderr : "";
  }
  reserveRequestId(): Id {
    return ++this.#nextId;
  }

  write(
    channel: CodexTurnChannel,
    message: Message,
    onError: (error: Error) => void,
    onWritten?: () => void,
    options: { control?: boolean; timeoutMs?: number } = {}
  ): () => void {
    const current = this.#current;
    if (
      channel.closed ||
      !current ||
      current.failed ||
      channel.incarnation !== current.number ||
      this.#closing
    ) {
      onError(codexTransportError("CODEX_SERVICE_INCARNATION_LOST"));
      return () => {};
    }
    const id = rpcId(message.id);
    const method = typeof message.method === "string" ? message.method : undefined;
    if (id !== undefined && method) {
      const params = record(message.params);
      try {
        if (method === "thread/start") {
          channel.startingThread = true;
        }
        if (method === "thread/resume") this.#claimThread(channel, text(params.threadId));
        if (method === "turn/start") {
          if (params.threadId !== channel.threadId)
            throw codexTransportError("CODEX_THREAD_OWNER_MISMATCH");
          channel.startingTurn = true;
        }
      } catch (error) {
        onError(asError(error));
        return () => {};
      }
      this.#pending.set(id, { method, channel });
    } else if (id !== undefined) {
      // Provider request IDs belong to the original incarnation and channel, including native replies.
      if (this.#serverRequests.get(id) !== channel) {
        onError(codexTransportError("INTERACTION_NOT_ACTIVE"));
        return () => {};
      }
      this.#serverRequests.delete(id);
    }
    const cancel = current.writer.write(
      message,
      (error) => {
        if (method && id !== undefined) this.#pending.delete(id);
        this.#discardUnclaimedEarly();
        onError(error);
      },
      onWritten,
      { ...options, owner: channel }
    );
    return () => {
      cancel();
      if (method && id !== undefined) this.#pending.delete(id);
      this.#discardUnclaimedEarly();
    };
  }

  cancelPending(channel: CodexTurnChannel, error: Error): void {
    this.#current?.writer.cancelOwner(channel, error);
  }

  /** 未确认中断/退订时保留 thread 归属，阻止迟到通知进入后续调用。 */
  async release(channel: CodexTurnChannel): Promise<void> {
    if (channel.closed) return;
    channel.closed = true;
    this.cancelPending(channel, codexTransportError("INTERACTION_NOT_ACTIVE"));
    for (const [id, pending] of this.#pending)
      if (pending.channel === channel) this.#pending.delete(id);
    this.#discardUnclaimedEarly();
    for (const [id, owner] of this.#serverRequests)
      if (owner === channel) {
        this.#serverRequests.delete(id);
        this.#current?.writer.write(
          { id, error: { code: -32000, message: "invocation ended" } },
          () => {},
          undefined,
          { control: true }
        );
      }
    channel.onMessage = () => {};
    channel.onFailure = () => {};
    channel.buffered.length = 0;
    if (this.#current?.number !== channel.incarnation || this.#current.failed || this.#closing) {
      this.#forget(channel);
      return;
    }
    try {
      if (channel.startingThread || channel.startingTurn)
        throw codexTransportError("CODEX_TURN_DELIVERY_UNKNOWN");
      if (channel.threadId) {
        if (!channel.terminal && channel.turnId) {
          await this.#rpc(
            "turn/interrupt",
            { threadId: channel.threadId, turnId: channel.turnId },
            300
          );
        }
        // Unsubscribe is the native ownership boundary; an ACK for interrupt alone isn't a terminal.
        await this.#rpc("thread/unsubscribe", { threadId: channel.threadId }, 300);
      }
      this.#forget(channel);
    } catch (cause) {
      if (this.#current?.failed || this.#closing) {
        this.#forget(channel);
        return;
      }
      throw codexTransportError("CODEX_TURN_CLEANUP_INCOMPLETE", cause);
    }
  }
  #forget(channel: CodexTurnChannel): void {
    this.#channels.delete(channel);
    if (channel.threadId && this.#threads.get(channel.threadId) === channel)
      this.#threads.delete(channel.threadId);
  }
  #claimThread(channel: CodexTurnChannel, id: string): void {
    if (!id) throw codexTransportError("CODEX_THREAD_ID_MISSING");
    const owner = this.#threads.get(id);
    if (owner && owner !== channel) throw codexTransportError("CODEX_THREAD_BUSY");
    if (channel.threadId && channel.threadId !== id) this.#threads.delete(channel.threadId);
    channel.threadId = id;
    this.#threads.set(id, channel);
  }

  #rpc(method: string, params: unknown, timeoutMs = 30_000): Promise<unknown> {
    const current = this.#current;
    if (!current || current.failed)
      return Promise.reject(codexTransportError("CODEX_SERVICE_UNAVAILABLE"));
    return new Promise((resolve, reject) => {
      const id = this.reserveRequestId();
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        cancel();
        reject(codexTransportError("RPC_TIMEOUT"));
      }, timeoutMs);
      this.#pending.set(id, { method, resolve, reject, timer });
      const cancel = current.writer.write(
        { id, method, params },
        (error) => {
          clearTimeout(timer);
          this.#pending.delete(id);
          reject(error);
        },
        undefined,
        { control: method === "turn/interrupt", timeoutMs }
      );
    });
  }

  #handle(current: Incarnation, message: Message): void {
    if (current !== this.#current || current.failed) return;
    const id = rpcId(message.id);
    if (id !== undefined && ("result" in message || "error" in message)) {
      const pending = this.#pending.get(id);
      if (!pending) return;
      this.#pending.delete(id);
      clearTimeout(pending.timer);
      if (pending.channel) {
        const channel = pending.channel;
        if (!message.error) {
          if (pending.method === "thread/start" || pending.method === "thread/resume") {
            const result = record(message.result);
            const thread = record(result.thread);
            this.#claimThread(channel, text(thread.id ?? result.threadId));
            channel.freshThread = pending.method === "thread/start";
            channel.startingThread = false;
          }
          if (pending.method === "turn/start") {
            const result = record(message.result);
            channel.turnId = text(record(result.turn).id ?? result.turnId);
            if (!channel.turnId) throw codexTransportError("CODEX_TURN_ID_MISSING");
            channel.startingTurn = false;
          }
        } else {
          if (pending.method === "turn/start") channel.startingTurn = false;
          if (pending.method === "thread/start") channel.startingThread = false;
        }
        if (!channel.closed) channel.onMessage(message);
        if (channel.threadId) {
          const early = this.#early.get(channel.threadId) ?? [];
          this.#early.delete(channel.threadId);
          for (const value of early) {
            this.#earlyItems--;
            this.#earlyBytes -= Buffer.byteLength(JSON.stringify(value));
            this.#route(channel, value);
          }
        }
        if (pending.method === "turn/start") {
          const buffered = channel.buffered.splice(0);
          channel.bufferedBytes = 0;
          for (const value of buffered) this.#route(channel, value);
        }
      } else if (message.error) pending.reject?.(codexTransportError("CODEX_SERVICE_RPC_REJECTED"));
      else pending.resolve?.(message.result);
      this.#discardUnclaimedEarly();
      return;
    }
    const params = record(message.params);
    const threadId = text(params.threadId ?? record(params.thread).id);
    const channel = this.#threads.get(threadId);
    if (channel) this.#route(channel, message);
    else if (
      threadId &&
      [...this.#pending.values()].some((value) => value.method === "thread/start")
    ) {
      const bytes = Buffer.byteLength(JSON.stringify(message));
      if (this.#earlyItems >= 128 || this.#earlyBytes + bytes > 32 * 1024 * 1024)
        throw codexTransportError("CODEX_SERVICE_ROUTE_BUFFER_EXCEEDED");
      const entries = this.#early.get(threadId) ?? [];
      entries.push(message);
      this.#early.set(threadId, entries);
      this.#earlyBytes += bytes;
      this.#earlyItems++;
    } else if (id !== undefined) this.#rejectRequest(current, id, threadId ? -32000 : -32601);
  }
  /** 最后一个 start 已结算后，剩余通知不再有可关联的调用，不能作为历史保留。 */
  #discardUnclaimedEarly(): void {
    if (
      !this.#early.size ||
      [...this.#pending.values()].some((pending) => pending.method === "thread/start")
    )
      return;
    const abandoned = [...this.#early.values()].flat();
    this.#early.clear();
    this.#earlyBytes = 0;
    this.#earlyItems = 0;
    for (const message of abandoned) {
      const id = rpcId(message.id);
      if (id !== undefined && this.#current && !this.#current.failed)
        this.#rejectRequest(this.#current, id);
    }
  }
  #route(channel: CodexTurnChannel, message: Message): void {
    const params = record(message.params);
    const turnId = text(params.turnId ?? record(params.turn).id);
    if (channel.startingTurn && !channel.turnId) {
      const bytes = Buffer.byteLength(JSON.stringify(message));
      if (channel.buffered.length >= 128 || channel.bufferedBytes + bytes > 32 * 1024 * 1024)
        throw codexTransportError("CODEX_SERVICE_ROUTE_BUFFER_EXCEEDED");
      channel.buffered.push(message);
      channel.bufferedBytes += bytes;
      return;
    }
    const id = rpcId(message.id);
    if (turnId && turnId !== channel.turnId) {
      if (id !== undefined && this.#current) this.#rejectRequest(this.#current, id);
      return;
    }
    if (message.method === "turn/completed") channel.terminal = true;
    if (id !== undefined) {
      // 缺少 turn ID 时，只有本调用创建的 thread 能证明归属；resume 不借助历史推断。
      if (
        channel.closed ||
        !channel.turnId ||
        this.#serverRequests.has(id) ||
        (!turnId && !channel.freshThread)
      ) {
        this.#rejectRequest(this.#current!, id);
        return;
      }
      this.#serverRequests.set(id, channel);
    }
    if (!channel.closed) channel.onMessage(message);
  }
  #rejectRequest(current: Incarnation, id: Id, code = -32000): void {
    current.writer.write(
      { id, error: { code, message: "request ownership is unknown or inactive" } },
      () => {},
      undefined,
      { control: true }
    );
  }

  #fault(current: Incarnation, error: Error): void {
    if (current !== this.#current || current.failed) return;
    current.failed = true;
    this.#failure = error;
    clearTimeout(this.#stableTimer);
    current.writer.stop(error);
    current.reader.close();
    current.removeGuard();
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject?.(error);
    }
    this.#pending.clear();
    for (const channel of this.#channels) {
      channel.onFailure(error);
      channel.closed = true;
    }
    this.#channels.clear();
    this.#threads.clear();
    this.#serverRequests.clear();
    this.#early.clear();
    this.#earlyBytes = 0;
    this.#earlyItems = 0;
    if (!this.#closing && !this.#recoveryStopped) {
      this.#state = "recovering";
      // The supervisor observes idle failures as well; no business invocation is needed to restart.
      queueMicrotask(() => {
        void this.#supervise(true).catch(() => {});
      });
    }
  }

  #supervise(recovery: boolean): Promise<void> {
    if (this.#supervision) return this.#supervision;
    if (this.#closing || this.#recoveryStopped)
      return Promise.reject(codexTransportError("CODEX_SERVICE_CLOSED"));
    if (this.#state === "degraded" || this.#state === "cleanup_incomplete")
      return Promise.reject(this.#failure ?? codexTransportError("CODEX_SERVICE_DEGRADED"));
    this.#supervision = (async () => {
      if (!this.#episodeStart) this.#episodeStart = performance.now();
      let replace = recovery || this.#generation > 0;
      while (!this.#closing && !this.#recoveryStopped) {
        if (this.#current) {
          try {
            await this.#current.cleanup();
          } catch (error) {
            this.#state = "cleanup_incomplete";
            this.#failure = asError(error);
            throw error;
          }
        }
        if (replace) {
          if (++this.#replacements > 5 || performance.now() - this.#episodeStart >= 90_000) break;
          this.#state = "recovering";
          try {
            await delay(
              250 * 2 ** (this.#replacements - 1) * (1 + Math.random() * 0.25),
              undefined,
              { signal: this.#stop.signal }
            );
          } catch {
            break;
          }
        }
        if (this.#closing || this.#recoveryStopped) break;
        this.#state = replace ? "recovering" : "starting";
        try {
          await this.#start(Math.min(30_000, 90_000 - (performance.now() - this.#episodeStart)));
          if (this.#closing || this.#recoveryStopped) break;
          this.#state = "ready";
          this.#stableTimer = setTimeout(() => {
            this.#replacements = 0;
            this.#episodeStart = 0;
          }, 60_000);
          this.#stableTimer.unref();
          return;
        } catch (error) {
          this.#failure = asError(error);
          if (
            ["ENOENT", "ENOTDIR", "EACCES", "EPERM"].includes(
              String((error as NodeJS.ErrnoException).code)
            )
          )
            break;
          replace = true;
        }
      }
      if (!this.#closing) this.#state = "degraded";
      throw this.#failure ?? codexTransportError("CODEX_SERVICE_CLOSED");
    })().finally(() => {
      this.#supervision = undefined;
      if (!this.#closing && !this.#recoveryStopped && this.#state === "recovering")
        queueMicrotask(() => {
          void this.#supervise(true).catch(() => {});
        });
    });
    return this.#supervision;
  }

  async #start(timeoutMs: number): Promise<void> {
    if (timeoutMs <= 0) throw codexTransportError("CODEX_SERVICE_RECOVERY_EXHAUSTED");
    const child = this.spawnFn(this.spec.command, this.spec.args, {
      ...(this.spec.cwd === undefined ? {} : { cwd: this.spec.cwd }),
      env: this.spec.env
    });
    // 连接解析预算取活动调用最大值；路由后各 client 再执行自己的更小预算。
    const removeGuard = watchLineLimit(
      child.stdout,
      () =>
        Math.max(
          this.#channels.size ? 0 : this.rawMessageMaxBytes,
          ...[...this.#channels].map((channel) =>
            channel.allowInputEcho
              ? Math.max(channel.rawMessageMaxBytes, INVOKE_REQUEST_MAX_BYTES)
              : channel.rawMessageMaxBytes
          )
        ),
      (error) => this.#fault(current, error)
    );
    const current: Incarnation = {
      number: ++this.#generation,
      child,
      // 保留原发送背压；控制条目不按少量并发预留，避免批量取消破坏共享连接。
      writer: new CodexStdinWriter(child.stdin, (error) => this.#fault(current, error), {
        controlItems: DEFAULT_STREAM_LIMIT_POLICY.adapterQueueMaxItems
      }),
      reader: createInterface({ input: child.stdout }),
      removeGuard,
      cleanup: createProcessCleanup(child, {
        processGroup: groups.has(child),
        processTree: ownedChildren.has(child)
      }),
      failed: false,
      exited: false,
      stderr: ""
    };
    this.#current = current;
    current.reader.on("line", (line) => {
      try {
        this.#handle(current, record(JSON.parse(line)));
      } catch (error) {
        this.#fault(current, asError(error));
      }
    });
    child.stderr.on("data", (data: Buffer) => {
      current.stderr = (current.stderr + data.toString()).slice(-64 * 1024);
    });
    for (const source of [child, child.stdin, child.stdout, child.stderr, current.reader])
      source.on("error", (error: Error) => this.#fault(current, error));
    // EOF can occur with a live child; it is independently a transport failure and requires owned cleanup.
    child.stdout.once("end", () =>
      this.#fault(current, codexTransportError("CODEX_TRANSPORT_FAILED"))
    );
    child.once("close", () => {
      current.exited = true;
      this.#fault(current, codexTransportError("CODEX_TRANSPORT_FAILED"));
    });
    try {
      await this.#rpc(
        "initialize",
        {
          clientInfo: { name: "@mininglamp-oss/octo-runtime-adapter-codex", version: "0.1.0" },
          capabilities: {
            experimentalApi: true,
            requestAttestation: false,
            optOutNotificationMethods: [
              "mcpServer/startupStatus/updated",
              "remoteControl/status/changed"
            ]
          }
        },
        timeoutMs
      );
      if (current.failed || this.#closing) throw codexTransportError("CODEX_SERVICE_CLOSED");
      await new Promise<void>((resolve, reject) =>
        current.writer.write({ method: "initialized" }, reject, resolve)
      );
    } catch (error) {
      this.#fault(current, asError(error));
      throw error;
    }
  }

  /** 宿主停止新获取/恢复，但已有健康 channel 仍可定向取消与收尾。 */
  stopRecovery(): void {
    this.#recoveryStopped = true;
    this.#stop.abort();
    clearTimeout(this.#stableTimer);
  }
  beginShutdown(): void {
    if (this.#closing) return;
    this.#closing = true;
    this.#state = "closing";
    this.#stop.abort();
    clearTimeout(this.#stableTimer);
    if (this.#current) this.#fault(this.#current, codexTransportError("CODEX_SERVICE_CLOSED"));
  }
  close(): Promise<void> {
    return (this.#close ??= (async () => {
      this.beginShutdown();
      const failures: unknown[] = [];
      try {
        await this.#current?.cleanup();
        await this.#supervision?.catch(() => {});
        await this.#current?.cleanup();
      } catch (error) {
        failures.push(error);
      }
      try {
        await this.spec.cleanup?.();
      } catch (error) {
        failures.push(error);
      }
      this.#state = failures.length ? "cleanup_incomplete" : "closed";
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) throw new AggregateError(failures, "CODEX_SERVICE_CLEANUP_FAILED");
    })());
  }
}

const groups = new WeakSet<ChildProcessWithoutNullStreams>();
const ownedChildren = new WeakSet<ChildProcessWithoutNullStreams>();
function ownedSpawn(
  command: string,
  args: readonly string[],
  options: { cwd?: string; env: NodeJS.ProcessEnv }
): ChildProcessWithoutNullStreams {
  assertProviderCommand(command);
  const child = spawn(command, [...args], {
    ...options,
    stdio: "pipe",
    detached: process.platform !== "win32",
    windowsHide: true
  });
  ownedChildren.add(child);
  if (process.platform !== "win32") groups.add(child);
  return child;
}
function record(value: unknown): Message {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Message)
    : {};
}
function rpcId(value: unknown): Id | undefined {
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}
function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}
