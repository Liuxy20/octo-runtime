/** Shell-free Node.js process runner used to invoke native service managers. */
import { spawn } from "node:child_process";
import { win32 } from "node:path";
import iconv from "iconv-lite";
import type { CommandOptions, CommandResult, CommandRunner } from "./types.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_CAPTURE_CHARS = 64 * 1024;

/**
 * Execute native manager commands with exact argv boundaries.
 *
 * Output is tail-bounded to 64 KiB per stream and timed-out commands resolve
 * with exit code 124, allowing the service layer to attach backend context.
 */
export class NodeCommandRunner implements CommandRunner {
  #windowsTaskEncoding?: string;

  /** 原命令直接启动并有界捕获；Windows schtasks 内部协商解码，不改变调用方输入。 */
  async run(
    command: string,
    args: readonly string[],
    options: CommandOptions = {}
  ): Promise<CommandResult> {
    if (process.platform !== "win32" || !/^schtasks(?:\.exe)?$/i.test(win32.basename(command))) {
      return runProcess(command, args, options);
    }
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const startedAt = performance.now();
    if (!this.#windowsTaskEncoding) {
      // 与 manager 相同的隐藏控制台启动条件，只查询代码页，不改变宿主控制台或 shell 设置。
      // 仅缓存成功结果；并发查询各自使用调用预算，短超时不能污染其他请求。
      const system32 = win32.join(process.env.SystemRoot ?? "C:\\Windows", "System32");
      const queried = await runProcess(
        win32.join(system32, "cmd.exe"),
        ["/d", "/c", win32.join(system32, "chcp.com")],
        options
      );
      if (queried.exitCode === 124) return commandTimeout(command, args, timeoutMs);
      const codePage = /(\d+)\s*$/.exec(queried.stdout)?.[1];
      const candidate = codePage === "65001" ? "utf8" : codePage ? `cp${codePage}` : "";
      if (queried.exitCode !== 0 || !candidate || !iconv.encodingExists(candidate)) {
        throw new Error("Windows task output code-page query failed", { cause: queried });
      }
      this.#windowsTaskEncoding = candidate;
    }
    const remainingMs = timeoutMs - (performance.now() - startedAt);
    if (timeoutMs > 0 && remainingMs <= 0) return commandTimeout(command, args, timeoutMs);
    // 原命令仍直接启动，超时诊断使用原预算，真实 exit code 124 不等于 timer 已触发。
    return runProcess(
      command,
      args,
      { ...options, timeoutMs: timeoutMs > 0 ? remainingMs : timeoutMs },
      this.#windowsTaskEncoding,
      timeoutMs
    );
  }
}

/** 直接启动原命令；只有 schtasks 的原生字节需要按已查询代码页增量解码。 */
function runProcess(
  command: string,
  args: readonly string[],
  options: CommandOptions,
  encoding?: string,
  reportedTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
          }, timeoutMs)
        : undefined;
    timer?.unref();

    const stdoutDecoder = encoding ? iconv.getDecoder(encoding, { stripBOM: false }) : undefined;
    const stderrDecoder = encoding ? iconv.getDecoder(encoding, { stripBOM: false }) : undefined;
    if (!encoding) {
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
    }
    child.stdout.on("data", (chunk: string | Buffer) => {
      stdout = appendBounded(
        stdout,
        stdoutDecoder ? stdoutDecoder.write(chunk as Buffer) : chunk.toString()
      );
    });
    child.stderr.on("data", (chunk: string | Buffer) => {
      stderr = appendBounded(
        stderr,
        stderrDecoder ? stderrDecoder.write(chunk as Buffer) : chunk.toString()
      );
    });
    child.stdout.once("end", () => {
      stdout = appendBounded(stdout, stdoutDecoder?.end() ?? "");
    });
    child.stderr.once("end", () => {
      stderr = appendBounded(stderr, stderrDecoder?.end() ?? "");
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({
        command,
        args: [...args],
        exitCode: timedOut ? 124 : (code ?? 1),
        stdout,
        stderr: timedOut
          ? appendBounded(stderr, `\ncommand timed out after ${reportedTimeoutMs}ms`)
          : stderr
      });
    });
  });
}

/** 内部代码页查询耗尽预算时，不再启动 manager，仍返回原命令的超时事实。 */
function commandTimeout(
  command: string,
  args: readonly string[],
  timeoutMs: number
): CommandResult {
  return {
    command,
    args: [...args],
    exitCode: 124,
    stdout: "",
    stderr: `command timed out after ${timeoutMs}ms`
  };
}

function appendBounded(current: string, chunk: string): string {
  return (current + chunk).slice(-MAX_CAPTURE_CHARS);
}
