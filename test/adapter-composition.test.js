import { fixtureHome } from "./fixtures/service-home.js";
import assert from "node:assert/strict";
import test from "node:test";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { createKernelService } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { nativeHost } from "./native-host-fixture.js";
import { testAdapter } from "./fixtures/test-adapter.js";
import { kernelInput } from "./kernel-fixture.js";

test("native Kernel preserves Adapter prototype, this, closure and live host dependencies over RPC", async (t) => {
  let value = "first",
    calls = 0;
  const dependency = () => value;
  class Adapter {
    metadata = testAdapter.metadata;
    async *invoke(request) {
      assert.equal(this, adapter);
      assert.equal(process.pid, ownerPid);
      calls++;
      yield* testAdapter.invoke({ ...request, prompt: dependency() });
    }
  }
  const ownerPid = process.pid;
  const adapter = new Adapter();
  const selection = [adapter];
  // 禁止宿主接入隐式拉起 Node/CLI/worker；Adapter fixture 本身不需要 Provider 子进程。
  const original = childProcess.spawn;
  childProcess.spawn = () => {
    throw new Error("unexpected execution process");
  };
  syncBuiltinESMExports();
  t.after(() => {
    childProcess.spawn = original;
    syncBuiltinESMExports();
  });
  const host = await nativeHost(selection);
  t.after(() => host.close());
  selection.length = 0;
  assert.equal((await host.client.status()).pid, ownerPid);
  assert.equal("worker" in (await host.client.status()), false);
  assert.equal(host.kernel.client.topology, "kernel-ipc");
  for (const next of ["first", "second"]) {
    value = next;
    const events = await Array.fromAsync(host.client.invoke(kernelInput()));
    assert.equal(
      events.findLast((e) => e.type === "message.update").payload.text,
      `Handled: ${next}`
    );
    assert.equal(events.at(-1).type, "run.completed");
  }
  assert.equal(calls, 2);
  assert.equal(Object.isFrozen(adapter), false);
});

test("native Kernel accepts an explicit empty selection and rejects duplicate or invalid protocol metadata", async () => {
  const empty = await nativeHost([]);
  assert.deepEqual(await empty.client.list(), []);
  await empty.close();
  for (const adapters of [
    [testAdapter, testAdapter],
    [{ ...testAdapter, metadata: { ...testAdapter.metadata, protocolSupport: undefined } }]
  ]) {
    await assert.rejects(nativeHost(adapters), (error) => error.cleanup?.complete === true);
  }
});

test("native Kernel requires explicit endpoint and instances and rejects legacy process composition", () => {
  assert.throws(() => createKernelService({ home: fixtureHome, adapters: [] }), /endpoint/);
  assert.throws(() => createKernelService({ home: fixtureHome, endpoint: "/unused" }), /adapters/);
  for (const field of ["manifest", "adapterModules", "workerEntrypoint", "env"])
    assert.throws(
      () =>
        createKernelService({
          home: fixtureHome,
          endpoint: "/unused",
          adapters: [],
          [field]: "unused"
        }),
      /does not accept/
    );
});
