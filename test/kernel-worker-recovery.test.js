import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { kernelFixture, kernelInput, frames } from "./kernel-fixture.js";
import { waitFor } from "./runtime-fixture.js";
import { WorkerSupervisor } from "../packages/octo-runtime-executor-kernel/dist/supervisor.js";

test(
  "repeated readiness failures stay rate-limited and recover after the worker environment is restored",
  { timeout: 50_000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "wr-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const startsFile = join(directory, "starts");
    const blockFile = join(directory, "blocked");
    const { client } = await kernelFixture(t, {
      workerEntrypoint: resolve("test/fixtures/recoverable-worker.mjs"),
      env: {
        ...process.env,
        OCTO_RECOVERY_STARTS_FILE: startsFile,
        OCTO_RECOVERY_BLOCK_FILE: blockFile
      }
    });
    const starts = async () =>
      (await readFile(startsFile, "utf8")).trim().split("\n").map(JSON.parse);
    const original = await client.status();
    const active = await client.submit(kernelInput("wait-for-host-exit"));
    await writeFile(blockFile, "unavailable");
    process.kill(original.worker.pid, "SIGKILL");
    assert.equal((await frames(client, active.ref)).at(-1).control.state, "lost");
    await waitFor(async () => (await starts()).length === 4, 10_000);
    await waitFor(async () => (await starts()).length === 5, 18_000);
    const failed = await starts();
    assert.ok(failed[4].time - failed[3].time >= 15_000);
    assert.equal((await client.status()).execution_ready, false);
    assert.equal((await client.status()).worker.state, "recovering");
    await rm(blockFile);
    await waitFor(async () => (await client.status()).execution_ready, 18_000);
    const recovered = await client.status();
    const allStarts = await starts();
    assert.equal(allStarts.length, 6);
    assert.ok(allStarts[5].time - allStarts[4].time >= 15_000);
    assert.equal(recovered.kernel_instance_id, original.kernel_instance_id);
    assert.equal(recovered.pid, original.pid);
    assert.equal(recovered.worker.restart_attempt, 5);
    assert.equal((await client.get(active.ref)).terminal.control.state, "lost");
    const next = await client.submit(kernelInput());
    assert.equal((await frames(client, next.ref)).at(-1).control.state, "completed");
  }
);

test(
  "unconfirmed process-group cleanup blocks replacement and remains a close failure",
  { timeout: 8000, skip: process.platform === "win32" },
  async (t) => {
    const recorded = [];
    const supervisor = new WorkerSupervisor(
      { entrypoint: resolve("test/fixtures/heartbeat-worker.mjs") },
      async (pid) => {
        recorded.push(pid);
      }
    );
    await supervisor.start();
    const original = supervisor.status;
    const kill = process.kill.bind(process);
    let denyCleanup = true;
    t.mock.method(process, "kill", (pid, signal) => {
      if (denyCleanup && pid === -original.pid)
        throw Object.assign(new Error("cleanup denied"), { code: "EPERM" });
      return kill(pid, signal);
    });
    t.after(async () => {
      denyCleanup = false;
      await supervisor.close().catch(() => undefined);
    });
    kill(original.pid, "SIGKILL");
    await waitFor(() => supervisor.status.state === "exhausted");
    assert.equal(supervisor.status.restart_attempt, 0);
    assert.deepEqual(recorded, [original.pid]);
    denyCleanup = false;
    await assert.rejects(supervisor.close());
    assert.deepEqual(recorded, [original.pid]);
  }
);
