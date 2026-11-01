import { fileURLToPath } from "node:url";
import { createCodexAdapter } from "../../../packages/octo-runtime-adapter-codex/dist/index.js";
export default createCodexAdapter({
  command: process.execPath,
  appServerArgs: [fileURLToPath(new URL("./codex-async-server.mjs", import.meta.url))]
});
