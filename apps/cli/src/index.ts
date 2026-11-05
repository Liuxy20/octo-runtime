#!/usr/bin/env node
import { runCli } from "./main.js";
import { installPlayboardInterrupt } from "./playboard-interrupt.js";
import { describeError, formatErrorDetails } from "./output.js";
import { safeStartupValue } from "@mininglamp-oss/octo-runtime-executor-kernel";

let componentRun = false;
try {
  process.exitCode = await runCli(process.argv.slice(2), {
    onPlayboardRun: () => {
      installPlayboardInterrupt();
    },
    onComponentRun: () => {
      componentRun = true;
    }
  });
} catch (error) {
  const failure = describeError(error);
  // Playboard 的执行/交互与清理失败沿原执行域展示，不能被标成组件启动失败。
  if (!failure.diagnostic)
    console.error(
      `Error: ${safeStartupValue(error instanceof Error ? error.message : String(error))}`
    );
  else {
    const args = process.argv.slice(2);
    const literal = args.indexOf("--");
    if (
      (literal < 0 ? args : args.slice(0, literal)).some(
        (arg) => arg === "--json" || arg.startsWith("--json=")
      )
    )
      console.log(JSON.stringify({ error: failure }));
    else console.error(`Error: ${formatErrorDetails(failure)}`);
  }
  process.exitCode = 1;
} finally {
  // 仅前台组件需要残留句柄退出兜底；数据命令必须自然等待管道输出完整刷新。
  // unref 不延长正常退出，SDK 和可导入的 runCli 不终止调用进程。
  if (componentRun) setTimeout(() => process.exit(), 250).unref();
}
