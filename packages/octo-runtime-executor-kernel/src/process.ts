import { createProcessCleanup } from "@mininglamp-oss/octo-runtime-adapter-sdk/process-cleanup";
import { spawn, type ChildProcess, type ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import type { HostedAdapterMetadata } from "./index.js";
import { WorkerRpcClient } from "./rpc.js";

export interface SpawnWorkerOptions {
  entrypoint: string;
  /** CLI JSON 来源；SDK 的直接 import 入口不需要此参数。 */
  manifest?: string;
  env?: NodeJS.ProcessEnv;
  /** 取消就绪等待并请求回收子进程；POSIX 使用进程组，Windows taskkill 不保证父先退后的后代回收。 */
  signal?: AbortSignal;
  /** Maximum time allowed for the initial RPC readiness handshake. */
  readyTimeoutMs?: number;
  onSpawn?: (child: ChildProcess) => Promise<void>;
}

type HostedChild = ChildProcessByStdio<Writable, Readable, Readable>;

export interface WorkerProcess {
  client: WorkerRpcClient;
  child: HostedChild;
  adapters: HostedAdapterMetadata[];
  close(): Promise<void>;
  stderr(): string;
}

/**
 * 启动 Node worker，以首次 list RPC 成功作为就绪确认，再返回客户端与进程所有权。
 * 入口/manifest/环境错误在启动阶段携带有界 stderr 抛出；失败路径仍须回收已创建的进程。
 * owner 必须等待 close；清理失败不能当作可安全启动替代 worker 的普通启动错误。
 */
export async function spawnWorker({
  entrypoint,
  manifest,
  env = process.env,
  signal,
  onSpawn,
  readyTimeoutMs = 15_000
}: SpawnWorkerOptions): Promise<WorkerProcess> {
  if (signal?.aborted) throw new Error("adapter-host spawn cancelled");
  if (!Number.isFinite(readyTimeoutMs) || readyTimeoutMs < 1) {
    throw new Error("adapter-host readyTimeoutMs must be positive");
  }
  // 跨进程只传程序入口及可选文件路径，不序列化 Adapter 实例或工厂函数。
  const child = spawn(
    process.execPath,
    [entrypoint, ...(manifest ? ["--manifest", manifest] : [])],
    {
      argv0: "octo-runtime-executor-kernel",
      env,
      stdio: ["pipe", "pipe", "pipe", "ipc"],
      detached: process.platform !== "win32"
    }
  ) as HostedChild;
  const cleanup = createProcessCleanup(child, {
    processGroup: process.platform !== "win32",
    processTree: true
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (value: string | Buffer) => {
    // Keep only the tail so a chatty child cannot grow this buffer unbounded.
    stderr = (stderr + value.toString()).slice(-8192);
  });
  const client = new WorkerRpcClient({
    input: child.stdout,
    output: child.stdin
  });
  // S05：spawn error 必须在 readiness 阶段归属本次启动，不能终止宿主。
  // .octospec/tasks/pr1-yujiawei-review/assessment.md
  child.on("error", (error) => client.close(error));
  let adapters: HostedAdapterMetadata[];
  try {
    await onSpawn?.(child);
    adapters = await waitForReady(client.list(), readyTimeoutMs, signal);
  } catch (error) {
    client.close(error instanceof Error ? error : new Error(errorMessage(error)));
    try {
      await cleanup();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `${errorMessage(error)}${stderr ? `: ${stderr}` : ""}; cleanup: ${errorMessage(cleanupError)}`,
        { cause: cleanupError }
      );
    }
    throw new Error(`${errorMessage(error)}${stderr ? `: ${stderr}` : ""}`, { cause: error });
  }
  return {
    client,
    child,
    adapters,
    // 先断开 RPC，再等待平台清理；POSIX 不以 leader exit 结束进程组回收。
    // Windows 仅有 Node/taskkill 的常规树清理能力，不能承诺父进程提前退出后的后代已清空。
    close(): Promise<void> {
      client.close();
      return cleanup();
    },
    stderr: () => stderr
  };
}

function waitForReady<T>(
  operation: Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = (): void => finish(() => reject(new Error("adapter-host spawn cancelled")));
    const timer = setTimeout(
      () =>
        finish(() => reject(new Error(`adapter-host readiness timed out after ${timeoutMs}ms`))),
      timeoutMs
    );
    signal?.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => finish(() => resolve(value)),
      (error) =>
        finish(() => reject(error instanceof Error ? error : new Error(errorMessage(error))))
    );
    // 即使 onSpawn 期间已取消，也必须观察已创建的 RPC，避免回滚触发未处理拒绝。
    if (signal?.aborted) onAbort();
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
