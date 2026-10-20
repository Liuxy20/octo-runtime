import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { Readable } from "node:stream";
import { runCli } from "../apps/cli/dist/main.js";

const root = fileURLToPath(new URL("..", import.meta.url));

test("CLI Extra storage isolates Homes", async (t) => {
  const home = await mkdtemp("/tmp/extra-home-");
  t.after(() => rm(home, { recursive: true, force: true }));
  for (const [name, value] of [
    ["first", 1],
    ["second", 2]
  ]) {
    const separate = join(home, name);
    await runCli(["--home", separate, "extraset", "example"], {
      input: Readable.from([JSON.stringify({ module: "not-installed-extra", config: { value } })]),
      output() {}
    });
    let saved;
    await runCli(["--home", separate, "extraget", "example"], {
      output: (text) => {
        saved = JSON.parse(text);
      },
      errorOutput() {}
    });
    assert.deepEqual(saved.config, { value });
  }
});
