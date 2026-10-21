#!/usr/bin/env node
import { runCli } from "./main.js";

let componentRun = false;
try {
  process.exitCode = await runCli(process.argv.slice(2), {
    onComponentRun: () => {
      componentRun = true;
    }
  });
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  // 仅前台组件需要残留句柄退出兜底；数据命令必须自然等待管道输出完整刷新。
  // unref 不延长正常退出，SDK 和可导入的 runCli 不终止调用进程。
  if (componentRun) setTimeout(() => process.exit(), 250).unref();
}
