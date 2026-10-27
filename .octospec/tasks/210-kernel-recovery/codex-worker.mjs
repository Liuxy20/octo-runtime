import { fileURLToPath } from "node:url";
import { createCodexAdapter } from "@mininglamp-oss/octo-runtime-adapter-codex";
import { serveWorker } from "@mininglamp-oss/octo-runtime-executor-kernel";

// 真实 Adapter 与 worker 装配；仅将 Codex 可执行程序替换为无网络的协议 fixture。
serveWorker([
  createCodexAdapter({
    command: process.execPath,
    appServerArgs: [fileURLToPath(new URL("codex-app-server.mjs", import.meta.url))]
  })
]);
