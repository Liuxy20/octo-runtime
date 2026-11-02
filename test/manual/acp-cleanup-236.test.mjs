import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { AgentExecutor } from "@mininglamp-oss/octo-runtime-executor-core";
import { createAcpAdapter } from "@mininglamp-oss/octo-runtime-adapter-acp";
import { spawnWorker, createKernelService } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { componentEndpoint } from "@mininglamp-oss/octo-runtime-host-sdk";
import { invocationInput } from "@mininglamp-oss/octo-runtime-protocol";
import { invokeRequest, preparedFrames } from "../runtime-fixture.js";

const definition = { type: "broken-acp", provider: "fixture", command: "unused" };
const spawnError = () =>
  Object.assign(new Error("spawn fixture ENOENT"), { code: "ENOENT", syscall: "spawn fixture" });
const collect = (core, id) =>
  Array.fromAsync(
    preparedFrames(
      core,
      "broken-acp",
      invokeRequest({ invocationId: id, approvalMode: "full_access" }),
      { protocolMode: "canonical" }
    )
  );

test("real ACP spawn ENOENT preserves the error and releases only confirmed Core ownership", async () => {
  const core = new AgentExecutor();
  core.register(createAcpAdapter({ ...definition, command: join(process.cwd(), randomUUID()) }));
  const frames = await collect(core, "missing-executable");
  const failures = frames.filter((frame) => frame.event?.type === "run.failed");
  assert.equal(failures.length, 1);
  assert.equal(failures[0].event.payload.code, "ENOENT");
  assert.match(failures[0].event.payload.message, /spawn .* ENOENT/);
  assert.equal(failures[0].event.payload.failure.code, "OH-ADP-3002");
  assert.equal(frames.at(-1).control.state, "failed");
  assert.deepEqual(await core.shutdown(), {
    state: "closed",
    cleanup: "complete",
    unresolvedInvocationIds: [],
    failedCleanupInvocationIds: []
  });
});

test("spawn failure terminal waits for actual ACP close", async () => {
  const gate = Promise.withResolvers();
  const entered = Promise.withResolvers();
  const error = spawnError();
  const adapter = createAcpAdapter(definition, {
    acpClientFactory: () => ({
      initialize: async () => {
        throw error;
      },
      close: async () => {
        entered.resolve();
        await gate.promise;
      }
    })
  });
  const iterator = adapter.invoke(invokeRequest({ approvalMode: "full_access" }));
  let published = false;
  const reading = iterator.next().then((result) => {
    published = true;
    return result;
  });
  try {
    await entered.promise;
    assert.equal(published, false);
  } finally {
    gate.resolve();
  }
  const result = await reading;
  assert.equal(result.value.type, "run.failed");
  assert.equal(result.value.payload.code, error.code);
  assert.equal(result.value.payload.message, error.message);
  assert.equal((await iterator.next()).done, true);
});

test("failed ACP close is not converted to a clean spawn failure", async () => {
  const cleanupError = Object.assign(new Error("fixture cleanup failed"), {
    code: "PROCESS_TREE_CLEANUP_INCOMPLETE"
  });
  const adapter = createAcpAdapter(definition, {
    acpClientFactory: () => ({
      initialize: async () => {
        throw spawnError();
      },
      close: async () => {
        throw cleanupError;
      }
    })
  });
  await assert.rejects(
    Array.fromAsync(adapter.invoke(invokeRequest({ approvalMode: "full_access" }))),
    (error) => error === cleanupError
  );
  const core = new AgentExecutor();
  core.register(adapter);
  const frames = await collect(core, "cleanup-rejected");
  assert.equal(frames.at(-1).control.state, "failed");
  const first = await core.shutdown();
  assert.equal(first.cleanup, "incomplete");
  assert.deepEqual(first.unresolvedInvocationIds, ["cleanup-rejected"]);
  assert.deepEqual(first.failedCleanupInvocationIds, ["cleanup-rejected"]);
  assert.deepEqual(await core.shutdown(), first);
});

test("non-spawn structured errors still reject with the original object", async () => {
  const error = Object.assign(new Error("fixture capacity exceeded"), {
    code: "STREAM_QUEUE_BYTES_EXCEEDED",
    measuredBytes: 101,
    limitBytes: 100
  });
  const adapter = createAcpAdapter(definition, {
    acpClientFactory: () => ({
      initialize: async () => {
        throw error;
      },
      close: async () => {}
    })
  });
  await assert.rejects(
    Array.fromAsync(adapter.invoke(invokeRequest({ approvalMode: "full_access" }))),
    (caught) => caught === error
  );
});

test("worker confirms complete drain and owned process/pipe cleanup after missing ACP", async (t) => {
  const worker = await spawnWorker({ entrypoint: resolve("test/fixtures/acp-failure-host.js") });
  t.after(() => worker.close());
  const messages = [];
  worker.child.on("message", (message) => messages.push(message));
  const pid = worker.child.pid;
  const frames = await collect(worker.client, "worker-missing");
  assert.equal(frames.filter((frame) => frame.event?.type === "run.failed").length, 1);
  await worker.close();
  if (process.platform === "win32")
    assert.ok(
      messages.some(
        (message) => message.type === "worker.drained" && message.cleanup === "complete"
      )
    );
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  assert.equal(worker.child.connected, false);
  assert.equal(worker.child.stdin.destroyed, true);
  assert.equal(worker.child.stdout.destroyed, true);
  assert.equal(worker.child.stderr.destroyed, true);
  t.diagnostic(JSON.stringify({ pid, messages, exited: true, pipesClosed: true }));
});

test("native Kernel closes manifest, endpoint and lease after failed ACP invocation", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "acp236-"));
  const endpoint = componentEndpoint(home);
  const service = createKernelService({
    endpoint,
    stateDirectory: home,
    workerEntrypoint: resolve("test/fixtures/acp-failure-host.js")
  });
  t.after(async () => {
    assert.equal((await service.close()).complete, true);
    await rm(home, { recursive: true, force: true });
  });
  await service.initialize();
  const pid = (await service.status()).kernel.worker.pid;
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  const events = await Array.fromAsync(
    service.client.invoke(
      invocationInput(
        invokeRequest({ invocationId: "kernel-missing", approvalMode: "full_access" }),
        "canonical",
        "broken-acp"
      )
    )
  );
  assert.equal(events.find((event) => event.type === "run.failed").payload.code, "ENOENT");
  const cleanup = await service.close();
  assert.deepEqual(cleanup, { complete: true, errors: [], pendingResources: [] });
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  await assert.rejects(access(join(home, "kernel-invocations.json")), { code: "ENOENT" });
  if (process.platform !== "win32") {
    await assert.rejects(access(endpoint), { code: "ENOENT" });
    await assert.rejects(access(`${endpoint}.owner`), { code: "ENOENT" });
  }
  const replacement = createKernelService({
    endpoint,
    stateDirectory: home,
    workerEntrypoint: resolve("test/fixtures/acp-failure-host.js")
  });
  t.after(() => replacement.close());
  await replacement.initialize();
  assert.equal((await replacement.close()).complete, true);
  t.diagnostic(JSON.stringify({ pid, exited: true, cleanup, replacementInitialized: true }));
});
