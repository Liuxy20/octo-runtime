import { execFile, spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { promisify } from "node:util";
import { createProcessCleanup } from "../packages/octo-runtime-adapter-sdk/dist/process-cleanup.js";

const executeFile = promisify(execFile);

/** 验收脚本拥有本次子进程及其后代；Windows 必须在 leader 存活时回收树。 */
export async function stopReleaseProcess(child, { termGraceMs = 5_500 } = {}) {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error("Release process leader exited before tree cleanup");
    await executeFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      timeout: 5_000,
      windowsHide: true
    });
  } else {
    await createProcessCleanup(child, {
      processGroup: true,
      termGraceMs,
      killGraceMs: 1_000
    })();
  }
}

/** 超时先回收所属树，再报告命令错误；不使用只会终止 leader 的 execFile timeout。 */
export async function runReleaseCommand(file, args, { timeout = 0, label, ...options } = {}) {
  if (label) console.error(`[release] ${label}`);
  const child = spawn(file, args, {
    ...options,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"]
  });
  let failure;
  let cleanup;
  const cleanupErrors = [];
  const terminated = Promise.withResolvers();
  let closeObserved = false;
  const closed = new Promise((resolveClose) =>
    child.once("close", (code, signal) => {
      closeObserved = true;
      resolveClose({ code, signal });
    })
  );
  let stdout = "";
  let stderr = "";
  const terminate = (error) => {
    if (cleanup) return;
    failure = error;
    cleanup = (async () => {
      try {
        await stopReleaseProcess(child);
      } catch (error) {
        cleanupErrors.push(error);
        try {
          if (!child.kill("SIGKILL"))
            cleanupErrors.push(new Error("Release fallback termination was not delivered"));
        } catch (error) {
          cleanupErrors.push(error);
        }
      } finally {
        child.stdout.destroy();
        child.stderr.destroy();
      }
      // 销毁管道不等于进程退出。终止失败时仍须有界结束等待，并明确保留未回收的 PID。
      let confirmationTimer;
      try {
        const confirmed = await Promise.race([
          closed,
          new Promise((resolveConfirmation) => {
            confirmationTimer = setTimeout(() => resolveConfirmation(undefined), 1_000);
          })
        ]);
        if (confirmed) return confirmed;
        cleanupErrors.push(
          Object.assign(new Error("Release process close was not confirmed"), {
            code: "PROCESS_CLEANUP_INCOMPLETE",
            pid: child.pid
          })
        );
        child.unref();
        return { code: null, signal: null };
      } finally {
        clearTimeout(confirmationTimer);
      }
    })().catch((error) => {
      cleanupErrors.push(error);
      child.unref();
      return { code: null, signal: null };
    });
    void cleanup.then(terminated.resolve);
  };
  child.once("error", (error) => {
    failure ??= error;
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  const collect = (previous, chunk) => {
    const value = previous + chunk;
    if (Buffer.byteLength(value) > 1024 * 1024) {
      terminate(new Error("Release command output exceeded 1 MiB"));
      return previous;
    }
    return value;
  };
  child.stdout.on("data", (chunk) => {
    stdout = collect(stdout, chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr = collect(stderr, chunk);
  });
  const timer = timeout
    ? setTimeout(
        () =>
          terminate(new Error(`Release command timed out after ${timeout} ms: ${label ?? file}`)),
        timeout
      )
    : undefined;
  try {
    const { code, signal } = await Promise.race([closed, terminated.promise]);
    await cleanup;
    if (!failure && (code !== 0 || signal))
      failure = new Error(`Release command failed: ${label ?? file} (${signal ?? code})`);
    if (failure) {
      // 保留 ENOENT/EACCES 等原始 errno；数字退出状态另存，不覆盖系统诊断。
      failure.code ??= code;
      Object.assign(failure, { exitCode: code, signal, stdout, stderr });
      if (cleanupErrors.length)
        throw Object.assign(
          new AggregateError(
            [failure, ...cleanupErrors],
            "Release command and tree cleanup failed",
            { cause: failure }
          ),
          { cleanup: { complete: false, closed: closeObserved, pid: child.pid } }
        );
      throw failure;
    }
    return { stdout, stderr };
  } finally {
    clearTimeout(timer);
  }
}

/** 原始验收失败和目录清理失败分别保留；仅为 Windows 已释放句柄的短暂占用做有界重试。 */
export async function withReleaseDirectory(directory, verify, remove = rm) {
  let failed = false;
  let failure;
  try {
    await verify();
  } catch (error) {
    failed = true;
    failure = error;
  }
  try {
    await remove(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    if (failed)
      throw new AggregateError(
        [failure, error],
        "Release verification and directory cleanup failed",
        {
          cause: failure
        }
      );
    throw error;
  }
  if (failed) throw failure;
}
