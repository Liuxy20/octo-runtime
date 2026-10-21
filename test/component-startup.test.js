import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { componentEndpoint } from "@mininglamp-oss/octo-runtime-host-sdk";
import {
  acquireEndpoint,
  spawnWorker,
  createKernelService,
  ServiceInitializationError
} from "@mininglamp-oss/octo-runtime-executor-kernel";
import { waitFor } from "./runtime-fixture.js";

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
    const pidFile = join(home, "worker-pid");
    const options = {
      endpoint: componentEndpoint(home),
      stateDirectory: home,
      workerEntrypoint: resolve("test/fixtures/delayed-startup-worker.mjs"),
      env: { ...process.env, OCTO_TEST_WORKER_PID: pidFile }
    };
    const kernel = createKernelService(options);
    t.after(() => kernel.close());
    const controller = new AbortController();
    const starting = kernel.initialize({ signal: controller.signal });
    void starting.catch(() => undefined);
    let worker;
    // 文件存在不代表 PID 已写完，空内容会被 Number 转成当前进程组的 0。
    await waitFor(async () => {
      const text = await readFile(pidFile, "utf8").catch(() => "");
      if (!/^[1-9]\d*$/.test(text)) return false;
      worker = Number(text);
      return Number.isSafeInteger(worker);
    });
    controller.abort();
    await assert.rejects(
      starting,
      (error) => error instanceof ServiceInitializationError && error.cleanup.complete
    );
    assert.equal(alive(worker), false);
    await assert.rejects(access(join(home, "kernel-invocations.json")), { code: "ENOENT" });
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
