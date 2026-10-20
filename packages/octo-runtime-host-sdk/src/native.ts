import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import { once } from "node:events";
import net from "node:net";
import { createProcessCleanup } from "@mininglamp-oss/octo-runtime-adapter-sdk/process-cleanup";
import { readBoundedLines } from "@mininglamp-oss/octo-runtime-adapter-sdk";
import { ComponentStartError, deadline, type CleanupResult } from "./launch.js";

export interface NativeComponentOptions {
  executable: string;
  argv: string[];
  cwd: string;
  configPath: string;
  endpoint: string;
  stop: "stdin-json" | "signal";
  readiness: "ipc" | "process";
}
/** 原生组件拥有独立进程树，参数始终按 argv 传递，不经过 shell。 */
export async function startNativeComponent(options: NativeComponentOptions) {
  for (const path of [options.executable, options.cwd, options.configPath])
    if (!isAbsolute(path)) throw new Error("COMPONENT_PATH_INVALID");
  if (options.argv.some((arg) => /^--(?:config|endpoint)(?:=|$)/.test(arg)))
    throw new Error("COMPONENT_RESERVED_ARGUMENT");
  const child = spawn(
    options.executable,
    [...options.argv, "--config", options.configPath, "--endpoint", options.endpoint],
    {
      cwd: options.cwd,
      shell: false,
      stdio: ["pipe", "pipe", "ignore"],
      detached: process.platform !== "win32"
    }
  );
  const cleanup = createProcessCleanup(child, {
    processGroup: process.platform !== "win32",
    processTree: true
  });
  let ack: { id: string; resolve(): void; reject(error: Error): void } | undefined;
  child.stdin.on("error", () => ack?.reject(new Error("COMPONENT_INPUT_CLOSED")));
  child.on("error", () => ack?.reject(new Error("COMPONENT_EXITED")));
  child.once("exit", () => ack?.reject(new Error("COMPONENT_CLEANUP_UNCONFIRMED")));
  const stopInput = readBoundedLines(child.stdout, 4096, {
    onError: () => {},
    onTooLarge: () => {},
    onClose: () => {},
    onLine(line) {
      try {
        const value = JSON.parse(line) as {
          type?: string;
          request_id?: string;
          complete?: boolean;
        };
        if (ack && value.type === "component.stopped" && value.request_id === ack.id) {
          if (value.complete === true) ack.resolve();
          else ack.reject(new Error("COMPONENT_CLEANUP_INCOMPLETE"));
        }
      } catch {
        /* 原生组件 stdout 不作诊断或业务数据来源。 */
      }
    }
  });
  let closing: Promise<CleanupResult> | undefined;
  const stop = () =>
    (closing ??= (async () => {
      const errors: CleanupResult["errors"] = [];
      if (child.exitCode === null && child.signalCode === null) {
        try {
          if (options.stop === "stdin-json") {
            const pending = new Promise<void>((resolve, reject) => {
              ack = { id: randomUUID(), resolve, reject };
            });
            void pending.catch(() => undefined);
            child.stdin.write(
              `${JSON.stringify({ type: "component.stop", request_id: ack!.id })}\n`
            );
            await deadline(pending, 5000, "COMPONENT_STOP_TIMEOUT");
          } else {
            child.kill("SIGTERM");
            await deadline(once(child, "exit"), 5000, "COMPONENT_STOP_TIMEOUT");
          }
        } catch {
          errors.push({ component: options.executable, code: "COMPONENT_CLEANUP_INCOMPLETE" });
        }
      } else {
        errors.push({ component: options.executable, code: "COMPONENT_CLEANUP_UNCONFIRMED" });
      }
      try {
        await cleanup();
      } catch {
        errors.push({ component: options.executable, code: "PROCESS_CLEANUP_INCOMPLETE" });
      } finally {
        stopInput();
      }
      const processExited = child.exitCode !== null || child.signalCode !== null;
      return {
        complete: !errors.length && processExited,
        processExited,
        errors,
        pendingResources: errors.length ? ["native"] : []
      };
    })());
  try {
    await deadline(once(child, "spawn"), 5000, "COMPONENT_START_TIMEOUT");
    if (options.readiness === "ipc") {
      const until = Date.now() + 30_000;
      while (true) {
        if (child.exitCode !== null || child.signalCode !== null)
          throw new Error("COMPONENT_EXITED");
        try {
          await nativeStatus(options.endpoint, child.pid!);
          break;
        } catch (error) {
          if (error instanceof Error && error.message === "COMPONENT_IDENTITY_MISMATCH")
            throw error;
          if (Date.now() >= until) throw new Error("COMPONENT_START_TIMEOUT", { cause: error });
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
    }
  } catch (error) {
    throw new ComponentStartError(error, await stop());
  }
  return { ownership: "owned" as const, pid: child.pid!, stop };
}
async function nativeStatus(endpoint: string, pid: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = net.createConnection(endpoint);
    const requestId = randomUUID();
    let bytes = "";
    socket.setTimeout(1000, () => {
      socket.destroy();
      reject(new Error("COMPONENT_UNAVAILABLE"));
    });
    socket.on("error", reject);
    socket.on("connect", () =>
      socket.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: requestId, method: "status", params: {} })}\n`
      )
    );
    socket.on("data", (chunk: Buffer) => {
      bytes += chunk.toString();
      if (bytes.length > 4096) {
        socket.destroy();
        reject(new Error("COMPONENT_STATUS_INVALID"));
      }
      if (bytes.includes("\n")) {
        try {
          const reply = JSON.parse(bytes.slice(0, bytes.indexOf("\n"))) as {
            jsonrpc?: string;
            id?: string;
            result?: unknown;
          };
          if (reply.jsonrpc !== "2.0" || reply.id !== requestId || !reply.result) throw new Error();
          if (
            typeof reply.result !== "object" ||
            !("pid" in reply.result) ||
            reply.result.pid !== pid
          ) {
            socket.destroy();
            reject(new Error("COMPONENT_IDENTITY_MISMATCH"));
            return;
          }
          resolve();
        } catch {
          reject(new Error("COMPONENT_STATUS_INVALID"));
        }
        socket.destroy();
      }
    });
    socket.on("end", () => {
      if (!bytes.includes("\n")) reject(new Error("COMPONENT_UNAVAILABLE"));
    });
    socket.on("close", () => reject(new Error("COMPONENT_UNAVAILABLE")));
  });
}
