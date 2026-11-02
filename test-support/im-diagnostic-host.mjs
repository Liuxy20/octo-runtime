import { fileURLToPath } from "node:url";
import { createCodexAdapter } from "../packages/octo-runtime-adapter-codex/dist/index.js";

export const adapters = [
  createCodexAdapter({
    command: process.execPath,
    appServerArgs: [fileURLToPath(new URL("./fake-codex-diagnostics.mjs", import.meta.url))]
  })
];
