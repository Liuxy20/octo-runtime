import { appendFileSync, existsSync } from "node:fs";
import { serveWorker } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { testAdapter } from "./test-adapter.js";

appendFileSync(
  process.env.OCTO_RECOVERY_STARTS_FILE,
  `${JSON.stringify({ pid: process.pid, time: Date.now() })}\n`
);
if (existsSync(process.env.OCTO_RECOVERY_BLOCK_FILE)) process.exit(78);
serveWorker([testAdapter]);
