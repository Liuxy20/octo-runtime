import { preparedSubmit } from "./runtime-fixture.js";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { invokeRequest, waitFor } from "./runtime-fixture.js";

const root = fileURLToPath(new URL("..", import.meta.url));
async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries
        .filter((entry) => entry.name !== "node_modules")
        .map((entry) =>
          entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]
        )
    )
  ).flat();
}

test("Runtime source and built packages do not load a SQL driver or expose a domain store", async () => {
  for (const directory of ["apps", "packages"]) {
    for (const path of await files(join(root, directory))) {
      if (!/\.(?:js|ts)$/.test(path)) continue;
      assert.doesNotMatch(
        await readFile(path, "utf8"),
        /(?:from\s*|import\s*\(|require\s*\()\s*["'](?:node:sqlite|better-sqlite3|sqlite3)["']/,
        path
      );
    }
  }
  const core = await import("@mininglamp-oss/octo-runtime-executor-core");
  assert.deepEqual(Object.keys(core).sort(), [
    "AgentExecutor",
    "DEFAULT_RUNTIME_LIMITS",
    "localRuntimeLimits",
    "prepareInvokeInput",
    "prepareRunContext",
    "resolveLocalContext"
  ]);
});
