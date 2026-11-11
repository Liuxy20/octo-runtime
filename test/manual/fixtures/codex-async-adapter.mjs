import { fileURLToPath } from "node:url";
import { createOwnedCodexAdapter as createCodexAdapter } from "../../../test-support/scoped-codex-adapter.mjs";
export default () =>
  createCodexAdapter({
    command: process.execPath,
    appServerArgs: [fileURLToPath(new URL("./codex-async-server.mjs", import.meta.url))]
  });
