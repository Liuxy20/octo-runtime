import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  ComponentStartError,
  startExtra,
  startOwnedKernel,
  componentEndpoint
} from "@mininglamp-oss/octo-runtime-host-sdk";
import { waitFor } from "./runtime-fixture.js";
import { acquireEndpoint, spawnWorker } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { launchNode } from "../packages/octo-runtime-host-sdk/dist/launch.js";

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
async function startupFixture(t) {
  const home = await mkdtemp(join(tmpdir(), "ocs-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  return {
    home,
    pidFile: join(home, "worker-pid"),
    options: {
      endpoint: componentEndpoint(home),
      stateDirectory: home,
      entrypoint: resolve("test/fixtures/startup-kernel-entry.mjs"),
      workerEntrypoint: resolve("test/fixtures/delayed-startup-worker.mjs"),
      env: { ...process.env, OCTO_TEST_WORKER_PID: join(home, "worker-pid") }
    }
  };
}
async function identities(t, fixture, startupFailure = () => undefined) {
  let identity;
  try {
    await waitFor(async () => {
      if (startupFailure()) throw startupFailure();
      try {
        const worker = Number(await readFile(fixture.pidFile, "utf8"));
        const manifest = JSON.parse(
          await readFile(join(fixture.home, "kernel-invocations.json"), "utf8")
        );
        if (manifest.worker?.pid !== worker) return false;
        identity = { worker, kernel: manifest.kernelPid };
        return true;
      } catch {
        return false;
      }
    }, 15_000);
  } catch (error) {
    const files = await Promise.allSettled(
      [
        fixture.pidFile,
        join(fixture.home, "kernel-invocations.json"),
        join(fixture.home, "startup-diagnostics")
      ].map((file) => readFile(file, "utf8"))
    );
    throw new Error(
      `startup identity unavailable: ${JSON.stringify({ files, cleanup: startupFailure()?.cleanup })}`,
      { cause: error }
    );
  }
  t.after(() => {
    for (const pid of Object.values(identity)) {
      if (alive(pid)) process.kill(pid, "SIGKILL");
    }
  });
  return identity;
}
async function assertReleased(fixture, identity) {
  const manifest = join(fixture.home, "kernel-invocations.json");
  await waitFor(async () => {
    if (alive(identity.worker) || alive(identity.kernel)) return false;
    try {
      await access(manifest);
      return false;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return true;
    }
  }, 10_000).catch(async (error) => {
    const remaining = await readFile(manifest, "utf8").catch(() => "absent");
    const diagnostics = await readFile(join(fixture.home, "startup-diagnostics"), "utf8").catch(
      () => "absent"
    );
    throw new Error(`Kernel startup rollback incomplete: ${remaining}; ${diagnostics}`, {
      cause: error
    });
  });
  await assert.rejects(access(join(fixture.home, "kernel-invocations.json")), { code: "ENOENT" });
  if (process.platform !== "win32") {
    await assert.rejects(access(fixture.options.endpoint), { code: "ENOENT" });
    await assert.rejects(access(`${fixture.options.endpoint}.owner`), { code: "ENOENT" });
  }
  const replacement = await startOwnedKernel({
    ...fixture.options,
    workerEntrypoint: resolve("test/fixtures/direct-adapter-host.js")
  });
  assert.equal((await replacement.stop()).complete, true);
}

test("worker cancellation during onSpawn observes the pending readiness request", async () => {
  const controller = new AbortController();
  await assert.rejects(
    spawnWorker({
      entrypoint: resolve("test/fixtures/direct-adapter-host.js"),
      signal: controller.signal,
      onSpawn: async () => controller.abort()
    }),
    /spawn cancelled/
  );
});

test("startup rollback ACK remains authoritative when the stop send races IPC close", async () => {
  await assert.rejects(
    launchNode(resolve("test/fixtures/startup-ack-race.mjs"), {}, (child) => {
      const send = child.send.bind(child);
      child.send = (message, ...args) => {
        if (message.type === "component.stop") throw new Error("fixture closed IPC send");
        return send(message, ...args);
      };
    }),
    (error) => {
      assert.ok(error instanceof ComponentStartError);
      assert.equal(error.cleanup.complete, true, JSON.stringify(error.cleanup));
      return true;
    }
  );
});

test(
  "owner exit during Kernel readiness rolls back worker, endpoint and lease",
  { timeout: 30_000 },
  async (t) => {
    const fixture = await startupFixture(t);
    const owner = fork(
      resolve("test/fixtures/startup-owner.mjs"),
      [JSON.stringify(fixture.options)],
      {
        stdio: ["ignore", "ignore", "ignore", "ipc"]
      }
    );
    t.after(() => {
      if (owner.exitCode === null) owner.kill("SIGKILL");
    });
    const identity = await identities(t, fixture);
    const exited = once(owner, "exit");
    owner.send("exit");
    await exited;
    await assertReleased(fixture, identity);
  }
);

test(
  "cancelling Kernel startup interrupts readiness and completes rollback",
  { timeout: 30_000 },
  async (t) => {
    const fixture = await startupFixture(t);
    const controller = new AbortController();
    const starting = startOwnedKernel({ ...fixture.options, signal: controller.signal });
    let startupFailure;
    void starting.catch((error) => {
      startupFailure = error;
    });
    t.after(async () => {
      controller.abort();
      const kernel = await starting.catch(() => undefined);
      await kernel?.stop();
    });
    const identity = await identities(t, fixture, () => startupFailure);
    controller.abort();
    await assert.rejects(starting, (error) => {
      assert.ok(error instanceof ComponentStartError);
      assert.equal(error.cleanup.complete, true);
      return true;
    });
    await assertReleased(fixture, identity);
  }
);

for (const mode of ["initialize", "dispose", "unref"]) {
  test(
    `owner exit bounds Extra shutdown with an uncooperative ${mode}, handle and child`,
    { timeout: 15_000 },
    async (t) => {
      const home = await mkdtemp(join(tmpdir(), "oeo-"));
      const pidFile = join(home, "pid");
      const disposed = join(home, "disposed");
      const controlEndpoint = componentEndpoint(home);
      const owner = fork(
        resolve("test/fixtures/extra-owner.mjs"),
        [
          JSON.stringify({
            endpoint: componentEndpoint(home, "kernel"),
            controlEndpoint,
            declaration: {
              name: "uncooperative",
              module: resolve("test/fixtures/uncooperative-extra.mjs"),
              config: { mode, pidFile, disposed }
            }
          })
        ],
        { stdio: ["ignore", "ignore", "ignore", "ipc"] }
      );
      let identity;
      const ready = once(owner, "message");
      const exited = once(owner, "exit");
      t.after(async () => {
        if (owner.exitCode === null && owner.signalCode === null) owner.kill("SIGKILL");
        for (const pid of Object.values(identity ?? {})) {
          if (alive(pid)) process.kill(pid, "SIGKILL");
        }
        await exited;
        await rm(home, { recursive: true, force: true });
      });
      await waitFor(async () => {
        identity = await readFile(pidFile, "utf8")
          .then(JSON.parse)
          .catch(() => undefined);
        return identity?.extra && identity?.child;
      }, 5000);
      if (mode !== "initialize") assert.equal((await ready)[0].type, "ready");
      assert.equal(alive(identity.extra), true);
      assert.equal(alive(identity.child), true);
      owner.send("exit");
      await exited;
      await waitFor(() => Object.values(identity).every((pid) => !alive(pid)), 6500);
      assert.equal(alive(owner.pid), false);
      if (mode === "initialize") {
        await assert.rejects(access(disposed), { code: "ENOENT" });
      } else {
        assert.equal(await readFile(disposed, "utf8"), "disposing");
        if (mode === "dispose" && process.platform !== "win32")
          await access(`${controlEndpoint}.owner`);
      }
    }
  );
}

for (const mode of ["endpoint", "manifest"]) {
  test(
    `Kernel ${mode} cleanup failure retains the endpoint lease after worker exit`,
    { timeout: 10_000, skip: process.platform === "win32" },
    async (t) => {
      const home = await mkdtemp(join(tmpdir(), "okc-"));
      const child = fork(resolve("test/fixtures/kernel-cleanup-failure.mjs"), [home, mode], {
        stdio: ["ignore", "ignore", "pipe", "ipc"]
      });
      let stderr = "";
      child.stderr.on("data", (chunk) => (stderr += chunk));
      const exited = once(child, "exit");
      let worker;
      t.after(async () => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        if (worker && alive(worker)) process.kill(worker, "SIGKILL");
        await exited;
        await rm(home, { recursive: true, force: true });
      });
      const [result] = await once(child, "message");
      worker = result.worker;
      assert.equal(result.code, "KERNEL_CLEANUP_INCOMPLETE", stderr);
      assert.equal(alive(worker), false);
      const endpoint = join(home, "kernel.sock");
      assert.equal(JSON.parse(await readFile(`${endpoint}.owner`, "utf8")).pid, child.pid);
      await assert.rejects(acquireEndpoint(endpoint), /ENDPOINT_IN_USE/);
      child.send("exit");
      await exited;
    }
  );
}

test("Extra forced disposal reports process exit without releasing failed ownership", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "oef-"));
  const options = {
    endpoint: componentEndpoint(home),
    declaration: {
      name: "uncooperative",
      module: resolve("test/fixtures/uncooperative-extra.mjs"),
      config: { mode: "dispose", pidFile: join(home, "pid"), disposed: join(home, "disposed") }
    }
  };
  const extra = await startExtra(options);
  t.after(async () => {
    await extra.stop();
    await rm(home, { recursive: true, force: true });
  });
  const identity = JSON.parse(await readFile(options.declaration.config.pidFile, "utf8"));
  const result = await extra.stop();
  assert.equal(result.complete, false);
  assert.equal(result.processExited, true);
  assert.ok(result.errors.some((error) => error.code === "COMPONENT_CLEANUP_INCOMPLETE"));
  await waitFor(() => Object.values(identity).every((pid) => !alive(pid)), 2000);
  await assert.rejects(startExtra(options), /EXTRA_DISPOSE_FAILED/);
});

test("Extra initialization failure preserves rollback facts and blocks failed disposal replacement", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "oes-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const trace = join(home, "trace");
  const options = {
    endpoint: componentEndpoint(home),
    declaration: {
      name: "startup-extra",
      module: resolve("test/fixtures/startup-extra.mjs"),
      config: { trace, failStart: true }
    }
  };
  await assert.rejects(startExtra(options), (error) => {
    assert.ok(error instanceof ComponentStartError);
    assert.equal(error.message, "EXTRA_START_FAILED");
    assert.equal(error.cleanup.complete, true, JSON.stringify(error.cleanup));
    return true;
  });
  const extra = await startExtra({
    ...options,
    declaration: { ...options.declaration, config: { trace } }
  });
  assert.equal((await extra.stop()).complete, true);
  options.declaration.config.failDispose = true;
  await assert.rejects(startExtra(options), (error) => {
    assert.ok(error instanceof ComponentStartError);
    assert.equal(error.cleanup.complete, false);
    assert.equal(error.cleanup.processExited, true);
    return true;
  });
  await assert.rejects(startExtra(options), /EXTRA_DISPOSE_FAILED/);
  assert.equal(
    await readFile(trace, "utf8"),
    "initialize\ndispose\ninitialize\ndispose\ninitialize\ndispose\n"
  );
});

test("failed Kernel restart retains replacement cleanup instead of the old stopped handle", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "ork-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const kernel = await startOwnedKernel({
    endpoint: componentEndpoint(home),
    stateDirectory: home,
    workerEntrypoint: resolve("test/fixtures/direct-adapter-host.js"),
    entrypoint: resolve("test/fixtures/restart-startup-failure.mjs")
  });
  await assert.rejects(kernel.restart(), (error) => {
    assert.ok(error instanceof ComponentStartError);
    assert.equal(error.cleanup.complete, false);
    return true;
  });
  assert.equal((await kernel.stop()).complete, false);
  await assert.rejects(kernel.restart(), /COMPONENT_CLEANUP_INCOMPLETE/);
  assert.equal(await readFile(join(home, "launch-count"), "utf8"), "2");
});

test(
  "Extra startup rollback includes unfinished host dependency ownership",
  { timeout: 10_000 },
  async (t) => {
    let release;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    t.after(() => release([]));
    let calls = 0;
    const options = {
      endpoint: "/unused-kernel.sock",
      declaration: {
        name: "startup-proxy",
        module: resolve("test/fixtures/startup-proxy-extra.mjs"),
        config: {}
      },
      dependencies: {
        loadContexts: () => {
          calls++;
          return pending;
        }
      }
    };
    await assert.rejects(startExtra(options), (error) => {
      assert.ok(error instanceof ComponentStartError);
      assert.equal(error.cleanup.complete, false);
      assert.equal(error.cleanup.processExited, true);
      assert.ok(error.cleanup.pendingResources.includes("loadContexts"));
      assert.ok(error.cleanup.errors.some(({ code }) => code === "DEPENDENCY_CLEANUP_INCOMPLETE"));
      return true;
    });
    assert.equal(calls, 1);
    await assert.rejects(startExtra(options), /EXTRA_DISPOSE_FAILED/);
  }
);
