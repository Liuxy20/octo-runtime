import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { acquireEndpoint } from "@mininglamp-oss/octo-runtime-executor-kernel";

test(
  "endpoint recovery admits one owner and preserves ordinary files",
  { skip: process.platform === "win32" },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "ke-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
    await once(child, "exit");
    const endpoint = join(directory, "k.sock");
    await writeFile(`${endpoint}.owner`, JSON.stringify({ pid: child.pid, nonce: "stale" }));
    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, () => acquireEndpoint(endpoint))
    );
    const owners = attempts.filter((result) => result.status === "fulfilled");
    assert.equal(owners.length, 1);
    assert.equal(JSON.parse(await readFile(`${endpoint}.owner`, "utf8")).pid, process.pid);
    await owners[0].value();
    await writeFile(endpoint, "user-owned-data");
    await assert.rejects(acquireEndpoint(endpoint), /ENDPOINT_PATH_INVALID/);
    assert.equal(await readFile(endpoint, "utf8"), "user-owned-data");
  }
);
