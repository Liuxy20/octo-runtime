import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, mkdtemp } from "node:fs/promises";

const execute = promisify(execFile);
let compiled;

async function compileConsole() {
  const cache = fileURLToPath(new URL("../.cache/test-support/", import.meta.url));
  await mkdir(cache, { recursive: true });
  const directory = await mkdtemp(join(cache, "windows-console-"));
  const executable = join(directory, "console-control.exe");
  await execute(
    join(process.env.SystemRoot, "Microsoft.NET/Framework64/v4.0.30319/csc.exe"),
    [
      "/nologo",
      `/out:${executable}`,
      fileURLToPath(new URL("./windows-console-control.cs", import.meta.url))
    ],
    { windowsHide: true, timeout: 10_000 }
  );
  return executable;
}

// 仅测试使用：每个目标 CLI 有独立隐藏控制台，事件不会发到测试 runner/开发者控制台。
// 临时 .NET exe 即使已无进程仍可能保留 Windows 文件映射；编译产物放入忽略的
// 测试构建缓存，每个测试进程独占目录并仅编译一次，不混入待验收的 Home/临时状态。
// 缓存只保存工具二进制，不进入 Runtime 构建/发行；目标及事件投递进程仍须确认退出。
export async function createWindowsConsole() {
  if (process.platform !== "win32") return undefined;
  const executable = await (compiled ??= compileConsole());
  return {
    spawn(args, options) {
      return spawn(executable, ["launch", process.execPath, ...args], {
        ...options,
        windowsHide: true
      });
    },
    async interrupt(pid) {
      if (!Number.isSafeInteger(pid) || pid < 1) throw new Error("Missing owned console PID");
      await execute(executable, ["interrupt", String(pid)], {
        windowsHide: true,
        timeout: 2_000
      });
    },
    async terminate(pid) {
      if (!Number.isSafeInteger(pid) || pid < 1) throw new Error("Missing owned console PID");
      await execute("taskkill", ["/PID", String(pid), "/T", "/F"], {
        windowsHide: true,
        timeout: 2_000
      });
    }
  };
}

export function consoleProcessId(stderr) {
  return Number(/TEST_CONSOLE_PID=(\d+)/.exec(stderr)?.[1]) || undefined;
}
