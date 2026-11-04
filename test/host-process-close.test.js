import assert from "node:assert/strict";
import test from "node:test";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createKernelService } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { componentEndpoint } from "@mininglamp-oss/octo-runtime-host-sdk";
import { testAdapter } from "./fixtures/test-adapter.js";
import { kernelInput } from "./kernel-fixture.js";
import { waitFor } from "./runtime-fixture.js";
import {
  InvocationManifest,
  acknowledgeOrphanCleanup,
  inspectOrphanCleanup
} from "../packages/octo-runtime-executor-kernel/dist/invocation-manifest.js";

for (const failure of [false, true])
  test(`native owner close waits for Adapter cleanup and reports failure=${failure}`, async (t) => {
    const home = await mkdtemp(join(process.platform === "darwin" ? "/tmp" : tmpdir(), "onc-"));
    t.after(() => rm(home, { recursive: true, force: true }));
    let entered = false,
      finalized = false;
    const adapter = {
      ...testAdapter,
      async *invoke(request) {
        entered = true;
        try {
          if (!request.signal.aborted)
            await new Promise((resolve) =>
              request.signal.addEventListener("abort", resolve, { once: true })
            );
        } finally {
          await new Promise((resolve) => setTimeout(resolve, 80));
          finalized = true;
          if (failure) throw new Error("fixture cleanup failed");
        }
      }
    };
    const endpoint = componentEndpoint(home);
    const kernel = createKernelService({
      home: home,
      endpoint,
      adapters: [adapter],
      stateDirectory: home
    });
    await kernel.initialize();
    const record = join(home, "kernel-invocations.json");
    assert.equal((await inspectOrphanCleanup(record)).state, "available");
    await kernel.client.submit(kernelInput());
    await waitFor(() => entered);
    const started = Date.now();
    const closing = kernel.close();
    assert.equal(closing, kernel.close());
    const result = await closing;
    assert.equal(result.complete, !failure);
    assert.equal(finalized, true);
    assert.ok(Date.now() - started < 5500);
    assert.deepEqual(await kernel.closed, result);
    assert.equal((await kernel.status()).kernel.execution_ready, false);
    if (failure) {
      const evidence = JSON.parse(await readFile(record, "utf8"));
      assert.equal(evidence.nativeOwner, true);
      assert.equal(evidence.cleanupIncomplete, true);
      assert.equal(evidence.cleanupFailed, true);
      assert.equal(evidence.worker, undefined);
      assert.equal((await inspectOrphanCleanup(record)).state, "cleanup_incomplete");
      await assert.rejects(acknowledgeOrphanCleanup(record), /ORPHAN_CLEANUP_OWNER_ALIVE/);
    } else await assert.rejects(access(record), { code: "ENOENT" });
  });

test("closing a native service never installs host signal handlers or terminates the host", async () => {
  const signals = ["SIGINT", "SIGTERM", "SIGHUP", "disconnect", "uncaughtExceptionMonitor"];
  const before = signals.map((signal) => process.listenerCount(signal));
  const { nativeHost } = await import("./native-host-fixture.js");
  const host = await nativeHost([testAdapter]);
  await host.close();
  assert.deepEqual(
    signals.map((signal) => process.listenerCount(signal)),
    before
  );
});

test("native orphan evidence blocks replacement until the dead owner's exact record is acknowledged", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "octo-native-orphan-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const path = join(home, "kernel-invocations.json");
  const { manifest } = await InvocationManifest.open(path);
  await manifest.markNativeOwner();
  assert.equal((await inspectOrphanCleanup(path)).state, "available");
  await assert.rejects(acknowledgeOrphanCleanup(path), /ORPHAN_CLEANUP_OWNER_ALIVE/);
  const evidence = JSON.parse(await readFile(path, "utf8"));
  // 模拟异常退出留下的记录；不启动或终止真实宿主进程。
  evidence.kernelPid = 2147483646;
  await writeFile(path, JSON.stringify(evidence));
  assert.equal((await inspectOrphanCleanup(path)).state, "cleanup_incomplete");
  await assert.rejects(InvocationManifest.open(path), { code: "ORPHAN_CLEANUP_INCOMPLETE" });
  const source = await readFile(path, "utf8");
  const { archivePath } = await acknowledgeOrphanCleanup(path);
  assert.equal(await readFile(archivePath, "utf8"), source);
  assert.equal((await inspectOrphanCleanup(path)).state, "acknowledged");
  // 旧确认不能放行后来变化的记录，即使 owner PID 没变。
  await writeFile(
    path,
    JSON.stringify({
      ...evidence,
      updatedAt: new Date(Date.parse(evidence.updatedAt) + 1000).toISOString()
    })
  );
  await assert.rejects(InvocationManifest.open(path), { code: "ORPHAN_CLEANUP_INCOMPLETE" });
  await acknowledgeOrphanCleanup(path);
  const replacement = await InvocationManifest.open(path);
  assert.equal(replacement.reap.reason, "cleanup_acknowledged");
  assert.equal(replacement.reap.reaped, false);
  await replacement.manifest.close();
  assert.equal(await readFile(archivePath, "utf8"), source);
});

test("cleanup diagnostics distinguish live native ownership from failure and reject legacy records", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "octo-cleanup-diagnostics-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const path = join(home, "kernel-invocations.json");
  const { manifest } = await InvocationManifest.open(path);
  await manifest.markNativeOwner();
  assert.equal((await inspectOrphanCleanup(path)).state, "available");
  await manifest.markCleanupIncomplete();
  assert.equal((await inspectOrphanCleanup(path)).state, "cleanup_incomplete");
  await assert.rejects(acknowledgeOrphanCleanup(path), /ORPHAN_CLEANUP_OWNER_ALIVE/);
  // 旧 worker 记录不迁移、不删除，也不能通过人工确认转成原生记录。
  await writeFile(
    path,
    JSON.stringify({
      schemaVersion: 1,
      kernelPid: process.pid,
      cleanupIncomplete: true,
      worker: { pid: process.pid, started: "fixture", entrypoint: "fixture" },
      invocations: []
    })
  );
  const legacy = await readFile(path, "utf8");
  assert.equal((await inspectOrphanCleanup(path)).state, "unsupported");
  await assert.rejects(acknowledgeOrphanCleanup(path), { code: "ORPHAN_RECORD_UNSUPPORTED" });
  await assert.rejects(InvocationManifest.open(path), { code: "ORPHAN_RECORD_UNSUPPORTED" });
  assert.equal(await readFile(path, "utf8"), legacy);
});
