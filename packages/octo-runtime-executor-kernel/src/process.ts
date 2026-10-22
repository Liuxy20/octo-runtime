import { createProcessCleanup } from "@mininglamp-oss/octo-runtime-adapter-sdk/process-cleanup";
import { execFile, spawn, type ChildProcess, type ChildProcessByStdio } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import type { Readable, Writable } from "node:stream";
import type { HostedAdapterMetadata } from "./index.js";
import { WorkerRpcClient } from "./rpc.js";
import type { AdapterModuleEntry } from "@mininglamp-oss/octo-runtime-adapter-sdk/module-manifest";

export interface SpawnWorkerOptions {
  entrypoint: string;
  /** CLI JSON 来源；SDK 的直接 import 入口不需要此参数。 */
  manifest?: string;
  /** CLI 已解析的不可变装配快照；与 manifest 互斥，不改变 SDK 自有 worker 的入口。 */
  adapterModules?: AdapterModuleEntry[];
  env?: NodeJS.ProcessEnv;
  /** 取消就绪等待并请求回收子进程；POSIX 使用进程组，Windows taskkill 不保证父先退后的后代回收。 */
  signal?: AbortSignal;
  /** 启动快照发送和首次 RPC 就绪握手共用的最大等待时间。 */
  readyTimeoutMs?: number;
  onSpawn?: (child: ChildProcess) => Promise<void>;
}

type HostedChild = ChildProcessByStdio<Writable, Readable, Readable>;

// Reserve more time for tree cleanup until the worker confirms it has started shutdown.
// A cooperating worker can use its existing 2.5 s shutdown + 1 s logging bounds.
const WINDOWS_CLOSE_GRACE_MS = 4_000;
const WINDOWS_TREE_CLEANUP_RESERVE_MS = 1_900;
const WINDOWS_COOPERATIVE_CLEANUP_RESERVE_MS = 1_000;

export interface WorkerProcess {
  client: WorkerRpcClient;
  child: HostedChild;
  adapters: HostedAdapterMetadata[];
  close(): Promise<void>;
  stderr(): string;
}

const closeOptions = new WeakMap<WorkerProcess, { until: number; immediate: boolean }>();

/** Kernel 内部传递关闭预算；公开 WorkerProcess.close() 仍然无参数。故障恢复不等待日志排空。 */
export function closeWorker(
  worker: WorkerProcess,
  until: number,
  immediate = false
): Promise<void> {
  closeOptions.set(worker, { until, immediate });
  return worker.close();
}

/**
 * 启动 Node worker，以首次 list RPC 成功作为就绪确认，再返回客户端与进程所有权。
 * 入口/manifest/环境错误在启动阶段携带有界 stderr 抛出；失败路径仍须回收已创建的进程。
 * owner 必须等待 close；清理失败不能当作可安全启动替代 worker 的普通启动错误。
 */
export async function spawnWorker({
  entrypoint,
  manifest,
  adapterModules,
  env = process.env,
  signal,
  onSpawn,
  readyTimeoutMs = 15_000
}: SpawnWorkerOptions): Promise<WorkerProcess> {
  if (signal?.aborted) throw new Error("adapter-host spawn cancelled");
  if (manifest && adapterModules !== undefined)
    throw new TypeError("manifest and adapterModules are mutually exclusive");
  if (!Number.isFinite(readyTimeoutMs) || readyTimeoutMs < 1) {
    throw new Error("adapter-host readyTimeoutMs must be positive");
  }
  // 快照通过已有 Node IPC 发送，不占命令行/环境长度，不落盘；永不序列化模块实例。
  const child = spawn(
    process.execPath,
    [
      entrypoint,
      ...(manifest ? ["--manifest", manifest] : []),
      ...(adapterModules === undefined ? [] : ["--adapters-from-ipc"])
    ],
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
    // 先登记进程所有权；快照发送也可能因子进程未读取 IPC 而阻塞，须纳入就绪预算。
    await onSpawn?.(child);
    const initialize = async () => {
      if (adapterModules !== undefined)
        await new Promise<void>((resolve, reject) => {
          child.send({ type: "kernel.adapters", adapters: adapterModules }, (error) =>
            error ? reject(error) : resolve()
          );
        });
      return client.list();
    };
    adapters = await waitForReady(initialize(), readyTimeoutMs, signal);
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
  let closing: Promise<void> | undefined;
  const worker: WorkerProcess = {
    client,
    child,
    adapters,
    // 关闭 RPC 后等待正常收尾与平台清理；POSIX 不以 leader exit 结束进程组回收。
    // Windows 排空后须保留 leader 到 taskkill；宽限内提前退出不能当作树已清空。
    close(): Promise<void> {
      if (closing) return closing;
      const { until = Date.now() + 5000, immediate = false } = closeOptions.get(worker) ?? {};
      client.close();
      // Windows 的 kill(SIGTERM) 是强制终止；先用 EOF 触发现有子进程收尾。
      // S02：POSIX 仍回收整个所属进程组，不能只因 leader 退出而跳过 cleanup。
      return (closing = (async () => {
        const drained =
          process.platform === "win32" && !immediate
            ? await endWindowsWorkerInput(child, until)
            : undefined;
        try {
          // 启动回滚与 POSIX 保留共享清理；Windows 正常关闭须验证本次 taskkill 的结果。
          // leader 在通知后退出时，不能再用它的退出状态掩盖 taskkill 未能找到树的错误。
          if (process.platform === "win32" && drained !== "skipped")
            await cleanupWindowsWorker(child, until);
          else await cleanup();
          // Reaping the OS tree does not erase an observed Adapter cleanup failure.
          if (drained === "incomplete")
            throw Object.assign(new Error("EXECUTOR_CLEANUP_INCOMPLETE"), {
              code: "EXECUTOR_CLEANUP_INCOMPLETE"
            });
        } finally {
          if (process.platform === "win32") {
            // 正常收尾或 fallback 结束后释放本层管道；回收失败仍向调用方传播。
            child.stdin.destroy();
            child.stdout.destroy();
            child.stderr.destroy();
          }
        }
      })());
    },
    stderr: () => stderr
  };
  return worker;
}

/** 只回收本次 worker 的树。命令和退出确认共用截止时间，任何命令错误都保留为回收失败。 */
async function cleanupWindowsWorker(child: HostedChild, until: number): Promise<void> {
  const incomplete = (cause?: unknown): Error =>
    Object.assign(new Error("PROCESS_TREE_CLEANUP_INCOMPLETE", { cause }), {
      code: "PROCESS_TREE_CLEANUP_INCOMPLETE"
    });
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null)
    throw incomplete();
  const remaining = until - Date.now();
  if (remaining <= 0) throw incomplete();
  await new Promise<void>((resolve, reject) => {
    execFile(
      "taskkill",
      ["/PID", String(child.pid), "/T", "/F"],
      { windowsHide: true, timeout: remaining },
      (error) => (error ? reject(incomplete(error)) : resolve())
    );
  });
  const confirmUntil = Math.min(until, Date.now() + 200);
  while (child.exitCode === null && child.signalCode === null) {
    const left = confirmUntil - Date.now();
    if (left <= 0)
      throw Object.assign(new Error("PROCESS_CLEANUP_TIMEOUT"), {
        code: "PROCESS_CLEANUP_TIMEOUT"
      });
    await delay(Math.min(10, left));
  }
}

type WindowsDrainResult = "complete" | "incomplete" | "fallback" | "skipped";

/** 私有正常关闭阶段：EOF 触发排空，IPC 只确认排空结果，实际进程树仍由 cleanup 回收。 */
function endWindowsWorkerInput(child: HostedChild, until: number): Promise<WindowsDrainResult> {
  if (child.exitCode !== null || child.signalCode !== null || child.stdin.destroyed)
    return Promise.resolve("skipped");
  return new Promise<WindowsDrainResult>((resolve) => {
    const graceUntil = Math.min(
      Date.now() + WINDOWS_CLOSE_GRACE_MS,
      until - WINDOWS_COOPERATIVE_CLEANUP_RESERVE_MS
    );
    let settled = false;
    const finish = (result: WindowsDrainResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off("close", fallback);
      child.off("error", fallback);
      child.stdin.off("error", fallback);
      child.off("message", onMessage);
      resolve(result);
    };
    const fallback = (): void => finish("fallback");
    const onMessage = (message: unknown): void => {
      if (!message || typeof message !== "object" || !("type" in message)) return;
      if (message.type === "worker.stopping") {
        // This is progress, not cleanup success. Repeated messages never extend the deadline.
        clearTimeout(timer);
        timer = setTimeout(fallback, Math.max(0, graceUntil - Date.now()));
        return;
      }
      if (
        message.type === "worker.drained" &&
        "cleanup" in message &&
        (message.cleanup === "complete" || message.cleanup === "incomplete")
      )
        finish(message.cleanup);
    };
    let timer = setTimeout(
      fallback,
      Math.max(0, Math.min(graceUntil, until - WINDOWS_TREE_CLEANUP_RESERVE_MS) - Date.now())
    );
    // 先监听再发送 EOF；worker 排空后仍存活，输出在通知/超时前持续消费。
    child.once("close", fallback);
    child.once("error", fallback);
    child.stdin.once("error", fallback);
    child.on("message", onMessage);
    try {
      child.stdin.end();
    } catch {
      // EPIPE 等故障不新增公开错误合同；真正的回收失败仍由 cleanup 抛出。
      fallback();
    }
  });
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
