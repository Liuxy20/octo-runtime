import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createProcessCleanup } from "@mininglamp-oss/octo-runtime-adapter-sdk/process-cleanup";
import { DSH_VERSION, DshError, dshError, nativeCode } from "./errors.js";

const VERSION_PROBE_TIMEOUT_MS = 10_000;
const VERSION_PROBE_MAX_BYTES = 4096;
const MAX_LAUNCH_ARGS = 64;
const MAX_LAUNCH_ARG_BYTES = 4096;
const MAX_TIMEOUT_MS = 86_400_000;
const MAX_OPTION_STRING_LENGTH = 4096;
export const DSH_PROCESS_GRACE_MS = 1000;

export interface DshLaunch {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  dshBin: string;
}

/** 宿主选择已安装 Provider；Desktop 只作为发行载体，不控制 GUI 或改写用户 profile。 */
export async function resolveDshLaunch(
  options: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal
): Promise<DshLaunch> {
  if (options.args !== undefined && options.command === undefined)
    throw new DshError("DSH_CONFIG_INVALID");
  if (options.command !== undefined && options.desktopPath !== undefined)
    throw new DshError("DSH_CONFIG_INVALID");
  let command: string | undefined;
  let args: string[] = [];
  let dshBin: string | undefined;
  if (options.dshBin !== undefined) {
    if (
      options.command !== undefined ||
      options.args !== undefined ||
      options.desktopPath !== undefined
    )
      throw new DshError("DSH_CONFIG_INVALID");
    dshBin = resolve(stringOption(options, "dshBin", ""));
    try {
      if (!(await stat(dshBin)).isFile()) throw new Error("not a file");
    } catch {
      throw new DshError("DSH_EXECUTABLE_NOT_FOUND");
    }
    command = process.execPath;
    args = [dshBin];
  } else if (options.command !== undefined) {
    if (typeof options.command !== "string" || !options.command.trim())
      throw new DshError("DSH_CONFIG_INVALID");
    command = await executable(options.command, env);
    if (!command) throw new DshError("DSH_EXECUTABLE_NOT_FOUND");
    if (options.args !== undefined) {
      if (
        !Array.isArray(options.args) ||
        options.args.length > MAX_LAUNCH_ARGS ||
        options.args.some(
          (value) =>
            typeof value !== "string" ||
            value.length > MAX_LAUNCH_ARG_BYTES ||
            value.includes("\0") ||
            Buffer.byteLength(value) > MAX_LAUNCH_ARG_BYTES
        )
      )
        throw new DshError("DSH_CONFIG_INVALID");
      args = (options.args as unknown[]).map((value) => value as string);
    }
  } else if (options.desktopPath === undefined) {
    command = await executable("dsh", env);
  }
  if (!command) {
    const desktop =
      options.desktopPath ??
      (process.platform === "darwin" ? "/Applications/DeepSeek Harness.app" : undefined);
    if (typeof desktop !== "string" || !isAbsolute(desktop))
      throw new DshError("DSH_EXECUTABLE_NOT_FOUND");
    if (process.platform !== "darwin") throw new DshError("DSH_CONFIG_INVALID");
    command = join(desktop, "Contents/MacOS/DeepSeek Harness");
    const entry = join(
      desktop,
      "Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js"
    );
    // 普通 Node 不解析 asar 内路径；检查归档和 Electron，实际 CLI 由 Electron 解析。
    try {
      await access(command);
      await access(join(desktop, "Contents/Resources/app.asar"));
    } catch {
      throw new DshError("DSH_EXECUTABLE_NOT_FOUND");
    }
    args = [entry];
    dshBin = fileURLToPath(new URL("./desktop-entry.js", import.meta.url));
    env = {
      ...env,
      ELECTRON_RUN_AS_NODE: "1",
      OCTO_DSH_DESKTOP_BINARY: command,
      OCTO_DSH_DESKTOP_ENTRY: entry
    };
  }
  // Windows 不使用 shell 拼接；宿主可显式选择 Node executable 加 CLI module args。
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(command))
    throw new DshError("DSH_CONFIG_INVALID");
  if (!dshBin) {
    if (args.length === 0) dshBin = command;
    else if (command === process.execPath && args.length === 1) dshBin = resolve(args[0]);
    else throw new DshError("DSH_CONFIG_INVALID");
  }
  const launch = { command, args, env, dshBin };
  await checkVersion(launch, signal);
  return launch;
}

async function executable(command: string, env: NodeJS.ProcessEnv): Promise<string | undefined> {
  const candidates =
    isAbsolute(command) || /[/\\]/.test(command)
      ? [resolve(command)]
      : (env.PATH ?? "").split(delimiter).flatMap((directory) => {
          const extensions =
            process.platform === "win32" && !/\.[^\\/]+$/.test(command)
              ? ["", ...(env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")]
              : [""];
          return extensions.map((extension) => resolve(directory, command + extension));
        });
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      /* 只检查文件，不执行第二个无 args 的 Provider 探针。 */
    }
  }
  return undefined;
}

/** 版本探针同样拥有进程树；取消、超时和超量输出都必须先回收再返回。 */
async function checkVersion(launch: DshLaunch, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new DshError("DSH_START_FAILED", { phase: "version" });
  const child = spawn(launch.command, [...launch.args, "--version"], {
    env: launch.env,
    detached: process.platform !== "win32",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const cleanup = createProcessCleanup(child, {
    processGroup: process.platform !== "win32",
    processTree: true,
    termGraceMs: DSH_PROCESS_GRACE_MS,
    killGraceMs: DSH_PROCESS_GRACE_MS
  });
  let output = "";
  let bytes = 0;
  let rejectPending: (error: Error) => void = () => {};
  const stop = () => rejectPending(new DshError("DSH_START_FAILED", { phase: "version" }));
  let timer: NodeJS.Timeout | undefined;
  child.stderr.resume();
  child.stderr.on("error", () => {});
  let failure: unknown;
  try {
    await new Promise<void>((resolveVersion, reject) => {
      rejectPending = reject;
      timer = setTimeout(stop, VERSION_PROBE_TIMEOUT_MS);
      const ioFailure = (error: NodeJS.ErrnoException) =>
        reject(
          new DshError(
            "DSH_START_FAILED",
            {
              phase: "version",
              nativeCode: nativeCode(error.code) ?? null
            },
            { cause: error }
          )
        );
      child.once("error", ioFailure);
      child.stdout.on("error", ioFailure);
      child.stdout.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > VERSION_PROBE_MAX_BYTES) stop();
        else output += chunk.toString("utf8");
      });
      child.once("close", (code, signal) =>
        code === 0
          ? resolveVersion()
          : reject(new DshError("DSH_START_FAILED", { phase: "version", exitCode: code, signal }))
      );
      signal?.addEventListener("abort", stop, { once: true });
      if (signal?.aborted) stop();
    });
    if (output.trim() !== DSH_VERSION) throw new DshError("DSH_VERSION_UNSUPPORTED");
  } catch (error) {
    failure = error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", stop);
    try {
      await cleanup();
    } catch (error) {
      const primary = failure === undefined ? undefined : dshError(failure, "DSH_START_FAILED");
      const cleanup = dshError(error, "DSH_CLEANUP_FAILED");
      failure = new DshError(
        "DSH_CLEANUP_FAILED",
        {
          ...primary?.diagnostics,
          phase: "version",
          pid: child.pid ?? null,
          primaryCode: primary?.code ?? "NONE",
          cleanupCode: cleanup.diagnostics.nativeCode ?? cleanup.code
        },
        {
          cause: new AggregateError(
            failure === undefined ? [error] : [failure, error],
            "DSH version probe cleanup failed"
          )
        }
      );
    } finally {
      child.stdout.destroy();
      child.stderr.destroy();
    }
  }
  if (failure instanceof Error) throw failure;
  if (failure !== undefined) throw new DshError("DSH_START_FAILED", { phase: "version" });
}

export function timeoutOption(
  options: Record<string, unknown>,
  key: string,
  fallback: number
): number {
  const raw = options[key];
  const value =
    raw === undefined
      ? fallback
      : typeof raw === "number" || (typeof raw === "string" && /^\d+$/.test(raw))
        ? Number(raw)
        : NaN;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_TIMEOUT_MS)
    throw new DshError("DSH_CONFIG_INVALID");
  return value;
}

export function stringOption(
  options: Record<string, unknown>,
  key: string,
  fallback: string
): string {
  const value = options[key] ?? fallback;
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.includes("\0") ||
    value.length > MAX_OPTION_STRING_LENGTH
  )
    throw new DshError("DSH_CONFIG_INVALID");
  return value;
}
