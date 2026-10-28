import { spawn } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { createProcessCleanup } from "@mininglamp-oss/octo-runtime-adapter-sdk/process-cleanup";
import { mergeProcessEnvironment } from "@mininglamp-oss/octo-runtime-adapter-sdk";
import { DSH_VERSION, DshError, dshError, nativeCode } from "./errors.js";

const VERSION_PROBE_TIMEOUT_MS = 10_000;
const VERSION_PROBE_MAX_BYTES = 4096;
const MAX_TIMEOUT_MS = 86_400_000;
const MAX_OPTION_STRING_LENGTH = 4096;
export const DSH_PROCESS_GRACE_MS = 1000;

export interface DshLaunch {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  dshBin: string;
}

/** 宿主维护 npm 安装的 JS 入口；这里只校验所选入口和版本，不发现或替换安装。 */
export async function resolveDshLaunch(
  options: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal
): Promise<DshLaunch> {
  if (["command", "args", "desktopPath"].some((key) => options[key] !== undefined))
    throw new DshError("DSH_CONFIG_INVALID");
  const dshBin = stringOption(options, "dshBin", "");
  assertModulePath(dshBin);
  let physicalPath: string;
  try {
    physicalPath = await realpath(dshBin);
    if (!(await stat(physicalPath)).isFile()) throw new Error("not a file");
  } catch {
    throw new DshError("DSH_EXECUTABLE_NOT_FOUND");
  }
  // 符号链接也不能把 Desktop/ASAR 内嵌入口重新引入 npm 安装合同。
  assertModulePath(physicalPath);
  // 固定已校验的目标，避免宿主链接在校验后被替换；版本探针与官方 Client 共用该路径和环境。
  const launch = {
    command: process.execPath,
    args: [physicalPath],
    env: mergeProcessEnvironment(
      env,
      process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}
    ),
    dshBin: physicalPath
  };
  await checkVersion(launch, signal);
  return launch;
}

function assertModulePath(path: string): void {
  if (
    !isAbsolute(path) ||
    !/\.(?:c|m)?js$/i.test(path) ||
    /(?:^|[/\\])[^/\\]*\.asar(?:[/\\]|$)/i.test(path) ||
    /\.app[/\\]Contents(?:[/\\]|$)/i.test(path)
  )
    throw new DshError("DSH_CONFIG_INVALID");
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
