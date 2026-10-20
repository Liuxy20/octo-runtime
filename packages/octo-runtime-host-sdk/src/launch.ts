import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, chmod, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createProcessCleanup } from "@mininglamp-oss/octo-runtime-adapter-sdk/process-cleanup";
import { processChannel } from "./process-channel.js";

export interface CleanupResult {
  complete: boolean;
  processExited: boolean;
  pendingResources: string[];
  errors: { code: string; component: string }[];
}
export class ComponentStartError extends Error {
  constructor(
    cause: unknown,
    readonly cleanup: CleanupResult
  ) {
    super(cause instanceof Error ? cause.message : "COMPONENT_START_FAILED", { cause });
    this.name = "ComponentStartError";
  }
}
export async function deadline<T>(
  operation: Promise<T>,
  timeoutMs: number,
  code: string
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(code)), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export async function launchNode(
  entrypoint: string,
  config: object,
  onChild?: (child: ChildProcess) => void,
  signal?: AbortSignal
) {
  signal?.throwIfAborted();
  const directory = await mkdtemp(join(tmpdir(), "octo-runtime-component-"));
  const file = join(directory, "config.json");
  try {
    await chmod(directory, 0o700);
    await writeFile(file, JSON.stringify(config), { mode: 0o600 });
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  const child = spawn(process.execPath, [entrypoint, "--config", file], {
    stdio: ["ignore", "ignore", "ignore", "ipc"],
    // Windows 的非 detached 子进程随父进程被强杀，无法执行 IPC 断连回滚。
    detached: true,
    windowsHide: true
  });
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.once("error", () => resolve());
  });
  const processClosed = new Promise<void>((resolve) => child.once("close", () => resolve()));
  const cleanup = createProcessCleanup(child, {
    processGroup: process.platform !== "win32",
    processTree: true
  });
  const channel = processChannel(child);
  let startupFailed = false;
  let cleanupComplete: boolean | undefined;
  let acknowledgement: { id: string; resolve(): void; reject(error: Error): void } | undefined;
  const offCleanup = channel.on((message) => {
    const value = message as { type?: string; request_id?: string; complete?: boolean };
    if (
      value.type !== "component.stopped" ||
      !(
        (acknowledgement && value.request_id === acknowledgement.id) ||
        (startupFailed && value.request_id === undefined)
      )
    )
      return;
    cleanupComplete = value.complete === true;
    if (cleanupComplete) acknowledgement?.resolve();
    else acknowledgement?.reject(new Error("COMPONENT_CLEANUP_INCOMPLETE"));
  });
  const ready = new Promise<void>((resolve, reject) => {
    child.on("error", () => reject(new Error("COMPONENT_START_FAILED")));
    child.once("exit", () => reject(new Error("COMPONENT_EXITED")));
    const off = channel.on((message) => {
      const value = message as { type?: string; error?: string };
      if (value.type === "component.ready") {
        off();
        resolve();
      }
      if (value.type === "component.failed") {
        startupFailed = true;
        off();
        reject(new Error(value.error ?? "COMPONENT_START_FAILED"));
      }
    });
  });
  void ready.catch(() => undefined);
  let closed: Promise<CleanupResult> | undefined;
  const stop = () =>
    (closed ??= (async () => {
      const errors: CleanupResult["errors"] = [];
      const exited = child.exitCode !== null || child.signalCode !== null;
      let acknowledgementError =
        cleanupComplete === false
          ? "COMPONENT_CLEANUP_INCOMPLETE"
          : "COMPONENT_CLEANUP_UNCONFIRMED";
      if (!exited && cleanupComplete === undefined) {
        const id = randomUUID();
        const acknowledged = new Promise<void>((resolve, reject) => {
          acknowledgement = { id, resolve, reject };
          child.once("exit", () => {
            reject(new Error("COMPONENT_CLEANUP_UNCONFIRMED"));
          });
        });
        void acknowledged.catch(() => undefined);
        try {
          channel.send({ type: "component.stop", request_id: id });
          await deadline(acknowledged, 5000, "COMPONENT_STOP_TIMEOUT");
        } catch {
          acknowledgementError = "COMPONENT_CLEANUP_INCOMPLETE";
        }
      }
      try {
        await cleanup();
      } catch {
        errors.push({ code: "PROCESS_CLEANUP_INCOMPLETE", component: entrypoint });
      }
      try {
        // 等 IPC 排空后再判断 ACK；发送 stop 与子进程自主回滚可能同时关闭通道。
        await deadline(processClosed, 1000, "COMPONENT_CLOSE_TIMEOUT");
      } catch {
        errors.push({ code: "COMPONENT_CLOSE_INCOMPLETE", component: entrypoint });
      }
      if (cleanupComplete !== true)
        errors.push({ code: acknowledgementError, component: entrypoint });
      offCleanup();
      try {
        await rm(directory, { recursive: true, force: true });
      } catch {
        errors.push({ code: "COMPONENT_CONFIG_CLEANUP_INCOMPLETE", component: entrypoint });
      }
      const processExited = child.exitCode !== null || child.signalCode !== null;
      return {
        complete: !errors.length && processExited,
        processExited,
        errors,
        pendingResources: errors.length ? ["component"] : []
      };
    })());
  let onAbort = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(new Error("COMPONENT_START_CANCELLED"));
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
  try {
    onChild?.(child);
    await deadline(Promise.race([ready, aborted]), 30_000, "COMPONENT_START_TIMEOUT");
  } catch (error) {
    const cleanup = await stop();
    throw new ComponentStartError(error, cleanup);
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
  return { child, channel, stop, exited };
}
