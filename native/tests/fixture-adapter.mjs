import { createCodexAdapter } from "@mininglamp-oss/octo-runtime-adapter-codex";
import { fileURLToPath } from "node:url";
export const adapter = createCodexAdapter({
  command: process.execPath,
  appServerArgs: [
    fileURLToPath(new URL("../../test-support/fake-native-codex.mjs", import.meta.url))
  ]
});
