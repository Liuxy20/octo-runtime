import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { componentEndpoint } from "@mininglamp-oss/octo-runtime-host-sdk";
import {
  createKernelService,
  ServiceInitializationError,
  InvocationManifest
} from "@mininglamp-oss/octo-runtime-executor-kernel";
import { testAdapter } from "./fixtures/test-adapter.js";

test("native startup cancellation rolls back Core, endpoint and lease and permits explicit replacement", async (t) => {
  const home = await mkdtemp(join(process.platform === "darwin" ? "/tmp" : tmpdir(), "ocs-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const controller = new AbortController();
  const original = InvocationManifest.prototype.markNativeOwner;
  t.mock.method(InvocationManifest.prototype, "markNativeOwner", async function () {
    await original.call(this);
    controller.abort();
  });
  const options = {
    endpoint: componentEndpoint(home),
    stateDirectory: home,
    adapters: [testAdapter]
  };
  const kernel = createKernelService(options);
  await assert.rejects(kernel.initialize({ signal: controller.signal }), (error) => {
    assert.ok(error instanceof ServiceInitializationError);
    assert.equal(error.cleanup.complete, true);
    return true;
  });
  await assert.rejects(access(join(home, "kernel-invocations.json")), { code: "ENOENT" });
  if (process.platform !== "win32")
    await assert.rejects(access(`${options.endpoint}.owner`), { code: "ENOENT" });
  t.mock.restoreAll();
  const replacement = createKernelService(options);
  await replacement.initialize();
  assert.equal((await replacement.close()).complete, true);
});
