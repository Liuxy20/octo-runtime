import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  startOwnedKernel,
  startExtra,
  componentEndpoint
} from "@mininglamp-oss/octo-runtime-host-sdk";
import { attachKernel } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { kernelInput, frames } from "./kernel-fixture.js";
import { waitFor } from "./runtime-fixture.js";
import { kernelFixture } from "./kernel-fixture.js";

test("stopping an Extra cancels its own accepted Run while sibling and Kernel remain live", async (t) => {
  const { client, endpoint } = await kernelFixture(t);
  const sibling = await client.submit(kernelInput("wait-for-host-exit"));
  const input = kernelInput("wait-for-cancel");
  const extra = await startExtra({
    endpoint,
    declaration: {
      name: "invoking",
      module: resolve("test/fixtures/invoking-extra.mjs"),
      config: { input }
    }
  });
  t.after(() => extra.stop());
  const key = {
    run_id: input.runId,
    invocation_id: input.invocationId,
    agent_session_id: input.sessionId,
    session_generation: input.sessionGeneration ?? 0,
    protocol_mode: input.protocol_mode
  };
  await waitFor(async () =>
    client.get(key).then(
      () => true,
      () => false
    )
  );
  const own = await client.get(key);
  const cleanup = await extra.stop();
  assert.equal(cleanup.complete, true, JSON.stringify({ cleanup, own: await client.get(own.ref) }));
  assert.equal((await client.get(own.ref)).terminal.control.state, "cancelled");
  assert.equal((await client.get(sibling.ref)).terminal, undefined);
  assert.equal((await client.status()).execution_ready, true);
  await client.cancel(sibling.ref);
  await frames(client, sibling.ref);
});

test("owned Kernel restarts explicitly, attached clients only own connections", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "okh-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const endpoint = componentEndpoint(home);
  const kernel = await startOwnedKernel({
    endpoint,
    workerEntrypoint: resolve("test/fixtures/direct-adapter-host.js")
  });
  t.after(() => kernel.stop());
  const first = await kernel.client.status();
  const attached = attachKernel({ endpoint });
  attached.close();
  assert.equal((await kernel.client.status()).pid, first.pid);
  assert.equal("stop" in attached, false);
  const { ref } = await kernel.client.submit(kernelInput());
  await frames(kernel.client, ref);
  const next = await kernel.restart();
  assert.notEqual(next.kernel_instance_id, first.kernel_instance_id);
  await assert.rejects(kernel.client.get(ref, ref.kernel_instance_id), /KERNEL_INSTANCE_CHANGED/);
  assert.equal((await kernel.stop()).complete, true);
});
test("killed Kernel reports unconfirmed cleanup and explicit replacement creates a new instance", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "okr-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const options = {
    endpoint: componentEndpoint(home),
    workerEntrypoint: resolve("test/fixtures/direct-adapter-host.js"),
    stateDirectory: join(home, "run")
  };
  const first = await startOwnedKernel(options);
  t.after(() => first.stop());
  const old = await first.client.status();
  const { ref } = await first.client.submit(kernelInput("wait-for-host-exit"));
  process.kill(old.pid, "SIGKILL");
  await first.exited;
  assert.equal((await first.stop()).complete, false);
  const second = await startOwnedKernel(options);
  t.after(() => second.stop());
  assert.notEqual((await second.client.status()).kernel_instance_id, old.kernel_instance_id);
  await assert.rejects(second.client.get(ref, old.kernel_instance_id), /KERNEL_INSTANCE_CHANGED/);
  const accepted = await second.client.submit(kernelInput());
  assert.ok((await frames(second.client, accepted.ref)).length > 0);
  assert.equal((await second.stop()).complete, true);
});
test("independent Extra consumes current host functions without Kernel or inline execution", async (t) => {
  let text = "first";
  const extra = await startExtra({
    endpoint: "/unused-kernel.sock",
    declaration: {
      name: "independent",
      module: resolve("test/fixtures/independent-extra.mjs"),
      config: {}
    },
    dependencies: {
      loadContexts: () => [{ namespace: "extra.test", name: "current", payload: { text } }]
    }
  });
  t.after(() => extra.stop());
  const status = await extra.status();
  assert.notEqual(status.pid, process.pid);
  assert.equal(status.text, "first");
  text = "second";
  await waitFor(async () => (await extra.status()).text === "second");
  assert.equal((await extra.stop()).complete, true);
});
test("failed Extra disposal remains an explicit failure and blocks replacement", async () => {
  const options = {
    endpoint: "/unused-kernel.sock",
    declaration: {
      name: "independent",
      module: resolve("test/fixtures/independent-extra.mjs"),
      config: { failDispose: true }
    }
  };
  const extra = await startExtra(options);
  const result = await extra.stop();
  assert.equal(result.complete, false);
  assert.equal(result.processExited, true);
  await assert.rejects(startExtra(options), /EXTRA_DISPOSE_FAILED/);
});
