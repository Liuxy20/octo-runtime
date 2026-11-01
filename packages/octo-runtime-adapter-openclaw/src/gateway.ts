import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { writeSync } from "node:fs";
import type { RuntimeLog } from "@mininglamp-oss/octo-runtime-adapter-sdk";
import WebSocket, { type RawData } from "ws";
import { isGatewayRunPending } from "./compatibility.js";

export interface OpenClawDeviceIdentity {
  deviceId: string;
  publicKey: string;
  privateKey: string;
}

export interface OpenClawGatewayOptions {
  url: string;
  token: string;
  device: OpenClawDeviceIdentity;
  connectTimeoutMs?: number;
  requestTimeoutMs?: number;
  /** 元数据诊断 sink；缺省写 stderr，不写 worker 的 stdout RPC 通道。 */
  log?: RuntimeLog;
}

export interface OpenClawGatewayEvent {
  event: string;
  payload: unknown;
}

export interface OpenClawGatewayHello {
  type: "hello-ok";
  protocol: number;
  server?: { version?: string };
  features?: { methods?: string[]; events?: string[] };
  auth?: { deviceToken?: string; scopes?: string[]; role?: string };
}

interface PendingRequest {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  expectFinal: boolean;
  accepted?: (value: unknown) => void;
  timer?: NodeJS.Timeout;
  cleanup?: () => void;
}

type GatewayFrame = Record<string, unknown>;
type InvalidFrameReason =
  | "invalid_message"
  | "invalid_json"
  | "invalid_shape"
  | "unknown_type"
  | "invalid_event"
  | "invalid_response";

const PROTOCOL_VERSION = 4;
const CLIENT_ID = "cli";
const CLIENT_MODE = "cli";
const CLIENT_PLATFORM = process.platform === "darwin" ? "macos" : process.platform;
const CLIENT_DEVICE_FAMILY = "desktop";
const REQUESTED_SCOPES = [
  "operator.read",
  "operator.write",
  "operator.admin",
  "operator.approvals"
];
const REQUEST_ID_HEADER = "X-Request-Id";

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function messageText(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.from(data).toString("utf8");
}

/** 保留原生错误码和 RPC，兼容判断不依赖拼接字符串或记录完整 details。 */
export class OpenClawGatewayRpcError extends Error {
  constructor(
    readonly code: string | undefined,
    readonly method: string,
    message: string
  ) {
    super(message);
    this.name = "OpenClawGatewayRpcError";
  }
}

function errorFromFrame(frame: GatewayFrame, method: string): Error {
  const native = record(frame.error);
  const message =
    typeof native?.message === "string" ? native.message : "OpenClaw Gateway request failed";
  const details = record(native?.details);
  const requestId =
    typeof details?.requestId === "string" ? ` (pairing request ${details.requestId})` : "";
  const code = typeof native?.code === "string" ? ` [${native.code}]` : "";
  return new OpenClawGatewayRpcError(
    typeof native?.code === "string" ? native.code : undefined,
    method,
    `${message}${requestId}${code}`
  );
}

function withRequestId(error: Error, requestId: string): Error {
  if (error.message.includes("request_id=")) return error;
  return new Error(`${error.message} (request_id=${requestId})`, { cause: error });
}

function publicKeyRaw(publicKey: string): Buffer {
  const der = Buffer.from(publicKey.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""), "base64");
  if (der.length !== 44)
    throw new Error("OpenClaw device public key is not a canonical Ed25519 SPKI key");
  return der.subarray(12);
}

export function createOpenClawDeviceIdentity(): OpenClawDeviceIdentity {
  const pair = generateKeyPairSync("ed25519");
  const publicKey = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKey = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const deviceId = createHash("sha256").update(publicKeyRaw(publicKey)).digest("hex");
  return { deviceId, publicKey, privateKey };
}

function deviceProof(
  device: OpenClawDeviceIdentity,
  token: string,
  nonce: string,
  signedAt: number
) {
  const publicKey = publicKeyRaw(device.publicKey).toString("base64url");
  const payload = [
    "v3",
    device.deviceId,
    CLIENT_ID,
    CLIENT_MODE,
    "operator",
    REQUESTED_SCOPES.join(","),
    String(signedAt),
    token,
    nonce,
    CLIENT_PLATFORM.toLowerCase(),
    CLIENT_DEVICE_FAMILY
  ].join("|");
  return {
    id: device.deviceId,
    publicKey,
    signature: sign(null, Buffer.from(payload), device.privateKey).toString("base64url"),
    signedAt,
    nonce
  };
}

/** Minimal authenticated Gateway RPC client. One instance owns exactly one WebSocket. */
export class OpenClawGatewayClient {
  readonly #options: OpenClawGatewayOptions;
  readonly #pending = new Map<string, PendingRequest>();
  readonly #listeners = new Set<(event: OpenClawGatewayEvent) => void>();
  #socket?: WebSocket;
  #hello?: OpenClawGatewayHello;
  #connectPromise?: Promise<OpenClawGatewayHello>;
  #invalidFrameCount = 0;

  constructor(options: OpenClawGatewayOptions) {
    this.#options = options;
  }

  get hello(): OpenClawGatewayHello | undefined {
    return this.#hello;
  }

  onEvent(listener: (event: OpenClawGatewayEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  connect(): Promise<OpenClawGatewayHello> {
    this.#connectPromise ??= this.#open();
    return this.#connectPromise;
  }

  async #open(): Promise<OpenClawGatewayHello> {
    const requestId = `req_${randomUUID().replaceAll("-", "")}`;
    const socket = new WebSocket(this.#options.url, {
      headers: { [REQUEST_ID_HEADER]: requestId },
      maxPayload: 25 * 1024 * 1024
    });
    this.#socket = socket;
    socket.on("message", (data) => this.#onMessage(data));
    socket.on("close", (code, reason) =>
      this.#failPending(
        withRequestId(
          new Error(`OpenClaw Gateway closed (${code}): ${reason.toString()}`),
          requestId
        )
      )
    );
    socket.on("error", (error) => this.#failPending(withRequestId(error, requestId)));

    const timeoutMs = this.#options.connectTimeoutMs ?? 10_000;
    return new Promise<OpenClawGatewayHello>((resolve, reject) => {
      let settled = false;
      let cleanupChallenge = () => {};
      const finish = (error?: Error, hello?: OpenClawGatewayHello) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cleanupChallenge();
        socket.off("error", onHandshakeError);
        socket.off("close", onHandshakeClose);
        if (error) {
          if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)
            socket.terminate();
          reject(withRequestId(error, requestId));
        } else resolve(hello!);
      };
      const onHandshakeError = (error: Error) => finish(error);
      const onHandshakeClose = (code: number, reason: Buffer) => {
        finish(
          new Error(`OpenClaw Gateway closed during handshake (${code}): ${reason.toString()}`)
        );
      };
      socket.once("error", onHandshakeError);
      socket.once("close", onHandshakeClose);
      const timer = setTimeout(
        () => finish(new Error(`OpenClaw Gateway handshake timed out after ${timeoutMs}ms`)),
        timeoutMs
      );
      timer.unref?.();
      cleanupChallenge = this.onEvent((event) => {
        if (event.event !== "connect.challenge") return;
        const challenge = record(event.payload);
        const nonce = typeof challenge?.nonce === "string" ? challenge.nonce : undefined;
        const signedAt =
          typeof challenge?.ts === "number" &&
          Number.isSafeInteger(challenge.ts) &&
          challenge.ts >= 0
            ? challenge.ts
            : undefined;
        if (!nonce || signedAt === undefined) {
          finish(new Error("OpenClaw Gateway sent an invalid connect.challenge"));
          return;
        }
        cleanupChallenge();
        void this.request(
          "connect",
          {
            minProtocol: PROTOCOL_VERSION,
            maxProtocol: PROTOCOL_VERSION,
            client: {
              id: CLIENT_ID,
              version: "octo-runtime/0.1.0",
              platform: CLIENT_PLATFORM,
              deviceFamily: CLIENT_DEVICE_FAMILY,
              mode: CLIENT_MODE
            },
            role: "operator",
            scopes: REQUESTED_SCOPES,
            caps: ["tool-events", "session-scoped-events", "exec-approvals"],
            commands: [],
            permissions: {},
            auth: { token: this.#options.token },
            locale: "zh-CN",
            userAgent: "octo-runtime/0.1.0",
            device: deviceProof(this.#options.device, this.#options.token, nonce, signedAt)
          },
          { timeoutMs }
        ).then(
          (value) => {
            const hello = record(value) as OpenClawGatewayHello | undefined;
            if (!hello || hello.type !== "hello-ok") {
              finish(new Error("OpenClaw Gateway returned an invalid hello response"));
              return;
            }
            this.#hello = hello;
            finish(undefined, hello);
          },
          (error: unknown) =>
            finish(
              error instanceof Error ? error : new Error("OpenClaw Gateway connect request failed")
            )
        );
      });
    });
  }

  request(
    method: string,
    params: Record<string, unknown>,
    options: {
      expectFinal?: boolean;
      timeoutMs?: number | null;
      signal?: AbortSignal;
      onAccepted?: (value: unknown) => void;
    } = {}
  ): Promise<unknown> {
    if (options.signal?.aborted)
      return Promise.reject(new Error(`OpenClaw Gateway request ${method} aborted`));
    const socket = this.#socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("OpenClaw Gateway is not connected"));
    }
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const pending: PendingRequest = {
        method,
        resolve,
        reject,
        expectFinal: options.expectFinal === true,
        accepted: options.onAccepted
      };
      const timeoutMs =
        options.timeoutMs === null
          ? undefined
          : (options.timeoutMs ?? this.#options.requestTimeoutMs ?? 30_000);
      if (timeoutMs !== undefined) {
        pending.timer = setTimeout(() => {
          if (!this.#pending.delete(id)) return;
          pending.cleanup?.();
          reject(new Error(`OpenClaw Gateway request ${method} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        pending.timer.unref?.();
      }
      const abort = () => {
        if (!this.#pending.delete(id)) return;
        if (pending.timer) clearTimeout(pending.timer);
        pending.cleanup?.();
        reject(new Error(`OpenClaw Gateway request ${method} aborted`));
      };
      options.signal?.addEventListener("abort", abort, { once: true });
      pending.cleanup = () => options.signal?.removeEventListener("abort", abort);
      this.#pending.set(id, pending);
      socket.send(JSON.stringify({ type: "req", id, method, params }), (error?: Error) => {
        if (!error) return;
        if (!this.#pending.delete(id)) return;
        if (pending.timer) clearTimeout(pending.timer);
        pending.cleanup?.();
        reject(error);
      });
    });
  }

  async close(): Promise<void> {
    const socket = this.#socket;
    if (!socket || socket.readyState === WebSocket.CLOSED) return;
    if (socket.readyState === WebSocket.CONNECTING) {
      socket.terminate();
      return;
    }
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      socket.once("close", finish);
      socket.close(1000, "octo-runtime invocation complete");
      const timer = setTimeout(() => {
        socket.terminate();
        finish();
      }, 1_000);
      timer.unref?.();
    });
  }

  /** 跳过坏消息不改变连接、pending 或原期限；仅诊断采样，不能当作执行进度。 */
  #ignoreFrame(reason: InvalidFrameReason): void {
    if (this.#invalidFrameCount === Number.MAX_SAFE_INTEGER) return;
    const count = ++this.#invalidFrameCount;
    if (count > 10 && count % 100 !== 0) return;
    const data = { adapter_type: "openclaw", reason_code: reason, frame_count: count };
    try {
      if (this.#options.log) {
        const result: unknown = this.#options.log("warn", "openclaw.gateway.invalid_frame", data);
        // void sink 也可由 async 函数实现；只观察拒绝，不等待、不重试日志。
        if (result && typeof (result as PromiseLike<unknown>).then === "function")
          void Promise.resolve(result).catch(() => undefined);
      } else {
        // 固定、小于 512 字节的元数据；同步写避免后台排队，EPIPE 等仅丢失本条诊断。
        writeSync(
          2,
          `${JSON.stringify({ level: "warn", event: "openclaw.gateway.invalid_frame", ...data })}\n`
        );
      }
    } catch {
      /* 日志失败不影响本消息的跳过，更不能打断下一条合法消息。 */
    }
  }

  #onMessage(data: RawData): void {
    let text: string;
    try {
      text = messageText(data);
    } catch {
      this.#ignoreFrame("invalid_message");
      return;
    }
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      this.#ignoreFrame("invalid_json");
      return;
    }
    const frame = record(value);
    if (!frame || typeof frame.type !== "string") {
      this.#ignoreFrame("invalid_shape");
      return;
    }
    // 只验证路由字段，扩展字段与 payload 保持原生合同；业务回调不在解析 catch 内。
    if (frame.type === "event") {
      if (typeof frame.event !== "string" || !frame.event) {
        this.#ignoreFrame("invalid_event");
        return;
      }
      for (const listener of this.#listeners)
        listener({ event: frame.event, payload: frame.payload });
      return;
    }
    if (frame.type !== "res") {
      this.#ignoreFrame("unknown_type");
      return;
    }
    if (typeof frame.id !== "string" || !frame.id || typeof frame.ok !== "boolean") {
      this.#ignoreFrame("invalid_response");
      return;
    }
    const pending = this.#pending.get(frame.id);
    if (!pending) return;
    const payload = record(frame.payload);
    if (frame.ok === true && pending.expectFinal && isGatewayRunPending(payload)) {
      pending.accepted?.(frame.payload);
      return;
    }
    this.#pending.delete(frame.id);
    if (pending.timer) clearTimeout(pending.timer);
    pending.cleanup?.();
    if (frame.ok === true) pending.resolve(frame.payload);
    else pending.reject(errorFromFrame(frame, pending.method));
  }

  #failPending(error: Error): void {
    for (const pending of this.#pending.values()) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.cleanup?.();
      pending.reject(error);
    }
    this.#pending.clear();
  }
}
