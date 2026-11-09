import { fileURLToPath } from "node:url";
import { createFixtureCodexHost } from "./codex-owner.mjs";

const host = createFixtureCodexHost({
  command: process.execPath,
  appServerArgs: [fileURLToPath(new URL("./fake-codex-diagnostics.mjs", import.meta.url))]
});
export const owner = host.owner;
export const adapters = [host.adapter];
