import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { inspect } from "node:util";
import { componentEndpoint } from "@mininglamp-oss/octo-runtime-host-sdk";
import {
  acquireEndpoint,
  spawnWorker,
  createKernelService,
  ServiceInitializationError
} from "@mininglamp-oss/octo-runtime-executor-kernel";
import { withTimeout } from "./runtime-fixture.js";
import { InvocationManifest } from "../packages/octo-runtime-executor-kernel/dist/invocation-manifest.js";

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test("worker cancellation during onSpawn observes pending readiness", async () => {
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

test(
  "native Kernel startup cancellation rolls back worker, endpoint and lease",
  { timeout: 30000 },
  async (t) => {
    const home = await mkdtemp(join(tmpdir(), "ocs-"));
    t.after(() => rm(home, { recursive: true, force: true }));
    const manifestFile = join(home, "kernel-invocations.json");
    const registered = Promise.withResolvers();
    const setWorker = InvocationManifest.prototype.setWorker;
    // 只观察真实登记完成，不替代系统身份查询或持久化；同步点属于父进程的资源所有权。
    t.mock.method(InvocationManifest.prototype, "setWorker", async function (pid, entrypoint) {
      await setWorker.call(this, pid, entrypoint);
      if (pid !== undefined) registered.resolve(pid);
    });
    const options = {
      endpoint: componentEndpoint(home),
      stateDirectory: home,
      workerEntrypoint: resolve("test/fixtures/delayed-startup-worker.mjs")
    };
    const kernel = createKernelService(options);
    t.after(() => kernel.close());
    const controller = new AbortController();
    const starting = kernel.initialize({ signal: controller.signal });
    let startupError;
    void starting.catch((error) => {
      startupError = error;
    });
    t.after(async () => {
      if (startupError && !controller.signal.aborted)
        t.diagnostic(inspect(startupError, { depth: null }));
      t.diagnostic(`Kernel startup status: ${JSON.stringify(await kernel.status())}`);
    });
    // 初始化失败立即传播完整原因，避免吞掉拒绝后只留下轮询超时。
    const worker = await withTimeout(
      Promise.race([
        registered.promise,
        starting.then(() => assert.fail("unready worker unexpectedly initialized"))
      ]),
      15_000,
      "worker ownership registration timed out"
    );
    assert.ok(Number.isSafeInteger(worker) && worker > 0);
    assert.equal(JSON.parse(await readFile(manifestFile, "utf8")).worker.pid, worker);
    controller.abort();
    await assert.rejects(starting, (error) => {
      assert.ok(error instanceof ServiceInitializationError);
      assert.equal(error.cause, controller.signal.reason);
      assert.equal(error.cleanup.complete, true, JSON.stringify(error.cleanup));
      return true;
    });
    assert.equal(alive(worker), false);
    await assert.rejects(access(manifestFile), { code: "ENOENT" });
    if (process.platform !== "win32") {
      await assert.rejects(access(options.endpoint), { code: "ENOENT" });
      await assert.rejects(access(`${options.endpoint}.owner`), { code: "ENOENT" });
    }
    const replacement = createKernelService({
      ...options,
      workerEntrypoint: resolve("test/fixtures/direct-adapter-host.js")
    });
    await replacement.initialize();
    assert.equal((await replacement.close()).complete, true);
  }
);

for (const mode of ["endpoint", "manifest"]) {
  test(
    `Kernel ${mode} cleanup failure retains lease after worker exit`,
    { timeout: 10000, skip: process.platform === "win32" },
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
