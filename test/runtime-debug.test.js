import { preparedFrames, preparedTestInvoke, invokeRequest } from "./runtime-fixture.js";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnWorker } from "@mininglamp-oss/octo-runtime-executor-kernel";

const entrypoint = resolve("packages/octo-runtime-executor-kernel/dist/runner.js");
const manifest = resolve("test/fixtures/adapters.json");
const logPath = async (directory) =>
  join(
    directory,
    (await readdir(directory)).find((name) => /^kernel-\d{8}T\d{2}\.log$/.test(name))
  );
async function invoke(host, id = "log-test") {
  const events = [];
  for await (const event of preparedTestInvoke((...args) => preparedFrames(host.client, ...args))(
    "test",
    invokeRequest({
      invocationId: id,
      runId: id,
      prompt: "private-log-fixture",
      approvalMode: "full_access"
    }),
    { protocolMode: "canonical" }
  ))
    events.push(event);
  assert.equal(events.at(-1).type, "run.completed");
}

for (const enabled of [false, true]) {
  test(`F31 Host logging requires an explicit directory (enabled=${enabled})`, async () => {
    const home = await mkdtemp(join(tmpdir(), "oh-metadata-")),
      directory = join(home, "logs");
    let host;
    try {
      host = await spawnWorker({
        entrypoint,
        manifest,
        env: {
          ...process.env,
          OCTO_RUNTIME_HOME: home,
          OCTO_RUNTIME_DEBUG: "1",
          OCTO_RUNTIME_LOGS_DIRECTORY: enabled ? directory : ""
        }
      });
      assert.equal(host.child.stdio.length, 4);
      await invoke(host);
      await host.close();
      if (enabled) {
        const path = await logPath(directory);
        const records = (await readFile(path, "utf8")).trim().split("\n").map(JSON.parse);
        assert.ok(records.some((record) => record.event === "rpc.invoke_received"));
        assert.ok(
          records.some(
            (record) => record.event === "invoke.finished" && record.data.status === "completed"
          )
        );
        assert.doesNotMatch(
          JSON.stringify(records),
          /private-log-fixture|payload|executionEnvOverrides/
        );
        if (process.platform !== "win32") assert.equal((await stat(path)).mode & 0o777, 0o600);
      } else {
        await assert.rejects(stat(directory), { code: "ENOENT" });
      }
    } finally {
      await host?.close();
      await rm(home, { recursive: true, force: true });
    }
  });
}

test("F31 unavailable log directory does not prevent Host readiness or invocation", async () => {
  const home = await mkdtemp(join(tmpdir(), "oh-log-failure-"));
  let host;
  try {
    const directory = join(home, "logs");
    await writeFile(directory, "not a directory");
    host = await spawnWorker({
      entrypoint,
      manifest,
      env: {
        ...process.env,
        OCTO_RUNTIME_HOME: home,
        OCTO_RUNTIME_LOGS_DIRECTORY: directory
      }
    });
    await invoke(host);
    await host.close();
    assert.equal(await readFile(directory, "utf8"), "not a directory");
    assert.doesNotMatch(host.stderr(), /private-log-fixture/);
  } finally {
    await host?.close();
    await rm(home, { recursive: true, force: true });
  }
});
