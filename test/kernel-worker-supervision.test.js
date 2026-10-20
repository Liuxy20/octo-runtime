import test from "node:test";
import assert from "node:assert/strict";
import { kernelFixture, kernelInput, frames } from "./kernel-fixture.js";
import { waitFor } from "./runtime-fixture.js";
import { resolve } from "node:path";
import { WorkerSupervisor } from "../packages/octo-runtime-executor-kernel/dist/supervisor.js";

test(
  "idle workers remain healthy; a blocked main loop is replaced within the heartbeat bound",
  { timeout: 18_000, skip: process.platform === "win32" },
  async (t) => {
    const supervisor = new WorkerSupervisor({
      entrypoint: resolve("test/fixtures/heartbeat-worker.mjs")
    });
    await supervisor.start();
    t.after(() => supervisor.close());
    const first = supervisor.status;
    await new Promise((resolve) => setTimeout(resolve, 5500));
    assert.equal(supervisor.status.pid, first.pid);
    process.kill(first.pid, "SIGUSR2");
    const started = Date.now();
    await waitFor(
      () => supervisor.status.generation > first.generation && supervisor.status.state === "ready",
      7000
    );
    assert.ok(Date.now() - started < 6500);
  }
);

test(
  "three replacements exhaust the rolling restart budget while Kernel status remains available",
  { timeout: 15_000 },
  async (t) => {
    const { client } = await kernelFixture(t);
    for (let index = 0; index < 4; index++) {
      const before = await client.status();
      process.kill(before.worker.pid, "SIGKILL");
      await waitFor(async () => {
        const now = await client.status();
        return index === 3
          ? now.worker.state === "exhausted"
          : now.execution_ready && now.worker.generation > before.worker.generation;
      }, 7000);
    }
    const status = await client.status();
    assert.equal(status.execution_ready, false);
    assert.equal(status.worker.restart_attempt, 3);
    await assert.rejects(client.submit(kernelInput()), /WORKER_RESTART_EXHAUSTED/);
  }
);

test(
  "worker exit loses active runs once, retains accepted terminals and recovers only new work",
  { timeout: 20_000 },
  async (t) => {
    const { client } = await kernelFixture(t);
    const finished = await client.submit(kernelInput());
    const before = await frames(client, finished.ref);
    const pending = await client.submit(kernelInput("wait-for-host-exit"));
    const previous = await client.status();
    process.kill(previous.worker.pid, "SIGKILL");
    const lost = await frames(client, pending.ref);
    assert.equal(lost.at(-1).control.state, "lost");
    assert.equal(
      lost.filter(
        (value) =>
          value.kind === "control" &&
          value.control.type === "state" &&
          value.control.state === "lost"
      ).length,
      1
    );
    await waitFor(async () => {
      const status = await client.status();
      return status.execution_ready && status.worker.generation > previous.worker.generation;
    }, 10_000);
    assert.deepEqual(await frames(client, finished.ref), before);
    const next = await client.submit(kernelInput());
    assert.equal((await frames(client, next.ref)).at(-1).control.state, "completed");
  }
);
