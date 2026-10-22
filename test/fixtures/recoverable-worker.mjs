import { appendFileSync, existsSync } from "node:fs";
import { serveWorker } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { testAdapter } from "./test-adapter.js";

// 先固定本次启动结果，再通知测试；恢复环境不能改变已确认的失败尝试。
const blocked = existsSync(process.env.OCTO_RECOVERY_BLOCK_FILE);
appendFileSync(
  process.env.OCTO_RECOVERY_STARTS_FILE,
  `${JSON.stringify({ pid: process.pid, time: Date.now(), blocked })}\n`
);
if (blocked) process.exit(78);
serveWorker([testAdapter]);
