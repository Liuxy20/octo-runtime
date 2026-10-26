import {
  AcpClient,
  type AcpRequestOptions,
  type SpawnAcpClientOptions
} from "@mininglamp-oss/octo-runtime-acp-client";
import { INVOKE_REQUEST_MAX_BYTES } from "@mininglamp-oss/octo-runtime-protocol";
import { mergeProcessEnvironment } from "@mininglamp-oss/octo-runtime-adapter-sdk";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

type JsonRecord = Record<string, unknown>;
export interface SpawnGrokBuildClientOptions extends SpawnAcpClientOptions {
  requestHandler?: (method: string, params: JsonRecord) => unknown;
  onRequestResponseWritten?: (params: JsonRecord) => void;
  onRequestResponseFailed?: (params: JsonRecord, error: Error) => void;
}

export class GrokBuildRpcError extends Error {
  readonly code: unknown;
  readonly data: unknown;
  constructor(error: JsonRecord) {
    super(typeof error.message === "string" ? error.message : "Grok Build ACP request failed");
    this.code = error.code;
    this.data = error.data;
  }
}

/** 标准 RPC 和更新队列沿用通用客户端；此实例只补充 Grok Build 的反向请求和错误信息。 */
class GrokBuildAcpClient extends AcpClient {
  readonly #rpcErrors = new Map<number, JsonRecord>();
  readonly #activeRequests = new Set<number>();
  readonly #reader: ReturnType<typeof createInterface>;
  #stderr = "";
  #disconnected = false;
  #closing = false;

  constructor(
    readonly child: ChildProcessWithoutNullStreams,
    readonly options: SpawnGrokBuildClientOptions
  ) {
    super({ ...options, child, processGroup: process.platform !== "win32" });
    child.stderr.on("data", this.#captureStderr);
    child.stdout.once("end", this.#disconnect);
    this.#reader = createInterface({ input: child.stdout });
    this.#reader.on("error", () => undefined);
    this.#reader.on("line", (line) => {
      // 通用客户端在解析前执行容量守卫；旁路观察器也不解析超过协议上限的帧。
      if (Buffer.byteLength(line) > INVOKE_REQUEST_MAX_BYTES) return;
      let message: JsonRecord;
      try {
        message = JSON.parse(line) as JsonRecord;
      } catch {
        return;
      }
      if (!isRecord(message)) return;
      if (typeof message.id === "number" && isRecord(message.error)) {
        if (this.#activeRequests.has(message.id)) this.#rpcErrors.set(message.id, message.error);
        return;
      }
      if (
        (typeof message.id !== "number" && typeof message.id !== "string") ||
        typeof message.method !== "string" ||
        message.method === "session/request_permission"
      )
        return;
      const params = isRecord(message.params) ? message.params : {};
      void Promise.resolve()
        .then(() => {
          if (!options.requestHandler) throw new Error("GROK_CLIENT_METHOD_UNSUPPORTED");
          return options.requestHandler(message.method as string, params);
        })
        .then(
          (result) => this.#reply({ id: message.id, result }, params),
          () =>
            this.#reply({
              id: message.id,
              error: { code: -32603, message: "Grok Build client request failed" }
            })
        );
    });
  }

  readonly #captureStderr = (value: string | Buffer): void => {
    this.#stderr = (this.#stderr + value.toString()).slice(-8192);
  };

  readonly #disconnect = (): void => {
    if (this.#closing) return;
    this.#disconnected = true;
    setImmediate(() => {
      void this.close().catch(() => undefined);
    });
  };

  #reply(message: JsonRecord, params?: JsonRecord): void {
    if (this.#closing) return;
    const failed = (error: Error): void => {
      if (params) this.options.onRequestResponseFailed?.(params, error);
      void this.close().catch(() => undefined);
    };
    try {
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`, (error) => {
        if (error) failed(error);
        else if (params) this.options.onRequestResponseWritten?.(params);
      });
    } catch (error) {
      failed(error instanceof Error ? error : new Error("Grok Build response delivery failed"));
    }
  }

  override async request<T = unknown>(
    method: string,
    params: JsonRecord,
    options: AcpRequestOptions = {}
  ): Promise<T> {
    const requestId = options.requestId ?? this.reserveRequestId();
    this.#activeRequests.add(requestId);
    try {
      return await super.request<T>(method, params, { ...options, requestId });
    } catch (error) {
      const rpcError = this.#rpcErrors.get(requestId);
      if (rpcError) throw new GrokBuildRpcError(rpcError);
      if (this.#disconnected && error instanceof Error && error.message === "ACP client closed")
        throw new Error(this.#stderr.trim() || "ACP stdout disconnected", { cause: error });
      throw error;
    } finally {
      this.#activeRequests.delete(requestId);
      this.#rpcErrors.delete(requestId);
    }
  }

  override close(): Promise<void> {
    this.#closing = true;
    this.child.stdout.removeListener("end", this.#disconnect);
    this.child.stderr.removeListener("data", this.#captureStderr);
    this.#reader.close();
    return super.close();
  }

  override async *prompt(...args: Parameters<AcpClient["prompt"]>) {
    try {
      yield* super.prompt(...args);
    } catch (error) {
      if (this.#disconnected && error instanceof Error && error.message === "ACP client closed")
        throw new Error(this.#stderr.trim() || "ACP stdout disconnected", { cause: error });
      throw error;
    }
  }
}

export function spawnGrokBuildAcpClient(options: SpawnGrokBuildClientOptions): AcpClient {
  const child = spawn(options.command, options.args ?? [], {
    cwd: options.cwd,
    env: mergeProcessEnvironment(process.env, options.env ?? {}),
    stdio: ["pipe", "pipe", "pipe"],
    detached: process.platform !== "win32"
  });
  const client = new GrokBuildAcpClient(child, options);
  if (options.signal?.aborted) void client.close().catch(() => undefined);
  else if (options.signal) {
    const abort = (): void => {
      void client.close().catch(() => undefined);
    };
    options.signal.addEventListener("abort", abort, { once: true });
    child.once("exit", () => options.signal?.removeEventListener("abort", abort));
  }
  return client;
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
