import { invokeClient } from "../../test-support/invoke-client.js";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { createCodexAdapter } from "../../packages/octo-runtime-adapter-codex/dist/index.js";
import { CodexService } from "../../packages/octo-runtime-adapter-codex/dist/service.js";
import { AgentExecutor } from "../../packages/octo-runtime-executor-core/dist/index.js";
import { invokeRequest, preparedFrames } from "../runtime-fixture.js";
import { residentProcesses, formatResidentProcesses } from "../../apps/cli/dist/output.js";
import { runCli } from "../../apps/cli/dist/main.js";
import { createKernelService } from "../../packages/octo-runtime-executor-kernel/dist/index.js";
import { componentEndpoint } from "../../packages/octo-runtime-host-sdk/dist/index.js";
import {
  assertServiceProcessSnapshot,
  resolveStreamLimitPolicy
} from "../../packages/octo-runtime-protocol/dist/index.js";

const fixture = fileURLToPath(new URL("./fixtures/codex-service-313.mjs", import.meta.url));
const logSink = () => {};
const request = (modelInput = "hello", extra = {}) =>
  invokeRequest({
    invocationId: randomUUID(),
    runId: randomUUID(),
    modelInput,
    workdir: process.cwd(),
    approvalMode: "full_access",
    ...extra
  });
test("Core cannot report complete when a scope reports incomplete without resource IDs", async () => {
  const core = new AgentExecutor();
  const adapter = createCodexAdapter();
  core.register({
    ...adapter,
    createExecutionScope: () => ({
      invoke: async function* () {},
      beginShutdown() {},
      close: async () => ({
        complete: false,
        unresolvedServiceIds: [],
        failedCleanupServiceIds: []
      })
    })
  });
  const result = await core.shutdown();
  assert.equal(result.cleanup, "incomplete");
  assert.deepEqual(result.unresolvedServiceIds, ["codex"]);
});
test("scope close observes late cleanup without starting another cleanup attempt", async (t) => {
  const { scope } = await setup(t);
  await Array.fromAsync(scope.invoke(request()));
  await scope.close({ deadline: performance.now() });
  const result = await scope.close({ deadline: performance.now() + 2500 });
  assert.equal(result.complete, true);
  assert.equal(scope.processes()[0].state, "closed");
});
test("CLI doctor reads resident PIDs without starting a Provider and shares its text/JSON source", async () => {
  const home = await mkdtemp(join(tmpdir(), "octo-313-doctor-"));
  const kernel = createKernelService({
    home,
    endpoint: componentEndpoint(home),
    adapters: [
      createCodexAdapter({
        command: process.execPath,
        appServerArgs: [fixture, join(home, "rpc.ndjson")]
      })
    ]
  });
  const doctor = async (json) => {
    let output = "";
    const exit = await runCli(["doctor", "--home", home, ...(json ? ["--json"] : [])], {
      output: (line) => {
        output += line;
      }
    });
    assert.equal(exit, 0);
    return json ? JSON.parse(output) : output;
  };
  try {
    await kernel.initialize();
    const before = await doctor(true);
    assert.equal(
      before.processes.some((p) => p.roles.includes("codex app-server")),
      false
    );
    assert.deepEqual((await kernel.client.status()).service_processes, []);
    await Array.fromAsync(
      invokeClient(kernel.client, {
        inputs: [{ type: "text", text: "hello" }],
        protocol_mode: "canonical",

        agentEnv: {
          ...{
            schema: "octo.context-envelope/v3",
            items: [{ namespace: "octo.execution", name: "adapter", payload: { type: "codex" } }]
          },
          workdir: home
        }
      })
    );
    const after = await doctor(true);
    const provider = after.processes.find((p) => p.roles.includes("codex app-server"));
    assert.equal(provider.pid, (await kernel.client.status()).service_processes[0].pid);
    assert.equal(provider.owner_pid, process.pid);
    const rendered = await doctor(false);
    assert.ok(rendered.includes(`PID ${provider.pid}`));
    assert.ok(rendered.includes("Resident processes (ownership):"));
    assert.equal(
      after.processes.some((p) =>
        Object.keys(p).some((key) => /turn|thread|invocation|argv|env/.test(key))
      ),
      false
    );
    assert.equal((await kernel.client.status()).service_processes[0].pid, provider.pid);
  } finally {
    assert.equal((await kernel.close()).complete, true);
    await rm(home, { recursive: true, force: true });
  }
});
async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), "octo-313-"));
  const log = join(dir, "rpc.ndjson");
  const adapter = createCodexAdapter({ command: process.execPath, appServerArgs: [fixture, log] });
  const scope = adapter.createExecutionScope({ log: logSink });
  t.after(async () => {
    const cleanup = await scope.close({ deadline: performance.now() + 2500 });
    assert.equal(cleanup.complete, true);
    await rm(dir, { recursive: true, force: true });
  });
  return { scope, adapter, log };
}
async function eventually(predicate) {
  const deadline = performance.now() + 6000;
  while (!predicate()) {
    if (performance.now() > deadline) throw new Error("condition timeout");
    await delay(10);
  }
}
for (const command of ["./codex", "bin/codex"])
  for (const cwdMode of ["absolute", "relative"])
    test(
      `replacing ${command} selects a new service with ${cwdMode} cwd`,
      { skip: process.platform === "win32" && "POSIX executable fixture" },
      async (t) => {
        const temporaryRoot = join(process.cwd(), ".tmp");
        await mkdir(temporaryRoot, { recursive: true });
        const directory = await mkdtemp(join(temporaryRoot, "codex-identity-"));
        const binary = join(directory, command);
        const replacement = binary + ".next";
        const program = "#!/usr/bin/env node\n" + (await readFile(fixture, "utf8"));
        const scope = createCodexAdapter({ command, appServerArgs: [] }).createExecutionScope({
          log: logSink
        });
        t.after(async () => {
          assert.equal((await scope.close({ deadline: performance.now() + 2500 })).complete, true);
          await rm(directory, { recursive: true, force: true });
        });
        await mkdir(join(directory, "bin"), { recursive: true });
        await writeFile(binary, program, { mode: 0o700 });
        const workdir = cwdMode === "absolute" ? directory : relative(process.cwd(), directory);
        const invoke = () => Array.fromAsync(scope.invoke(request("hello", { workdir })));
        assert.equal((await invoke()).at(-1).type, "run.completed");
        const original = scope.processes()[0];
        assert.equal((await invoke()).at(-1).type, "run.completed");
        assert.equal(scope.processes().length, 1);
        assert.equal(scope.processes()[0].pid, original.pid);
        await writeFile(replacement, program + "\n// replacement executable\n", { mode: 0o700 });
        await rename(replacement, binary);
        assert.equal((await invoke()).at(-1).type, "run.completed");
        const processes = scope.processes();
        assert.equal(processes.length, 2);
        const next = processes.find((entry) => entry.service_id !== original.service_id);
        assert.equal(next.state, "ready");
        assert.notEqual(next.pid, original.pid);
        assert.equal(
          processes.find((entry) => entry.service_id === original.service_id).state,
          "ready"
        );
      }
    );
test("stdout enforces the effective budget before parsing an unterminated line", async (t) => {
  const { scope } = await setup(t);
  const events = await Array.fromAsync(
    scope.invoke(request("partial-line", { signal: AbortSignal.timeout(1500) }), {
      protocolMode: "canonical",
      streamLimits: resolveStreamLimitPolicy({ rawMessageMaxBytes: 256 * 1024 })
    })
  );
  assert.equal(events.at(-1).type, "run.failed");
  assert.equal(events.at(-1).payload.code, "PROVIDER_MESSAGE_TOO_LARGE");
});
test("service snapshot validator rejects non-string enum values", () => {
  const valid = {
    scope_id: "scope",
    service_id: "service",
    incarnation: 1,
    provider: "codex",
    owner_pid: process.pid,
    state: "ready",
    observation: "alive",
    ownership: "owned"
  };
  assert.doesNotThrow(() => assertServiceProcessSnapshot(valid));
  for (const field of ["state", "observation"]) {
    for (const value of [[valid[field]], { toString: () => valid[field] }, null, true]) {
      assert.throws(
        () => assertServiceProcessSnapshot({ ...valid, [field]: value }),
        /INVALID_KERNEL_STATUS/
      );
    }
  }
});
test("doctor keeps an exited cleanup resource separate from a reused live PID", () => {
  const processes = residentProcesses({
    "executor-kernel": {
      service: { state: "running", pid: 10 },
      runtime: {
        pid: 10,
        service_processes: [
          {
            scope_id: "scope",
            service_id: "old",
            incarnation: 1,
            provider: "codex",
            owner_pid: 10,
            pid: 100,
            state: "cleanup_incomplete",
            observation: "exited",
            ownership: "owned"
          }
        ]
      }
    },
    webui: { service: { state: "running", pid: 100 }, runtime: { pid: 100 } }
  });
  assert.equal(processes.length, 3);
  assert.equal(processes.find((p) => p.service_id === "old").observation, "exited");
  assert.equal(processes.find((p) => p.roles.includes("Extra:webui")).observation, "alive");
});
test("thread history capacity rejects before writing and preserves the healthy service", async () => {
  const service = new CodexService("history-capacity", {
    command: process.execPath,
    args: [fixture],
    cwd: process.cwd(),
    env: process.env
  });
  const start = async () => {
    const channel = await service.acquire();
    try {
      await new Promise((resolve, reject) => {
        channel.onFailure = reject;
        channel.onMessage = resolve;
        channel.write(
          { id: channel.reserveRequestId(), method: "thread/start", params: {} },
          reject
        );
      });
      return channel;
    } catch (error) {
      await channel.close();
      throw error;
    }
  };
  try {
    const sibling = await start();
    const before = service.snapshot();
    for (let i = 1; i < 4096; i++) await (await start()).close();
    await assert.rejects(start(), /CODEX_SERVICE_THREAD_HISTORY_EXCEEDED/);
    assert.equal(service.snapshot().state, "ready");
    assert.equal(service.snapshot().pid, before.pid);
    assert.equal(service.snapshot().incarnation, before.incarnation);
    assert.equal(sibling.closed, false);
    await sibling.close();
  } finally {
    await service.close();
  }
});
test("service reuses PID/initialize across turns and same-thread resume", async (t) => {
  const { scope, log } = await setup(t);
  assert.deepEqual(scope.processes(), []);
  const first = await Array.fromAsync(scope.invoke(request()));
  const before = scope.processes()[0];
  const providerSession = first.find((e) => e.type === "session.update").payload.providerSession;
  const second = await Array.fromAsync(scope.invoke(request("followup", { providerSession })));
  assert.equal(first.at(-1).type, "run.completed");
  assert.equal(second.at(-1).type, "run.completed");
  assert.equal(scope.processes()[0].pid, before.pid);
  const writes = (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(writes.filter((e) => e.method === "initialize").length, 1);
  assert.equal(writes.filter((e) => e.method === "thread/unsubscribe").length, 2);
});
test("concurrent threads keep messages separate, including events before ACK", async (t) => {
  const { scope } = await setup(t);
  const results = await Promise.all(
    ["alpha", "beta"].map((value) => Array.fromAsync(scope.invoke(request(value))))
  );
  for (const [index, events] of results.entries()) {
    assert.equal(events.at(-1).type, "run.completed");
    const texts = events
      .filter((e) => e.type === "message.update")
      .map((e) => e.payload.text)
      .filter(Boolean);
    assert.deepEqual(texts, [index ? "beta" : "alpha"]);
  }
  assert.equal(scope.processes().length, 1);
});
test("cancel does not kill shared service or another active turn", async (t) => {
  const { scope } = await setup(t);
  const controller = new AbortController();
  const cancelled = Array.fromAsync(
    scope.invoke(request("hang", { signal: controller.signal })),
    (event) => {
      if (event.type === "session.update") controller.abort("test");
      return event;
    }
  );
  const normal = Array.fromAsync(scope.invoke(request("survivor")));
  const [a, b] = await Promise.all([cancelled, normal]);
  assert.equal(a.at(-1).type, "run.cancelled");
  assert.equal(b.at(-1).type, "run.completed");
  assert.equal(scope.processes()[0].state, "ready");
});
test("idle death proactively restores a new PID without invoke", async (t) => {
  const { scope } = await setup(t);
  await Array.fromAsync(scope.invoke(request()));
  const before = scope.processes()[0];
  process.kill(before.pid, "SIGKILL");
  await eventually(
    () =>
      scope.processes()[0].state === "ready" &&
      scope.processes()[0].incarnation > before.incarnation
  );
  assert.notEqual(scope.processes()[0].pid, before.pid);
});
test("config revisions isolate processes; normal turns share", async (t) => {
  const { scope } = await setup(t);
  for (const revision of ["a", "b", "a"]) {
    await Array.fromAsync(
      scope.invoke(
        request("hello", { agentConfig: { providerOptions: { codexServiceRevision: revision } } })
      )
    );
  }
  assert.equal(scope.processes().length, 2);
  assert.notEqual(scope.processes()[0].pid, scope.processes()[1].pid);
});
test("two Core registrations of same descriptor own distinct processes", async (t) => {
  const { adapter } = await setup(t);
  const a = new AgentExecutor(),
    b = new AgentExecutor();
  a.register(adapter);
  b.register(adapter);
  t.after(async () => {
    assert.equal((await a.shutdown()).cleanup, "complete");
    assert.equal((await b.shutdown()).cleanup, "complete");
  });
  await Array.fromAsync(preparedFrames(a, "codex", request(), { protocolMode: "canonical" }));
  await Array.fromAsync(preparedFrames(b, "codex", request(), { protocolMode: "canonical" }));
  assert.notEqual(a.processes()[0].pid, b.processes()[0].pid);
  await a.shutdown();
  assert.equal(b.processes()[0].state, "ready");
});
for (const protocolMode of ["canonical", "native"])
  test(`final-answer fallback succeeds through Core: ${protocolMode}`, async (t) => {
    const { adapter } = await setup(t);
    const core = new AgentExecutor();
    core.register(adapter);
    t.after(async () => assert.equal((await core.shutdown()).cleanup, "complete"));
    const events = await Array.fromAsync(
      preparedFrames(
        core,
        "codex",
        request("stall", {
          agentConfig: { providerOptions: { finalizationTimeoutMs: 40 } }
        }),
        { protocolMode }
      )
    );
    const terminal = events.at(-1);
    assert.equal(terminal.control.state, "completed");
    if (protocolMode === "canonical")
      assert.ok(events.some((e) => e.kind === "canonical" && e.event.type === "run.completed"));
  });
test("doctor lists resident ownership and merges same PID without turn fields", () => {
  const view = residentProcesses({
    "executor-kernel": {
      service: { state: "running" },
      runtime: {
        pid: 123,
        service_processes: [
          {
            provider: "codex",
            owner_pid: 123,
            pid: 456,
            state: "ready",
            observation: "alive",
            service_id: "service",
            incarnation: 2
          }
        ]
      }
    },
    webui: { service: { state: "running" }, runtime: { pid: 123 } }
  });
  assert.equal(view.length, 2);
  assert.deepEqual(view[0].roles, ["Host/Kernel", "Extra:webui"]);
  assert.match(formatResidentProcesses(view), /PID 456.*incarnation 2/);
  assert.doesNotMatch(JSON.stringify(view), /turn|thread|invocation|argv|env/);
});
test("unbound invocation rejects without spawning", async () => {
  let launches = 0;
  const adapter = createCodexAdapter({
    spawnFn: () => {
      launches++;
      throw new Error("unexpected spawn");
    }
  });
  await assert.rejects(Array.fromAsync(adapter.invoke(request())), /CODEX_SERVICE_SCOPE_REQUIRED/);
  assert.equal(launches, 0);
});

test("active same-thread resume is rejected before delivery", async (t) => {
  const { scope, log } = await setup(t);
  const controller = new AbortController();
  let conflict;
  await Array.fromAsync(
    scope.invoke(request("hang", { signal: controller.signal })),
    async (event) => {
      if (event.type === "session.update") {
        conflict = await Array.fromAsync(
          scope.invoke(
            request("other", {
              providerSession: { ...event.payload.providerSession, requireResume: true }
            })
          )
        );
        controller.abort("done");
      }
      return event;
    }
  );
  assert.match(conflict.at(-1).payload.message, /CODEX_THREAD_BUSY/);
  const writes = (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(writes.filter((e) => e.method === "thread/resume").length, 0);
});
test("canonical concurrent approvals reject wrong owner and duplicate responses", async (t) => {
  const { scope } = await setup(t);
  await Promise.all(
    ["approval-alpha", "approval-beta"].map(async (label) => {
      const req = request(label, { approvalMode: "ask" });
      const events = await Array.fromAsync(scope.invoke(req), async (event) => {
        if (event.type === "interaction.requested") {
          const response = { interactionId: event.payload.interactionId, outcome: "accepted" };
          await assert.rejects(
            scope.respondInteraction("other-owner", response),
            /INTERACTION_NOT_ACTIVE/
          );
          await scope.respondInteraction(req.invocationId, response);
          await assert.rejects(scope.respondInteraction(req.invocationId, response));
        }
        return event;
      });
      assert.equal(events.at(-1).type, "run.completed");
    })
  );
});
test("nullable elicitation routes to its sole confirmed active thread", async (t) => {
  const { scope } = await setup(t);
  const req = request("elicitation", { approvalMode: "ask" });
  let count = 0;
  const events = await Array.fromAsync(scope.invoke(req), async (event) => {
    if (event.type === "interaction.requested") {
      count++;
      await scope.respondInteraction(req.invocationId, {
        interactionId: event.payload.interactionId,
        outcome: "accepted",
        value: {}
      });
    }
    return event;
  });
  assert.equal(count, 1);
  assert.equal(events.at(-1).type, "run.completed");
});
test("service configuration capacity rejects a ninth configuration without evicting healthy services", async (t) => {
  const { scope } = await setup(t);
  for (let revision = 0; revision < 8; revision++)
    await Array.fromAsync(
      scope.invoke(
        request("hello", {
          agentConfig: { providerOptions: { codexServiceRevision: String(revision) } }
        })
      )
    );
  const before = scope.processes().map((value) => value.pid);
  await assert.rejects(
    Array.fromAsync(
      scope.invoke(
        request("hello", {
          agentConfig: { providerOptions: { codexServiceRevision: "ninth" } }
        })
      )
    ),
    /CODEX_SERVICE_CONFIGURATIONS_EXCEEDED/
  );
  assert.deepEqual(
    scope.processes().map((value) => value.pid),
    before
  );
});

test("active process death fails the original turn and recovers without replay", async (t) => {
  const { scope, log } = await setup(t);
  const events = await Array.fromAsync(scope.invoke(request("exit")));
  assert.equal(events.at(-1).type, "run.failed");
  const generation = scope.processes()[0].incarnation;
  await eventually(
    () => scope.processes()[0].state === "ready" && scope.processes()[0].incarnation > generation
  );
  const writes = (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(writes.filter((e) => e.method === "turn/start").length, 1);
});
test("stdout EOF with a live owned child triggers cleanup and idle recovery", async (t) => {
  const { scope } = await setup(t);
  const events = await Array.fromAsync(scope.invoke(request("eof-live")));
  assert.equal(events.at(-1).type, "run.failed");
  const old = scope.processes()[0];
  await eventually(
    () =>
      scope.processes()[0].state === "ready" && scope.processes()[0].incarnation > old.incarnation
  );
  assert.throws(() => process.kill(old.pid, 0), { code: "ESRCH" });
});
test("shutdown during recovery permanently prevents another spawn", async (t) => {
  const { scope, log } = await setup(t);
  await Array.fromAsync(scope.invoke(request()));
  process.kill(scope.processes()[0].pid, "SIGKILL");
  await eventually(() => scope.processes()[0].state === "recovering");
  assert.equal((await scope.close({ deadline: performance.now() + 2500 })).complete, true);
  await delay(400);
  const writes = (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(writes.filter((e) => e.method === "initialize").length, 1);
});
for (const protocolMode of ["canonical", "native"])
  test(`fallback result survives failed cleanup through Core: ${protocolMode}`, async (t) => {
    const { adapter } = await setup(t);
    const core = new AgentExecutor();
    core.register(adapter);
    const frames = await Array.fromAsync(
      preparedFrames(
        core,
        "codex",
        request("stall-ignore", {
          agentConfig: { providerOptions: { finalizationTimeoutMs: 40 } }
        }),
        { protocolMode }
      )
    );
    assert.equal(frames.at(-1).control.state, "completed");
    const result = await core.shutdown();
    assert.equal(result.cleanup, "incomplete");
    assert.equal(result.failedCleanupInvocationIds.length, 1);
    assert.equal(result.unresolvedServiceIds.length, 0);
  });
