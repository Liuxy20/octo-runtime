import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  createKernelService,
  isInvocationNotSubmitted,
  KernelError
} from "@mininglamp-oss/octo-runtime-executor-kernel";
import { componentEndpoint } from "@mininglamp-oss/octo-runtime-host-sdk";
import { runCli } from "../apps/cli/dist/main.js";
import { kernelInput } from "./kernel-fixture.js";
import { waitFor } from "./runtime-fixture.js";
import { WorkerSupervisor } from "../packages/octo-runtime-executor-kernel/dist/supervisor.js";
import { RuntimeLogging } from "../packages/octo-runtime-adapter-sdk/dist/index.js";
import { setTimeout as delay } from "node:timers/promises";

async function fixture(t, incomplete = false) {
  const home = await mkdtemp(join(process.platform === "win32" ? tmpdir() : "/tmp", "kr-"));
  const state = join(home, "state");
  const service = createKernelService({
    endpoint: componentEndpoint(home),
    stateDirectory: state,
    logging: { directory: join(home, "logs") },
    workerEntrypoint: resolve("packages/octo-runtime-executor-kernel/dist/runner.js"),
    manifest: resolve("test/fixtures/adapters.json")
  });
  t.after(async () => {
    const cleanup = await service.close();
    t.mock.restoreAll();
    assert.equal(cleanup.complete, !incomplete);
    await rm(home, { recursive: true, force: true });
  });
  await service.initialize();
  return { home, state, service, client: service.client, before: await service.client.status() };
}

async function successfulNewRun(client) {
  const events = [];
  for await (const event of client.invoke(kernelInput())) events.push(event);
  assert.equal(events.at(-1).type, "run.completed");
}

function blockProbe(t, pid) {
  const kill = process.kill.bind(process);
  let probes = 0;
  const mock = t.mock.method(process, "kill", (target, signal) => {
    if (target === -pid && signal === 0) {
      probes++;
      throw Object.assign(new Error("private probe body"), { code: "EPERM" });
    }
    return kill(target, signal);
  });
  return { restore: () => mock.mock.restore(), probes: () => probes };
}

test(
  "cleanup failure is diagnosed, retried, and recovers new requests within five seconds of release",
  {
    timeout: 12_000,
    skip: process.platform === "win32"
  },
  async (t) => {
    const f = await fixture(t);
    const probe = blockProbe(t, f.before.worker.pid);
    process.kill(f.before.worker.pid, "SIGKILL");
    await waitFor(async () => (await f.client.status()).worker.state === "exhausted");
    const blocked = await f.client.status();
    assert.equal(blocked.worker.generation, 1);
    assert.equal(blocked.worker.restart_attempt, 0);
    assert.equal(blocked.worker.recovery.stage, "cleanup");
    assert.equal(blocked.worker.recovery.code, "PROCESS_CLEANUP_TIMEOUT");
    assert.equal(blocked.worker.recovery.signal, "SIGKILL");
    assert.ok(Date.parse(blocked.worker.recovery.retry_at) > Date.now());
    await assert.rejects(
      async () => {
        for await (const event of f.client.invoke(kernelInput())) void event;
      },
      (error) => {
        assert.equal(isInvocationNotSubmitted(error), true);
        assert.equal(isInvocationNotSubmitted(new KernelError(error.code, error.data)), false);
        return error.code === "WORKER_RESTART_EXHAUSTED";
      }
    );
    const released = performance.now();
    probe.restore();
    await waitFor(async () => (await f.client.status()).execution_ready, 6000);
    await successfulNewRun(f.client);
    assert.ok(performance.now() - released < 5000);
    const recovered = await f.client.status();
    assert.equal(recovered.kernel_instance_id, f.before.kernel_instance_id);
    assert.equal(recovered.pid, f.before.pid);
    assert.equal(recovered.worker.recovery, undefined);
    assert.equal((await f.service.close()).complete, true);
    const output = [];
    assert.equal(
      await runCli(["executor-kernel", "logs", "--home", f.home, "--json"], {
        output: (line) => output.push(JSON.parse(line)),
        errorOutput() {}
      }),
      0
    );
    const diagnosis = output.find((row) => row.event === "worker.recovery_blocked");
    assert.equal(diagnosis.data.code, "PROCESS_CLEANUP_TIMEOUT");
    assert.equal(diagnosis.data.signal, "SIGKILL");
    assert.equal(diagnosis.data.generation, 1);
    assert.ok(output.some((row) => row.event === "worker.ready" && row.data.generation === 2));
    assert.doesNotMatch(JSON.stringify(output), /private probe body|run_id|session_id/);
    t.diagnostic(
      `cleanup released to successful new request: ${Math.round(performance.now() - released)}ms`
    );
  }
);

test(
  "persistent cleanup failure keeps retrying without creating a second worker; close cancels the wait",
  {
    timeout: 12_000,
    skip: process.platform === "win32"
  },
  async (t) => {
    const f = await fixture(t, true);
    const probe = blockProbe(t, f.before.worker.pid);
    process.kill(f.before.worker.pid, "SIGKILL");
    await waitFor(async () => (await f.client.status()).worker.state === "exhausted");
    const first = (await f.client.status()).worker.recovery.retry_at;
    const probes = probe.probes();
    await waitFor(async () => (await f.client.status()).worker.recovery.retry_at !== first, 5000);
    assert.ok(probe.probes() > probes);
    assert.equal((await f.client.status()).worker.generation, 1);
    const closingAt = performance.now();
    assert.equal((await f.service.close()).complete, false);
    assert.ok(performance.now() - closingAt < 1000);
  }
);

test(
  "a reused leader PID blocks recovery without sending a signal to the historical process group",
  { timeout: 12_000, skip: process.platform === "win32" },
  async (t) => {
    const f = await fixture(t);
    const pid = f.before.worker.pid;
    const kill = process.kill.bind(process);
    let groupSignals = 0;
    const mock = t.mock.method(process, "kill", (target, signal) => {
      if (target === pid && signal === 0) return true;
      if (target === -pid && signal !== 0) groupSignals++;
      return kill(target, signal);
    });
    t.after(() => mock.mock.restore());
    process.kill(pid, "SIGKILL");
    await waitFor(async () => (await f.client.status()).worker.state === "exhausted");
    assert.equal(
      (await f.client.status()).worker.recovery.code,
      "WORKER_PROCESS_IDENTITY_CONFLICT"
    );
    assert.equal(groupSignals, 0);
    assert.equal((await f.client.status()).worker.generation, 1);
    mock.mock.restore();
    await waitFor(async () => (await f.client.status()).execution_ready, 6000);
    await successfulNewRun(f.client);
  }
);

test(
  "real manifest IO failure does not poison later writes or require Kernel restart",
  { timeout: 12_000 },
  async (t) => {
    const f = await fixture(t);
    const backup = `${f.state}-saved`;
    await rename(f.state, backup);
    await writeFile(f.state, "blocked-directory");
    process.kill(f.before.worker.pid, "SIGKILL");
    await waitFor(async () => (await f.client.status()).worker.state === "exhausted");
    const blocked = await f.client.status();
    assert.equal(blocked.worker.recovery.stage, "manifest");
    assert.equal(blocked.worker.recovery.code, "EEXIST");
    assert.equal(blocked.worker.restart_attempt, 0);
    const released = performance.now();
    await rm(f.state);
    await rename(backup, f.state);
    await waitFor(async () => (await f.client.status()).execution_ready, 6000);
    await successfulNewRun(f.client);
    assert.ok(performance.now() - released < 5000);
    const manifest = JSON.parse(await readFile(join(f.state, "kernel-invocations.json"), "utf8"));
    assert.equal(manifest.worker.pid, (await f.client.status()).worker.pid);
    assert.notEqual(manifest.worker.pid, f.before.worker.pid);
    t.diagnostic(
      `manifest restored to successful new request: ${Math.round(performance.now() - released)}ms`
    );
  }
);

test("Kernel logs reads a separate sanitized series with broken config and no manager", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "kl-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  await mkdir(join(home, "logs"));
  await writeFile(join(home, "config.json"), "broken");
  await writeFile(join(home, "logs", "kernel-20261027T00.log"), '{"text":"PRIVATE_BODY"}\n');
  await writeFile(
    join(home, "logs", "kernel-status-20261027T00.log"),
    JSON.stringify({
      time: "2026-10-27T00:00:00.000Z",
      source: "kernel",
      level: "warn",
      event: "worker.recovery_blocked",
      data: { stage: "manifest", code: "EIO", generation: 1, text: "PRIVATE_BODY" }
    }) +
      "\n" +
      JSON.stringify({ source: "kernel", level: "warn", event: "worker.lost", data: {} }) +
      "\n"
  );
  const output = [];
  assert.equal(
    await runCli(["executor-kernel", "logs", "--home", home, "--json"], {
      output: (line) => output.push(JSON.parse(line)),
      errorOutput() {},
      backend: new Proxy(
        {},
        {
          get() {
            assert.fail("logs accessed manager");
          }
        }
      )
    }),
    0
  );
  assert.equal(output.length, 1);
  assert.deepEqual(output[0].data, { code: "EIO", stage: "manifest", generation: 1 });
  assert.doesNotMatch(JSON.stringify(output), /PRIVATE_BODY|text/);
  assert.deepEqual((await readdir(join(home, "logs"))).sort(), [
    "kernel-20261027T00.log",
    "kernel-status-20261027T00.log"
  ]);
});

test(
  "parent logging closes alongside the worker within the shared shutdown deadline",
  { timeout: 20_000 },
  async (t) => {
    const f = await fixture(t);
    const closeWorker = WorkerSupervisor.prototype.close;
    const closeLogging = RuntimeLogging.prototype.close;
    t.mock.method(WorkerSupervisor.prototype, "close", async function (...args) {
      const started = performance.now();
      await closeWorker.apply(this, args);
      // 包含真实平台清理耗时，总确认时间固定在原五秒期限内，不另加人工预算。
      await delay(Math.max(0, 4400 - (performance.now() - started)));
    });
    t.mock.method(RuntimeLogging.prototype, "close", async function () {
      await delay(1000);
      await closeLogging.call(this);
    });
    const result = await f.service.close();
    assert.equal(result.complete, true, JSON.stringify(result));
  }
);

test(
  "failed replacement startup retries its actual rollback cleanup before starting another worker",
  { timeout: 12_000, skip: process.platform === "win32" },
  async (t) => {
    let spawned = 0;
    let probe;
    let failedPid;
    const supervisor = new WorkerSupervisor(
      { entrypoint: resolve("test/fixtures/heartbeat-worker.mjs") },
      async (pid) => {
        if (pid === undefined || ++spawned !== 2) return;
        failedPid = pid;
        probe = blockProbe(t, pid);
        throw Object.assign(new Error("private manifest startup error"), { code: "EIO" });
      }
    );
    t.after(async () => {
      probe?.restore();
      await supervisor.close();
    });
    await supervisor.start();
    process.kill(supervisor.status.pid, "SIGKILL");
    await waitFor(() => supervisor.status.state === "exhausted");
    assert.equal(spawned, 2);
    assert.equal(supervisor.status.recovery.stage, "cleanup");
    assert.equal(supervisor.status.recovery.code, "PROCESS_CLEANUP_TIMEOUT");
    assert.throws(() => process.kill(failedPid, 0), { code: "ESRCH" });
    const released = performance.now();
    probe.restore();
    await waitFor(() => supervisor.status.state === "ready", 6000);
    assert.ok(performance.now() - released < 5000);
    assert.equal(spawned, 3);
    assert.equal(supervisor.status.generation, 2);
    assert.equal(supervisor.status.restart_attempt, 2);
    assert.deepEqual(
      (await supervisor.client.list()).map((adapter) => adapter.type),
      ["test"]
    );
  }
);
