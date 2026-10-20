import { fileURLToPath } from "node:url";
import { serveWorker } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { createCodexAdapter } from "../packages/octo-runtime-adapter-codex/dist/index.js";

serveWorker([
  createCodexAdapter({
    command: process.execPath,
    appServerArgs: [fileURLToPath(new URL("./fake-codex-diagnostics.mjs", import.meta.url))]
  })
]);
