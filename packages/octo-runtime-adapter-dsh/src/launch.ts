import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { createProcessCleanup } from "@mininglamp-oss/octo-runtime-adapter-sdk/process-cleanup";
import { DSH_VERSION, DshError } from "./errors.js";

export interface DshLaunch {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

/** 宿主选择已安装 Provider；Desktop 只作为发行载体，不控制 GUI 或改写用户 profile。 */
export async function resolveDshLaunch(
  options: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal
): Promise<DshLaunch> {
  if (options.args !== undefined && options.command === undefined)
    throw new TypeError("DSH_CONFIG_INVALID: args requires command");
  if (options.command !== undefined && options.desktopPath !== undefined)
    throw new TypeError("DSH_CONFIG_INVALID: command and desktopPath are exclusive");
  let command: string | undefined;
  let args: string[] = [];
  if (options.command !== undefined) {
    if (typeof options.command !== "string" || !options.command.trim())
      throw new TypeError("DSH_CONFIG_INVALID: command must be a non-empty string");
    command = await executable(options.command, env);
    if (!command) throw new DshError("DSH_EXECUTABLE_NOT_FOUND");
    if (options.args !== undefined) {
      if (
        !Array.isArray(options.args) ||
        options.args.length > 64 ||
        options.args.some((value) => typeof value !== "string" || value.includes("\0"))
      )
        throw new TypeError(
          "DSH_CONFIG_INVALID: args must be a string array with at most 64 entries"
        );
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
    if (process.platform !== "darwin")
      throw new TypeError(
        "DSH_CONFIG_INVALID: desktopPath discovery currently requires macOS; select command on other platforms"
      );
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
    env = { ...env, ELECTRON_RUN_AS_NODE: "1" };
  }
  // Windows 不使用 shell 拼接；宿主可显式选择 Node executable 加 CLI module args。
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(command))
    throw new TypeError(
      "DSH_CONFIG_INVALID: select an executable launcher instead of a Windows batch file"
    );
  const launch = { command, args, env };
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
    termGraceMs: 1000,
    killGraceMs: 1000
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
      timer = setTimeout(stop, 10000);
      child.once("error", stop);
      child.stdout.on("error", stop);
      child.stdout.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 4096) stop();
        else output += chunk.toString("utf8");
      });
      child.once("close", (code) => (code === 0 ? resolveVersion() : stop()));
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
      failure = new DshError(
        "DSH_CLEANUP_FAILED",
        { phase: "version", pid: child.pid ?? null },
        { cause: error }
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
  if (!Number.isSafeInteger(value) || value < 1 || value > 86_400_000)
    throw new TypeError(
      `DSH_CONFIG_INVALID: ${key} must be an integer in 1..86400000 milliseconds`
    );
  return value;
}

export function stringOption(
  options: Record<string, unknown>,
  key: string,
  fallback: string
): string {
  const value = options[key] ?? fallback;
  if (typeof value !== "string" || !value.trim() || value.includes("\0") || value.length > 4096)
    throw new TypeError(`DSH_CONFIG_INVALID: ${key} must be a non-empty string`);
  return value;
}
