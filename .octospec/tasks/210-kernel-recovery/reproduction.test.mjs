import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createKernelService,
  isInvocationNotSubmitted
} from "@mininglamp-oss/octo-runtime-executor-kernel";
import { invocationInput } from "@mininglamp-oss/octo-runtime-protocol";
import { invokeRequest, waitFor } from "../../../test/runtime-fixture.js";
import { InvocationManifest } from "../../../packages/octo-runtime-executor-kernel/dist/invocation-manifest.js";
import { ImTask } from "../../../packages/octo-runtime-extra-channel-gateway/dist/execution/task.js";

// 每个场景拥有自己的 Home/socket/worker；预期 incomplete 只保留本场景证据，不碰用户服务。
async function fixture(t, blocked = false) {
  const directory = await mkdtemp("/tmp/o210-");
  const service = createKernelService({
    endpoint: join(directory, "k.sock"),
    stateDirectory: directory,
    workerEntrypoint: fileURLToPath(new URL("codex-worker.mjs", import.meta.url)),
    env: {
      ...process.env,
      CODEX_HOME: join(directory, "codex"),
      ISSUE_210_CODEX_PID_PATH: join(directory, "app-server.pid")
    }
  });
  t.after(async () => {
    t.mock.restoreAll();
    const cleanup = await service.close();
    assert.equal(cleanup.complete, !blocked);
    await rm(directory, { recursive: true, force: true });
  });
  await service.initialize();
  const input = (prompt = "complete") =>
    invocationInput(
      invokeRequest({
        prompt,
        modelInput: prompt,
        runId: randomUUID(),
        invocationId: randomUUID(),
        workdir: directory,
        approvalMode: "full_access"
      }),
      "canonical",
      "codex"
    );
  const invoke = async (prompt) => {
    const events = [];
    for await (const event of service.client.invoke(input(prompt))) events.push(event);
    return events;
  };
  assert.equal((await invoke()).at(-1).type, "run.completed");
  return { directory, service, input, invoke, before: await service.client.status() };
}

test(
  "Codex app-server EOF fails one run without killing the shared worker",
  { timeout: 10_000 },
  async (t) => {
    const f = await fixture(t);
    assert.equal((await f.invoke("eof")).at(-1).type, "run.failed");
    const after = await f.service.client.status();
    assert.deepEqual(after, f.before);
    assert.equal((await f.invoke()).at(-1).type, "run.completed");
    t.diagnostic("Codex subprocess failure: worker generation=1, ready=true; next run completed");
  }
);

test(
  "dead Codex worker with confirmed cleanup automatically admits new work",
  { timeout: 10_000 },
  async (t) => {
    const f = await fixture(t);
    process.kill(f.before.worker.pid, "SIGKILL");
    await waitFor(async () => (await f.service.client.status()).worker.generation === 2);
    const after = await f.service.client.status();
    assert.equal(after.execution_ready, true);
    assert.equal(after.worker.restart_attempt, 1);
    assert.equal(after.kernel_instance_id, f.before.kernel_instance_id);
    assert.equal(after.pid, f.before.pid);
    assert.equal((await f.invoke()).at(-1).type, "run.completed");
    t.diagnostic(
      "Worker exit: same Kernel, generation=2, restart_attempt=1; next Codex run completed"
    );
  }
);

test(
  "worker loss during Codex execution remains unknown while new work recovers",
  { timeout: 10_000 },
  async (t) => {
    const f = await fixture(t);
    let codexPid;
    let sessionObserved = false;
    const consume = (async () => {
      try {
        for await (const event of f.service.client.invoke(f.input("hang"))) {
          if (event.type === "session.update") sessionObserved = true;
        }
        return undefined;
      } catch (error) {
        return error.code;
      }
    })();
    const alive = (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        if (error.code === "ESRCH") return false;
        throw error;
      }
    };
    try {
      await waitFor(() => sessionObserved);
      codexPid = Number(await readFile(join(f.directory, "app-server.pid"), "utf8"));
      assert.equal(alive(codexPid), true);
      process.kill(f.before.worker.pid, "SIGKILL");
      assert.equal(await consume, "RUN_OUTCOME_UNKNOWN");
      await waitFor(async () => (await f.service.client.status()).worker.generation === 2);
      const after = await f.service.client.status();
      assert.equal(after.execution_ready, true);
      await waitFor(() => !alive(codexPid));
      assert.equal((await f.invoke()).at(-1).type, "run.completed");
      t.diagnostic(
        "Admitted Codex run is unknown; fixture exits on stdin EOF; generation=2 admits new work"
      );
    } finally {
      // 只回收刚记录的本场景进程组；测试不能把自己的残留进程留给系统或用户。
      codexPid ??= Number(await readFile(join(f.directory, "app-server.pid"), "utf8"));
      if (alive(codexPid)) process.kill(-codexPid, "SIGKILL");
      await waitFor(() => !alive(codexPid));
      await consume;
    }
  }
);

for (const fault of ["process-group-probe", "manifest-write"]) {
  test(`reproduce exhausted before replacement: ${fault}`, { timeout: 10_000 }, async (t) => {
    const f = await fixture(t);
    if (fault === "process-group-probe") {
      const original = process.kill.bind(process);
      t.mock.method(process, "kill", (pid, signal) => {
        if (pid === -f.before.worker.pid && signal === 0)
          throw Object.assign(new Error("injected group probe denial"), { code: "EPERM" });
        return original(pid, signal);
      });
    } else {
      const original = InvocationManifest.prototype.setWorker;
      t.mock.method(InvocationManifest.prototype, "setWorker", function (pid, entrypoint) {
        if (pid === undefined)
          throw Object.assign(new Error("injected manifest write failure"), { code: "EIO" });
        return original.call(this, pid, entrypoint);
      });
    }
    process.kill(f.before.worker.pid, "SIGKILL");
    await waitFor(async () => (await f.service.client.status()).worker.state === "exhausted");
    assert.throws(() => process.kill(f.before.worker.pid, 0), { code: "ESRCH" });
    const status = await f.service.client.status();
    assert.equal(status.worker.state, "exhausted");
    assert.equal(status.worker.generation, 1);
    assert.equal(status.worker.restart_attempt, 0);
    assert.equal(status.execution_ready, false);
    assert.equal(status.kernel_instance_id, f.before.kernel_instance_id);
    const manifest = JSON.parse(
      await readFile(join(f.directory, "kernel-invocations.json"), "utf8")
    );
    assert.equal(manifest.worker.pid, f.before.worker.pid);
    assert.deepEqual(manifest.invocations, []);
    const task = new ImTask(f.service.client, f.input(), "codex", {}, {}, () => {});
    await assert.rejects(
      async () => {
        for await (const event of task.events()) void event;
      },
      (error) => {
        assert.equal(error.code, "WORKER_RESTART_EXHAUSTED");
        assert.equal(isInvocationNotSubmitted(error), true);
        return true;
      }
    );
    assert.equal(task.attempts.length, 1);
    assert.equal(task.attempts[0].outcome, "not_submitted");
    assert.equal(task.notSubmittedFailure.code, "OH-RUN-2012");
    assert.deepEqual(f.service.client.invocations.snapshot(), []);
    const releasedAt = performance.now();
    t.mock.restoreAll();
    await waitFor(async () => (await f.service.client.status()).execution_ready, 7000);
    assert.equal((await f.invoke()).at(-1).type, "run.completed");
    const elapsed = performance.now() - releasedAt;
    assert.ok(elapsed < 5000, `recovery took ${elapsed}ms`);
    t.diagnostic(
      JSON.stringify({
        fault,
        worker: status.worker,
        execution_ready: status.execution_ready,
        dead_pid: true,
        retained_manifest_worker: true,
        gateway_attempt: task.attempts[0].outcome,
        not_submitted_proof: true,
        recovered_after_release_ms: Math.round(elapsed)
      })
    );
  });
}
