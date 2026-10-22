import test from "node:test";
import assert from "node:assert/strict";
import { kernelFixture, kernelInput, frames } from "./kernel-fixture.js";
import { waitFor } from "./runtime-fixture.js";
import { resolve } from "node:path";
import { WorkerSupervisor } from "../packages/octo-runtime-executor-kernel/dist/supervisor.js";

test(
  "a long scheduler clock gap probes the existing worker before declaring it lost",
  { timeout: 8000 },
  async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
    const supervisor = new WorkerSupervisor({
      entrypoint: resolve("test/fixtures/heartbeat-worker.mjs")
    });
    await supervisor.start();
    t.after(() => supervisor.close());
    const original = supervisor.status;
    t.mock.timers.setTime(Date.now() + 3_600_000);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assert.equal(supervisor.status.state, "ready");
    assert.equal(supervisor.status.generation, original.generation);
    assert.equal(supervisor.status.restart_attempt, 0);
  }
);

test(
  "idle workers remain healthy; a blocked main loop is reaped before a ready replacement",
  { timeout: 35_000, skip: process.platform === "win32" },
  async (t) => {
    const supervisor = new WorkerSupervisor({
      entrypoint: resolve("test/fixtures/heartbeat-worker.mjs")
    });
    await supervisor.start();
    t.after(async () => {
      t.diagnostic(`worker status before cleanup: ${JSON.stringify(supervisor.status)}`);
      await supervisor.close();
    });
    const first = supervisor.status;
    await new Promise((resolve) => setTimeout(resolve, 5500));
    assert.equal(supervisor.status.pid, first.pid);
    process.kill(first.pid, "SIGUSR2");
    // 心跳截止由 kernel-heartbeat.test.js 的可控时钟精确验证；真实进程还需回收、退避和启动。
    // 分别等待故障检测和替代进程就绪，避免把整个恢复过程误限为一个心跳预算。
    await waitFor(
      () =>
        supervisor.status.state === "recovering" || supervisor.status.generation > first.generation,
      8000
    );
    await waitFor(
      () => supervisor.status.generation > first.generation && supervisor.status.state === "ready",
      15_000
    );
    assert.notEqual(supervisor.status.pid, first.pid);
    assert.equal(supervisor.status.restart_attempt, 1);
    assert.throws(() => process.kill(first.pid, 0), { code: "ESRCH" });
    assert.deepEqual(
      (await supervisor.client.list()).map((adapter) => adapter.type),
      ["test"]
    );
  }
);

test(
  "fast replacement exhaustion cools down and recovers on the same Kernel; close cancels the next retry",
  { timeout: 35_000 },
  async (t) => {
    const { client, server } = await kernelFixture(t);
    const original = await client.status();
    for (let index = 0; index < 4; index++) {
      const before = await client.status();
      process.kill(before.worker.pid, "SIGKILL");
      await waitFor(async () => {
        const now = await client.status();
        return index === 3
          ? now.worker.state === "recovering" && now.worker.pid === undefined
          : now.execution_ready && now.worker.generation > before.worker.generation;
      }, 7000);
    }
    const status = await client.status();
    assert.equal(status.execution_ready, false);
    assert.equal(status.worker.restart_attempt, 3);
    await assert.rejects(client.submit(kernelInput()), /KERNEL_UNAVAILABLE/);
    await waitFor(async () => (await client.status()).execution_ready, 18_000);
    const recovered = await client.status();
    assert.equal(recovered.kernel_instance_id, original.kernel_instance_id);
    assert.equal(recovered.pid, original.pid);
    assert.equal(recovered.worker.restart_attempt, 4);
    const next = await client.submit(kernelInput());
    assert.equal((await frames(client, next.ref)).at(-1).control.state, "completed");

    process.kill(recovered.worker.pid, "SIGKILL");
    await waitFor(async () => (await client.status()).worker.pid === undefined);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    assert.equal((await client.status()).worker.state, "recovering");
    assert.equal((await client.status()).worker.restart_attempt, 4);
    const closingAt = performance.now();
    assert.equal((await server.close()).complete, true);
    assert.ok(performance.now() - closingAt < 2000);
    assert.equal((await server.status()).kernel.worker.state, "stopped");
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
