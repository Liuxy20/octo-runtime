import { withAgentEnvItems } from "../../packages/octo-runtime-adapter-sdk/dist/index.js";
import { invokeClient } from "../../test-support/invoke-client.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, rm, access, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AgentExecutor } from "@mininglamp-oss/octo-runtime-executor-core";
import { createAcpAdapter } from "@mininglamp-oss/octo-runtime-adapter-acp";
import { createKernelService } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { AcpClient } from "@mininglamp-oss/octo-runtime-acp-client";
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
      invokeRequest({
        invocationId: id,
        agentEnv: withAgentEnvItems(undefined, [
          { namespace: "octo.security", name: "approval_policy", payload: { mode: "full_access" } }
        ])
      }),
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
    failedCleanupInvocationIds: [],
    unresolvedServiceIds: [],
    failedCleanupServiceIds: []
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
  const iterator = adapter.invoke(
    invokeRequest({
      agentEnv: withAgentEnvItems(undefined, [
        { namespace: "octo.security", name: "approval_policy", payload: { mode: "full_access" } }
      ])
    })
  );
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
    Array.fromAsync(
      adapter.invoke(
        invokeRequest({
          agentEnv: withAgentEnvItems(undefined, [
            {
              namespace: "octo.security",
              name: "approval_policy",
              payload: { mode: "full_access" }
            }
          ])
        })
      )
    ),
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
    Array.fromAsync(
      adapter.invoke(
        invokeRequest({
          agentEnv: withAgentEnvItems(undefined, [
            {
              namespace: "octo.security",
              name: "approval_policy",
              payload: { mode: "full_access" }
            }
          ])
        })
      )
    ),
    (caught) => caught === error
  );
});
test("native ACP spawn failure closes its ChildProcess pipes without creating a provider PID", async (t) => {
  const core = new AgentExecutor();
  const closed = Promise.withResolvers();
  let child;
  core.register(
    createAcpAdapter(definition, {
      acpClientFactory: () => {
        child = spawn(join(process.cwd(), randomUUID()), [], {
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true
        });
        child.once("close", closed.resolve);
        return new AcpClient({ child });
      }
    })
  );
  const frames = await collect(core, "native-spawn-missing");
  await closed.promise;
  assert.equal(frames.filter((frame) => frame.event?.type === "run.failed").length, 1);
  assert.equal(
    frames.find((frame) => frame.event?.type === "run.failed").event.payload.code,
    "ENOENT"
  );
  assert.equal(child.pid, undefined);
  assert.equal(child.stdin.destroyed, true);
  assert.equal(child.stdout.destroyed, true);
  assert.equal(child.stderr.destroyed, true);
  assert.equal((await core.shutdown()).cleanup, "complete");
  t.diagnostic(
    JSON.stringify({ providerCreated: false, childCloseObserved: true, pipesClosed: true })
  );
});
test("native Kernel closes manifest, endpoint and lease after failed ACP invocation", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "acp236-"));
  const endpoint = componentEndpoint(home);
  const service = createKernelService({
    home: home,
    endpoint,
    stateDirectory: home,
    adapters: [createAcpAdapter({ ...definition, command: join(process.cwd(), randomUUID()) })]
  });
  t.after(async () => {
    assert.equal((await service.close()).complete, true);
    await rm(home, { recursive: true, force: true });
  });
  await service.initialize();
  assert.equal((await service.status()).pid, process.pid);
  const ownership = JSON.parse(await readFile(join(home, "kernel-invocations.json"), "utf8"));
  assert.equal(ownership.nativeOwner, true);
  assert.equal(ownership.worker, undefined);
  const events = await Array.fromAsync(
    invokeClient(
      service.client,
      invocationInput(
        invokeRequest({
          invocationId: "kernel-missing",
          agentEnv: withAgentEnvItems(undefined, [
            {
              namespace: "octo.security",
              name: "approval_policy",
              payload: { mode: "full_access" }
            }
          ])
        }),
        "canonical",
        "broken-acp"
      )
    )
  );
  assert.equal(events.find((event) => event.type === "run.failed").payload.code, "ENOENT");
  const cleanup = await service.close();
  assert.deepEqual(cleanup, { complete: true, errors: [], pendingResources: [] });
  assert.equal(process.kill(process.pid, 0), true);
  await assert.rejects(access(join(home, "kernel-invocations.json")), { code: "ENOENT" });
  if (process.platform !== "win32") {
    await assert.rejects(access(endpoint), { code: "ENOENT" });
    await assert.rejects(access(`${endpoint}.owner`), { code: "ENOENT" });
  }
  const replacement = createKernelService({
    home: home,
    endpoint,
    stateDirectory: home,
    adapters: [createAcpAdapter({ ...definition, command: join(process.cwd(), randomUUID()) })]
  });
  t.after(() => replacement.close());
  await replacement.initialize();
  assert.equal((await replacement.close()).complete, true);
  t.diagnostic(
    JSON.stringify({ hostPid: process.pid, hostAlive: true, cleanup, replacementInitialized: true })
  );
});
