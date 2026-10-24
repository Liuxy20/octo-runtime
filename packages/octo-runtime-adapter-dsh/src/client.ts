import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readBoundedLines } from "@mininglamp-oss/octo-runtime-adapter-sdk";
import { createProcessCleanup } from "@mininglamp-oss/octo-runtime-adapter-sdk/process-cleanup";
import {
  DEFAULT_STREAM_LIMIT_POLICY,
  type StreamLimitPolicy
} from "@mininglamp-oss/octo-runtime-protocol";
import { DshError, dshError, nativeCode, record } from "./errors.js";
import type { DshLaunch } from "./launch.js";

export interface DshNotification {
  method: string;
  params: Record<string, unknown>;
}

/**
 * 固定 DSH SDK wire 的低层 Client。拥有一个 invocation 的子进程、pending RPC 和订阅；
 * 不引入官方 client 的强制 Provider 安装依赖，不实现 ACP 兼容层。
 */
export class DshClient {
  readonly child: ChildProcessWithoutNullStreams;
  readonly #pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  readonly #cleanup: () => Promise<void>;
  readonly #stopReading: () => void;
  readonly #limits: Readonly<StreamLimitPolicy>;
  #failure?: Error;
  #closing?: Promise<void>;
  #nextId = 1;
  #bannerCount = 0;

  constructor(
    launch: DshLaunch,
    private readonly options: {
      cwd: string;
      requestTimeoutMs: number;
      shutdownTimeoutMs: number;
      streamLimits?: Readonly<StreamLimitPolicy>;
      onNotification: (notification: DshNotification) => void;
      onFailure: (error: Error) => void;
    }
  ) {
    this.#limits = options.streamLimits ?? DEFAULT_STREAM_LIMIT_POLICY;
    this.child = spawn(launch.command, launch.args, {
      cwd: options.cwd,
      env: launch.env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true
    });
    this.#cleanup = createProcessCleanup(this.child, {
      processGroup: process.platform !== "win32",
      processTree: true,
      termGraceMs: 1000,
      killGraceMs: 1000
    });
    this.child.on("error", (error) => this.fail(dshError(error, "DSH_START_FAILED")));
    this.child.once("exit", (exitCode, signal) => {
      this.fail(new DshError("DSH_TRANSPORT_CLOSED", { exitCode, signal }));
    });
    // stderr 只排空，不保存可能含凭据/模型输入的任意 Provider 文本。
    this.child.stderr.resume();
    this.child.stderr.on("error", () => {});
    this.child.stdin.on("error", () => this.fail(new DshError("DSH_TRANSPORT_CLOSED")));
    this.#stopReading = readBoundedLines(this.child.stdout, this.#limits.rawMessageMaxBytes, {
      onLine: (line) => this.#receive(line),
      onTooLarge: () =>
        this.fail(new DshError("PROVIDER_MESSAGE_TOO_LARGE", { phase: "line_limit" })),
      onError: () => this.fail(new DshError("DSH_TRANSPORT_CLOSED")),
      onClose: () => this.fail(new DshError("DSH_TRANSPORT_CLOSED"))
    });
  }

  fail(error: Error): void {
    if (this.#failure) return;
    this.#failure = error;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
    if (!this.#closing) this.options.onFailure(error);
  }

  #receive(line: string): void {
    if (!line.trim()) return;
    // 本版 account catalog 的已知 stdout info；有界丢弃，绝不转为模型输出。
    if (line.startsWith("[llm-deepseek-account] ") && ++this.#bannerCount <= 64) return;
    try {
      const value: unknown = JSON.parse(line);
      if (!record(value) || value.jsonrpc !== "2.0") throw new DshError("DSH_PROTOCOL_ERROR");
      if ("id" in value) {
        if (!Number.isSafeInteger(value.id) || typeof value.id !== "number" || "method" in value)
          throw new DshError("DSH_PROTOCOL_ERROR");
        const pending = this.#pending.get(value.id);
        if (!pending) throw new DshError("DSH_PROTOCOL_ERROR");
        if ("result" in value === "error" in value) throw new DshError("DSH_PROTOCOL_ERROR");
        if ("error" in value && (!record(value.error) || !Number.isSafeInteger(value.error.code)))
          throw new DshError("DSH_PROTOCOL_ERROR");
        this.#pending.delete(value.id);
        clearTimeout(pending.timer);
        if ("error" in value) {
          const code = nativeCode((value.error as Record<string, unknown>).code);
          pending.reject(
            new DshError("DSH_RPC_ERROR", {
              requestId: value.id,
              ...(code === undefined ? {} : { nativeCode: code })
            })
          );
        } else pending.resolve(value.result);
      } else {
        if (typeof value.method !== "string" || !record(value.params))
          throw new DshError("DSH_PROTOCOL_ERROR");
        this.options.onNotification({ method: value.method, params: value.params });
      }
    } catch (error) {
      this.fail(dshError(error, "DSH_PROTOCOL_ERROR"));
    }
  }

  request(
    method: string,
    params: Record<string, unknown>,
    timeoutMs = this.options.requestTimeoutMs
  ): Promise<unknown> {
    if (this.#failure) return Promise.reject(this.#failure);
    if (this.#pending.size >= 16)
      return Promise.reject(new DshError("DSH_PROTOCOL_ERROR", { phase: "pending_limit" }));
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(
          new DshError(method === "initialize" ? "DSH_INITIALIZE_TIMEOUT" : "DSH_REQUEST_TIMEOUT", {
            requestId: id,
            phase: method
          })
        );
      }, timeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
        (error) => {
          if (error)
            this.fail(new DshError("DSH_TRANSPORT_CLOSED", { requestId: id, phase: method }));
        }
      );
    });
  }

  /** 关闭回执不等于退出；统一 finally 等待进程组清理，关闭失败仍保留原始错误。 */
  close(): Promise<void> {
    this.#closing ??= (async () => {
      if (!this.#failure) {
        try {
          await this.request("shutdown", {}, this.options.shutdownTimeoutMs);
        } catch {
          // shutdown 的结果可未知；随后以进程退出/进程组观测确认回收。
        }
      }
      this.fail(new DshError("DSH_TRANSPORT_CLOSED"));
      this.child.stdin.end();
      try {
        // shutdown ACK 在上游 dispose/flush 之前发出，留出有界的协作退出窗口。
        if (this.child.exitCode === null && this.child.signalCode === null) {
          await new Promise<void>((resolve) => {
            const done = (): void => {
              clearTimeout(timer);
              this.child.off("exit", done);
              resolve();
            };
            const timer = setTimeout(done, 250);
            this.child.once("exit", done);
          });
        }
        await this.#cleanup();
      } catch (error) {
        throw new DshError("DSH_CLEANUP_FAILED", { pid: this.child.pid ?? null }, { cause: error });
      } finally {
        this.#stopReading();
        this.child.stdout.destroy();
        this.child.stderr.destroy();
        this.child.stdin.destroy();
      }
    })();
    return this.#closing;
  }
}
