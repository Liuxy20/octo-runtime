// Explicit local validation only: node --test test/manual/339-engine-lifecycle.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { createCodexAdapter, createManagedCodexEngine } from "../../dist/public/codex.js";
import { AgentExecutor } from "../../dist/public/executor-core.js";
import { createKernelService, componentEndpoint } from "../../dist/public/host.js";
import { loadCliAdapters } from "../../apps/cli/dist/adapters.js";
import { createCliKernelService } from "../../apps/cli/dist/kernel.js";
import { residentProcesses, formatResidentProcesses } from "../../apps/cli/dist/output.js";
import { invokeRequest, preparedFrames } from "../runtime-fixture.js";

const fixture = fileURLToPath(new URL("./fixtures/codex-service-313.mjs", import.meta.url));
const request = (text = "hello", extra = {}) =>
  invokeRequest({
    invocationId: randomUUID(),
    runId: randomUUID(),
    workdir: process.cwd(),
    modelInput: text,
    approvalMode: "full_access",
    ...extra
  });
async function setup(t) {
  const home = await mkdtemp(join(tmpdir(), "octo339-"));
  const marker = join(home, "auth-marker");
  await writeFile(marker, "host-owned-data", { mode: 0o600 });
  const before = await stat(marker);
  const owner = createManagedCodexEngine({
    codexHome: home,
    command: process.execPath,
    appServerArgs: [fixture, join(home, "rpc.ndjson")],
    env: {}
  });
  const adapter = createCodexAdapter({ engine: owner.provider });
  t.after(async () => {
    assert.equal((await owner.close({ deadline: performance.now() + 2500 })).complete, true);
    assert.equal(await readFile(marker, "utf8"), "host-owned-data");
    assert.equal((await stat(marker)).mode, before.mode);
    await rm(home, { recursive: true, force: true });
  });
  return { owner, adapter, home };
}
function scope(adapter) {
  return adapter.createExecutionScope({ log: () => {} });
}
const closeScope = (value) => value.close({ deadline: performance.now() + 2500 });

test("explicit SDK Home, removed singleton and conflicting per-call Home", async (t) => {
  const exports = await import("../../dist/public/codex.js");
  assert.equal(exports.codexAdapter, undefined);
  assert.equal(exports.default, undefined);
  assert.throws(() => createManagedCodexEngine({}), /CODEX_HOME_REQUIRED/);
  assert.throws(() => createManagedCodexEngine({ codexHome: "relative" }), /CODEX_HOME_REQUIRED/);
  const { owner, adapter, home } = await setup(t);
  const local = scope(adapter);
  const conflict = request("hello", {
    context: {
      schema: "octo.context-envelope/v3",
      items: [
        {
          namespace: "octo.execution",
          name: "envs",
          payload: { env_variables: [{ key: "CODEX_HOME", value: home + "-other" }] }
        }
      ]
    }
  });
  await assert.rejects(Array.fromAsync(local.invoke(conflict)), /CODEX_HOME_CONFLICT/);
  assert.deepEqual(owner.processes(), []);
  assert.equal((await closeScope(local)).complete, true);
});

test("two Cores share one host owner; shutdown A leaves B and engine usable", async (t) => {
  const { owner, adapter } = await setup(t);
  const a = new AgentExecutor(),
    b = new AgentExecutor();
  a.register(adapter);
  b.register(adapter);
  t.after(async () => {
    await a.shutdown();
    await b.shutdown();
  });
  const invoke = (core) =>
    Array.fromAsync(preparedFrames(core, "codex", request(), { protocolMode: "canonical" }));
  await Promise.all([invoke(a), invoke(b)]);
  assert.equal(owner.processes().length, 1);
  const pid = owner.processes()[0].pid;
  assert.deepEqual(a.processes(), []);
  assert.equal((await a.shutdown()).cleanup, "complete");
  assert.equal((await invoke(b)).at(-1).control.state, "completed");
  assert.equal(owner.processes()[0].pid, pid);
});

test("shared provider routes concurrent approvals to their original Runtime scope", async (t) => {
  const { owner, adapter } = await setup(t);
  const a = scope(adapter),
    b = scope(adapter);
  await Promise.all(
    [a, b].map(async (local, index) => {
      const req = request(`approval-${index}`, { approvalMode: "ask" });
      const events = await Array.fromAsync(local.invoke(req), async (event) => {
        if (event.type === "interaction.requested") {
          const response = { interactionId: event.payload.interactionId, outcome: "accepted" };
          await assert.rejects(
            (index ? a : b).respondInteraction(req.invocationId, response),
            /INTERACTION_NOT_ACTIVE/
          );
          await local.respondInteraction(req.invocationId, response);
        }
        return event;
      });
      assert.equal(events.at(-1).type, "run.completed");
    })
  );
  assert.equal(owner.processes().length, 1);
  await closeScope(a);
  await closeScope(b);
});

test("late acquire after cancellation or scope shutdown is released exactly once", async () => {
  for (const mode of ["abort", "shutdown"]) {
    let deliver,
      releases = 0;
    const engine = {
      codexHome: process.cwd(),
      acquire: () =>
        new Promise((resolve) => {
          deliver = resolve;
        })
    };
    const local = scope(createCodexAdapter({ engine }));
    const controller = new AbortController();
    const done = Array.fromAsync(local.invoke(request("hello", { signal: controller.signal })));
    if (mode === "abort") controller.abort(new Error("CANCELLED"));
    else local.beginShutdown("test");
    deliver({
      channel: {
        close: async () => {
          releases++;
        }
      },
      configuration: {}
    });
    await assert.rejects(done, mode === "abort" ? /CANCELLED/ : /CODEX_ADAPTER_CLOSED/);
    assert.equal(releases, 1);
    assert.equal((await closeScope(local)).complete, true);
  }
});

test("borrowed lease release failure is incomplete without closing shared engine", async (t) => {
  const { owner } = await setup(t);
  const engine = {
    codexHome: owner.provider.codexHome,
    async acquire(...args) {
      const lease = await owner.provider.acquire(...args);
      const channel = lease.channel;
      const release = channel.close.bind(channel);
      channel.close = async () => {
        await release();
        throw new Error("LEASE_RELEASE_FAILED");
      };
      return lease;
    }
  };
  const local = scope(createCodexAdapter({ engine }));
  await assert.rejects(Array.fromAsync(local.invoke(request())), /LEASE_RELEASE_FAILED/);
  const result = await closeScope(local);
  assert.equal(result.complete, false);
  assert.equal(result.failedCleanupServiceIds.length, 1);
  assert.equal(owner.processes()[0].state, "ready");
});

test("host-owned diagnostics place app-server under host PID, independent of adapter scopes", async (t) => {
  const { owner, adapter, home } = await setup(t);
  const kernel = createKernelService({
    home,
    endpoint: componentEndpoint(home),
    adapters: [adapter],
    serviceProcesses: () => owner.processes()
  });
  t.after(() => kernel.close());
  await kernel.initialize();
  assert.deepEqual((await kernel.client.status()).service_processes, []);
  const local = scope(adapter);
  await Array.fromAsync(local.invoke(request()));
  const status = await kernel.client.status();
  assert.equal(status.service_processes[0].owner_pid, process.pid);
  const processes = residentProcesses({
    "executor-kernel": { service: { state: "running" }, runtime: status }
  });
  assert.equal(processes.length, 2);
  const tree = formatResidentProcesses(processes);
  assert.match(tree, /Host\/Kernel.*PID/);
  assert.match(tree, /\+-- codex app-server.*owned/);
  assert.doesNotMatch(tree, /adapter/i);
  await kernel.close();
  assert.equal(owner.processes()[0].state, "ready");
  await closeScope(local);
});

test("CLI assembly failure attempts every owned disposer and retains the original failure", async (t) => {
  const { home } = await setup(t);
  const module = join(home, "factory.mjs");
  await writeFile(
    module,
    `export const calls=[];
const adapter={metadata:{type:"fixture",agentSources:["provisioned"],protocolSupport:{protocol:"fixture",modes:["canonical"],nativeMethods:[]}},async *invoke(){}};
export function first(){return {adapter,async close(){calls.push("first");throw Error("CLEANUP_FAILED");}};}
export function second(){return {adapter,async close(){calls.push("second");return {complete:true,unresolvedServiceIds:[],failedCleanupServiceIds:[]};}};}
export function broken(){throw Error("CONSTRUCTION_FAILED");}
`
  );
  const entries = ["first", "second", "broken"].map((name) => ({
    module,
    export: name,
    factory: true,
    options: {},
    sourceManifest: join(home, "manifest.json")
  }));
  await assert.rejects(loadCliAdapters(entries), (error) => {
    assert.match(String(error.cause), /CONSTRUCTION_FAILED/);
    assert.equal(error.cleanup.complete, false);
    assert.deepEqual(error.cleanup.pendingResources, ["cli-adapter-0"]);
    assert.deepEqual(error.diagnostic.cleanup.pendingResources, ["cli-adapter-0"]);
    assert.ok(error.cleanup.errors.some((entry) => entry.resource === "cli-adapter-0"));
    return true;
  });
  assert.deepEqual((await import(pathToFileURL(module).href)).calls, ["second", "first"]);
});

test("CLI invalid Adapter still rolls back its resource envelope", async (t) => {
  const { home } = await setup(t);
  const module = join(home, "invalid.mjs");
  await writeFile(
    module,
    `export let closed=0; export function factory(){return {adapter:{},async close(){closed++;return {complete:true,unresolvedServiceIds:[],failedCleanupServiceIds:[]};}}}`
  );
  await assert.rejects(
    loadCliAdapters([
      { module, export: "factory", factory: true, options: {}, sourceManifest: module }
    ]),
    /not an Octo Runtime adapter/
  );
  assert.equal((await import(pathToFileURL(module).href)).closed, 1);
});

test("CLI rollback releases dependent sessions before their transport", async (t) => {
  const { home } = await setup(t);
  const module = join(home, "dependent.mjs");
  await writeFile(
    module,
    `export const calls=[];let alive=true;
const adapter={metadata:{type:"fixture",agentSources:["provisioned"]},async *invoke(){}};
const complete={complete:true,unresolvedServiceIds:[],failedCleanupServiceIds:[]};
export function transport(){return {adapter,async close(){calls.push("transport");alive=false;return complete;}};}
export function session(){return {adapter,async close(){calls.push("session");if(!alive)throw Error("TRANSPORT_CLOSED_BEFORE_UNSUBSCRIBE");return complete;}};}
export function broken(){throw Error("CONSTRUCTION_FAILED");}`
  );
  const entries = ["transport", "session", "broken"].map((name) => ({
    module,
    export: name,
    factory: true,
    options: {},
    sourceManifest: module
  }));
  await assert.rejects(loadCliAdapters(entries), /CONSTRUCTION_FAILED/);
  assert.deepEqual((await import(pathToFileURL(module).href)).calls, ["session", "transport"]);
});

test("CLI Kernel construction failure preserves owner cleanup details", async () => {
  const assembly = {
    adapters: [],
    processes: () => [],
    beginShutdown() {},
    async close() {
      return {
        complete: false,
        unresolvedServiceIds: ["engine-pending"],
        failedCleanupServiceIds: ["engine-failed"]
      };
    }
  };
  await assert.rejects(
    createCliKernelService({ home: process.cwd(), endpoint: "" }, assembly),
    (error) => {
      assert.match(String(error.cause), /Kernel requires/);
      assert.deepEqual(error.cleanup.pendingResources, ["engine-pending", "engine-failed"]);
      assert.deepEqual(error.diagnostic.cleanup.pendingResources, [
        "engine-pending",
        "engine-failed"
      ]);
      assert.ok(error.cleanup.errors.some((entry) => entry.resource === "engine-failed"));
      return true;
    }
  );
});

test(
  "CLI malformed cleanup result cannot hang initialization rollback",
  { timeout: 5000 },
  async (t) => {
    const { home } = await setup(t);
    const module = join(home, "malformed-cleanup.mjs");
    await writeFile(
      module,
      `export function factory(){return {adapter:{metadata:{type:"fixture",agentSources:["provisioned"]},async *invoke(){}},async close(){return {complete:true};}}}`
    );
    const assembly = await loadCliAdapters([
      { module, export: "factory", factory: true, options: {}, sourceManifest: module }
    ]);
    const service = await createCliKernelService(
      { home, endpoint: join(home, "malformed.sock"), logging: { directory: "relative-invalid" } },
      assembly
    );
    await assert.rejects(service.initialize(), (error) => {
      assert.equal(error.cleanup.complete, false);
      assert.ok(error.cleanup.pendingResources.includes("cli-adapter-0"));
      return true;
    });
    assert.equal((await service.closed).complete, false);
  }
);

test("CLI cleanup is bounded, idempotent and still attempts independent resources", async (t) => {
  const { home } = await setup(t);
  const module = join(home, "slow.mjs");
  await writeFile(
    module,
    `export let calls=0;export function factory(){return {adapter:{metadata:{type:"fixture",agentSources:["provisioned"]},async *invoke(){}},close(){calls++;return new Promise(()=>{});}}}`
  );
  const assembly = await loadCliAdapters([
    { module, export: "factory", factory: true, options: {}, sourceManifest: module }
  ]);
  const start = performance.now();
  assert.equal((await assembly.close(start + 20)).complete, false);
  assert.ok(performance.now() - start < 1000);
  assert.equal((await assembly.close(performance.now() + 10)).complete, false);
  assert.equal((await import(pathToFileURL(module).href)).calls, 1);
});

test("CLI Kernel initialization failure closes its owned engine and preserves Home", async (t) => {
  const { owner, adapter, home } = await setup(t);
  const local = scope(adapter);
  await Array.fromAsync(local.invoke(request()));
  const assembly = {
    adapters: [adapter],
    processes: () => owner.processes(),
    beginShutdown: () => owner.beginShutdown(),
    close: (deadline) => owner.close({ deadline })
  };
  const kernel = await createCliKernelService(
    { home: join(home, "missing"), endpoint: componentEndpoint(home) },
    assembly
  );
  await assert.rejects(kernel.initialize());
  assert.equal(owner.processes()[0].state, "closed");
  assert.equal((await kernel.closed).complete, true);
  await closeScope(local);
});

test("host cleanup failure retains Kernel ownership evidence", async (t) => {
  const { home } = await setup(t);
  let closes = 0;
  const assembly = {
    adapters: [],
    processes: () => [],
    beginShutdown() {},
    async close() {
      closes++;
      return {
        complete: false,
        unresolvedServiceIds: ["business-engine"],
        failedCleanupServiceIds: ["business-engine"]
      };
    }
  };
  const endpoint = componentEndpoint(home);
  const kernel = await createCliKernelService({ home, endpoint, stateDirectory: home }, assembly);
  await kernel.initialize();
  const cleanup = await kernel.close();
  assert.equal(cleanup.complete, false);
  assert.ok(cleanup.pendingResources.includes("business-engine"));
  const record = JSON.parse(await readFile(join(home, "kernel-invocations.json"), "utf8"));
  assert.equal(record.cleanupIncomplete, true);
  assert.equal(record.cleanupFailed, true);
  assert.ok(closes >= 1);
});

test("arbitrary black-box constructors and closure adapters preserve business ownership", async () => {
  const calls = [];
  const client = {
    close() {
      assert.fail("business client must not be closed");
    },
    async *run(req, tenant, transform) {
      calls.push([tenant, transform(req.modelInput)]);
      yield { protocolVersion: 2, type: "run.completed", payload: {} };
    }
  };
  const metadata = {
    type: "blackbox",
    agentSources: ["provisioned"],
    protocolSupport: { protocol: "business", modes: ["canonical"], nativeMethods: [] }
  };
  class BusinessAdapter {
    metadata = metadata;
    constructor(client, tenant, transform, other) {
      Object.assign(this, { client, tenant, transform, other });
    }
    invoke(req) {
      return this.client.run(req, this.tenant, this.transform);
    }
  }
  const a = new AgentExecutor(),
    b = new AgentExecutor();
  a.register(new BusinessAdapter(client, "a", (text) => text.toUpperCase(), { audit: true }));
  b.register({ metadata, invoke: (req) => client.run(req, "b", (text) => text) });
  try {
    const run = (core) =>
      Array.fromAsync(preparedFrames(core, "blackbox", request(), { protocolMode: "canonical" }));
    assert.equal((await run(a)).at(-1).control.state, "completed");
    await a.shutdown();
    assert.equal((await run(b)).at(-1).control.state, "completed");
    assert.deepEqual(calls, [
      ["a", "HELLO"],
      ["b", "hello"]
    ]);
  } finally {
    await a.shutdown();
    await b.shutdown();
  }
});
