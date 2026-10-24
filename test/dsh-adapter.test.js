import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDshAdapter, dshAdapter } from "@mininglamp-oss/octo-runtime-adapter-dsh";
import { DshTrajectory } from "../packages/octo-runtime-adapter-dsh/dist/trajectory.js";
import { DshClient } from "../packages/octo-runtime-adapter-dsh/dist/client.js";
import { assertCanonicalEvent, failurePayload } from "@mininglamp-oss/octo-runtime-protocol";
import { AgentExecutor } from "@mininglamp-oss/octo-runtime-executor-core";
import { RuntimeLogging } from "../packages/octo-runtime-adapter-sdk/dist/index.js";
import { invokeRequest } from "./runtime-fixture.js";

const fixturePath = new URL("./fixtures/dsh-runtime.mjs", import.meta.url).pathname;
const terminals = (events) =>
  events.filter((e) => ["run.completed", "run.failed", "run.cancelled"].includes(e.type));
const text = (events) =>
  events
    .filter((e) => e.type === "message.delta" && e.payload.channel === "final")
    .map((e) => e.payload.text)
    .join("");
async function fixture(t, mode = "success") {
  const directory = await mkdtemp(join(tmpdir(), "octo-dsh-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const trace = join(directory, "trace.jsonl");
  const canary = randomUUID();
  const request = invokeRequest({
    workdir: directory,
    approvalMode: "full_access",
    modelInput: "hello",
    controlInstructions: "control-only",
    agentConfig: {
      providerOptions: {
        command: process.execPath,
        args: [fixturePath],
        initializeTimeoutMs: 2000,
        requestTimeoutMs: 2000
      }
    },
    executionEnvOverrides: {
      env_variables: [
        { key: "OCTO_DSH_FIXTURE", value: mode },
        { key: "OCTO_DSH_TRACE", value: trace },
        { key: "OCTO_DSH_CANARY", value: canary },
        { key: "OCTO_DSH_VALUE", value: canary }
      ]
    }
  });
  return {
    request,
    directory,
    canary,
    trace: async () => (await readFile(trace, "utf8")).trim().split("\n").map(JSON.parse)
  };
}
const collect = (request, adapter = createDshAdapter()) => Array.fromAsync(adapter.invoke(request));

test("DSH canonical contract: committed stream, Unicode, CRLF, usage and independent execution environment", async (t) => {
  const f = await fixture(t);
  const events = await collect(f.request);
  events.forEach(assertCanonicalEvent);
  assert.deepEqual(
    terminals(events).map((e) => e.type),
    ["run.completed"]
  );
  assert.equal(text(events), "hello 世界");
  assert.equal(
    events.find((e) => e.payload.channel === "analysis").payload.exposure,
    "private_reasoning"
  );
  assert.deepEqual(dshAdapter.metadata.protocolSupport.modes, ["canonical"]);
  assert.equal(events.find((e) => e.type === "usage.update").payload.inputTokens, 12);
  const trace = await f.trace();
  assert.deepEqual(
    trace.map((e) => e.method),
    ["initialize", "session/prompt", "session/wait", "shutdown"]
  );
  assert.equal(trace[0].permission, "danger-full-access");
  assert.equal(trace[0].value, f.canary);
  assert.equal(trace[1].params.contentBlocks[0].text, "control-only");
  assert.equal(JSON.stringify(events).includes(f.canary), false);
  assert.equal(process.env.OCTO_DSH_VALUE, undefined);
  assert.throws(() => process.kill(trace[0].pid, 0), /ESRCH/);
});

for (const [mode, code] of [
  ["provider-error", "DSH_EXECUTION_FAILED"],
  ["no-receipt", "DSH_TRAJECTORY_INVALID"],
  ["no-terminal", "DSH_TRAJECTORY_INVALID"],
  ["empty", "DSH_NO_FINAL_OUTPUT"],
  ["transport", "DSH_TRANSPORT_CLOSED"],
  ["invalid-json", "DSH_PROTOCOL_ERROR"],
  ["mismatch", "DSH_TRAJECTORY_INVALID"]
])
  test(`DSH ${mode} cannot fabricate a successful run or leak native error text`, async (t) => {
    const f = await fixture(t, mode);
    const logs = [];
    const events = await collect(
      f.request,
      createDshAdapter({ log: (...data) => logs.push(data) })
    );
    assert.deepEqual(
      terminals(events).map((e) => e.type),
      ["run.failed"]
    );
    assert.equal(terminals(events)[0].payload.code, code);
    assert.equal(JSON.stringify([events, logs]).includes(f.canary), false);
    const classified = failurePayload(terminals(events)[0].payload, {
      defaultDomain: "adapter",
      stage: "invoke"
    });
    assert.equal(classified.failure.reasonCode, code);
  });

test("DSH resume is explicit, never sends new prompt after restoration rejection", async (t) => {
  const f = await fixture(t, "resume-error");
  f.request.providerSession = { sessionId: "missing-session", resumable: true };
  const events = await collect(f.request);
  assert.equal(terminals(events)[0].payload.code, "DSH_SESSION_RESUME_FAILED");
  assert.equal(
    (await f.trace()).some((e) => e.method === "session/prompt"),
    false
  );
  assert.equal(
    events.some((e) => e.type === "session.update"),
    false
  );
});

test("DSH successful follow-up uses original session and omits first-session control text", async (t) => {
  const f = await fixture(t);
  f.request.providerSession = { sessionId: "existing-session", resumable: true };
  const events = await collect(f.request);
  assert.equal(events[0].payload.providerSession.resumeOutcome, "resumed");
  assert.equal(events[0].payload.providerSession.sessionId, "existing-session");
  const trace = await f.trace();
  assert.equal(trace[1].method, "session/resume");
  assert.equal(trace[2].method, "session/working-directory/set");
  assert.equal(trace[2].params.path, f.directory);
  assert.equal(trace.find((e) => e.method === "session/prompt").params.contentBlocks.length, 1);
});

test("DSH child lineage and failed tool remain scoped and do not fail successful root", async (t) => {
  const child = await fixture(t, "child");
  const childEvents = await collect(child.request);
  childEvents.forEach(assertCanonicalEvent);
  assert.equal(text(childEvents), "hello 世界");
  assert.equal(
    childEvents.find((e) => e.type === "message.delta" && e.payload.channel === "commentary")
      .payload.parentSessionId,
    childEvents[0].payload.providerSession.sessionId
  );
  assert.equal(JSON.stringify(childEvents).includes("LEAK"), false);
  const tool = await fixture(t, "tool");
  const toolEvents = await collect(tool.request);
  toolEvents.forEach(assertCanonicalEvent);
  assert.equal(toolEvents.find((e) => e.type === "tool_call.update").payload.status, "failed");
  assert.equal(terminals(toolEvents)[0].type, "run.completed");
});

test("DSH text deltas reconcile with a committed snapshot exactly once", async (t) => {
  const f = await fixture(t, "legacy-chunk");
  assert.equal(text(await collect(f.request)), "hello 世界");
});

test("DSH bounded startup, request and raw line failures close owned processes", async (t) => {
  const f = await fixture(t, "startup-timeout");
  f.request.agentConfig.providerOptions.initializeTimeoutMs = 40;
  assert.equal(terminals(await collect(f.request))[0].payload.code, "DSH_INITIALIZE_TIMEOUT");
  const waiting = await fixture(t, "cancel");
  waiting.request.runtimeLimits = { runTimeoutMs: 40 };
  assert.equal(terminals(await collect(waiting.request))[0].payload.code, "DSH_REQUEST_TIMEOUT");
  const raw = await fixture(t, "oversized");
  const events = await Array.fromAsync(
    createDshAdapter().invoke(raw.request, {
      streamLimits: {
        ...(await import("@mininglamp-oss/octo-runtime-protocol")).DEFAULT_STREAM_LIMIT_POLICY,
        rawMessageMaxBytes: 1024
      }
    })
  );
  assert.equal(terminals(events)[0].payload.code, "PROVIDER_MESSAGE_TOO_LARGE");
});

test("DSH cancellation reclaims its process while an independent sibling completes", async (t) => {
  const f = await fixture(t, "cancel");
  const sibling = await fixture(t, "delayed");
  const adapter = createDshAdapter();
  const controller = new AbortController();
  f.request.signal = controller.signal;
  const other = collect(sibling.request, adapter);
  const events = [];
  for await (const value of adapter.invoke(f.request)) {
    events.push(value);
    if (value.type === "session.update") controller.abort();
  }
  assert.deepEqual(
    terminals(events).map((e) => e.type),
    ["run.cancelled"]
  );
  assert.deepEqual(
    terminals(await other).map((e) => e.type),
    ["run.completed"]
  );
  const trace = await f.trace();
  assert.throws(() => process.kill(trace[0].pid, 0), /ESRCH/);
});

test("DSH pre-abort, unsupported policy and missing executable do not invoke model", async (t) => {
  const f = await fixture(t);
  f.request.approvalMode = "ask";
  await assert.rejects(collect(f.request), /APPROVAL_MODE_UNSUPPORTED/);
  f.request.approvalMode = "full_access";
  f.request.signal = AbortSignal.abort();
  assert.equal(terminals(await collect(f.request))[0].type, "run.cancelled");
  f.request.signal = undefined;
  f.request.agentConfig.providerOptions.command = join(f.directory, "missing");
  assert.equal(terminals(await collect(f.request))[0].payload.code, "DSH_EXECUTABLE_NOT_FOUND");
});

test("DSH same provider session concurrency is rejected without disturbing owner", async (t) => {
  const f = await fixture(t, "delayed");
  f.request.providerSession = { sessionId: "same" };
  const adapter = createDshAdapter();
  const owner = collect(f.request, adapter);
  await assert.rejects(collect(f.request, adapter), /DSH_SESSION_BUSY/);
  assert.equal(terminals(await owner)[0].type, "run.completed");
});

test("DSH duplicate sequence is ignored, conflicting duplicate fails", () => {
  const trajectory = new DshTrajectory("root", 1024);
  const notification = {
    method: "session.event",
    params: { sessionId: "root", event: { type: "turn/start", seq: 0, time: 1, data: { turn: 0 } } }
  };
  assert.equal(trajectory.accept(notification).length, 1);
  assert.equal(trajectory.accept(notification).length, 0);
  notification.params.event.data.turn = 1;
  assert.throws(() => trajectory.accept(notification), /DSH_TRAJECTORY_INVALID/);
});

test("DSH cleanup failure suppresses completed and retains primary plus cleanup failures", async (t) => {
  const f = await fixture(t, "provider-error");
  const original = DshClient.prototype.close;
  DshClient.prototype.close = async function () {
    await original.call(this);
    throw new Error("fixture cleanup failure");
  };
  try {
    const result = terminals(await collect(f.request));
    assert.equal(result[0].payload.code, "DSH_CLEANUP_FAILED");
    assert.equal(result[0].payload.diagnostics.primaryCode, "DSH_EXECUTION_FAILED");
  } finally {
    DshClient.prototype.close = original;
  }
});

test("DSH AgentExecutor path normalizes public failure and preserves stable DSH reason", async (t) => {
  const f = await fixture(t, "provider-error");
  const logs = [];
  const core = new AgentExecutor({ log: (...entry) => logs.push(entry) });
  core.register(createDshAdapter());
  try {
    const { invocationInput } = await import("@mininglamp-oss/octo-runtime-protocol");
    const events = await Array.fromAsync(
      core.invoke(invocationInput(f.request, "canonical", "dsh"), {
        executionEnvOverrides: f.request.executionEnvOverrides
      })
    );
    const failure = terminals(events)[0].payload;
    assert.equal(failure.failure.reasonCode, "DSH_EXECUTION_FAILED");
    assert.equal(failure.failure.code, "OH-PRV-4099");
    assert.equal(
      logs.find((entry) => entry[1] === "invoke.failed")[2].reason_code,
      "DSH_EXECUTION_FAILED"
    );
    assert.equal(JSON.stringify(events).includes(f.canary), false);
    const diagnostic = logs.find((entry) => entry[1] === "dsh.execution")[2];
    assert.equal(diagnostic.state, "wait");
    assert.equal(diagnostic.native_code, "ACCOUNT_SIGN_IN_REQUIRED");
    assert.ok(diagnostic.pid > 0);
  } finally {
    assert.notEqual((await core.shutdown()).cleanup, "incomplete");
  }
});

test("DSH default Core sink persists bounded native RPC diagnostics without provider secrets", async (t) => {
  const f = await fixture(t, "resume-error");
  f.request.providerSession = { sessionId: "missing-session", resumable: true };
  const directory = join(f.directory, "logs");
  const logging = new RuntimeLogging({ directory });
  const core = new AgentExecutor({ log: logging.kernel });
  core.register(createDshAdapter());
  try {
    const { invocationInput } = await import("@mininglamp-oss/octo-runtime-protocol");
    const events = await Array.fromAsync(
      core.invoke(invocationInput(f.request, "canonical", "dsh"), {
        executionEnvOverrides: f.request.executionEnvOverrides
      })
    );
    assert.equal(terminals(events)[0].payload.failure.reasonCode, "DSH_SESSION_RESUME_FAILED");
    await logging.close();
    const file = (await readdir(directory)).find((name) => name.startsWith("kernel-"));
    const records = (await readFile(join(directory, file), "utf8"))
      .trim()
      .split("\n")
      .map(JSON.parse);
    const diagnostic = records.find((entry) => entry.event === "dsh.execution").data;
    assert.equal(diagnostic.state, "resume");
    assert.equal(diagnostic.request_id, 2);
    assert.equal(diagnostic.native_code, -32000);
    assert.equal(diagnostic.code, "DSH_SESSION_RESUME_FAILED");
    assert.ok(diagnostic.pid > 0);
    assert.equal(JSON.stringify(records).includes(f.canary), false);
  } finally {
    await core.shutdown();
    await logging.close();
  }
});

test("DSH a later caller abort cannot hide an already observed execution failure", async (t) => {
  const f = await fixture(t, "provider-error");
  const controller = new AbortController();
  f.request.signal = controller.signal;
  const original = DshClient.prototype.close;
  DshClient.prototype.close = async function () {
    await original.call(this);
    controller.abort();
  };
  try {
    assert.equal(terminals(await collect(f.request))[0].payload.code, "DSH_EXECUTION_FAILED");
  } finally {
    DshClient.prototype.close = original;
  }
});

async function untilFile(path) {
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      return await readFile(path, "utf8");
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("fixture pid was not written");
}

test("DSH version mismatch refuses input; abort also reclaims the version probe", async (t) => {
  const wrong = await fixture(t, "version");
  assert.equal(terminals(await collect(wrong.request))[0].payload.code, "DSH_VERSION_UNSUPPORTED");
  await assert.rejects(wrong.trace(), { code: "ENOENT" });
  const f = await fixture(t, "version-cancel");
  const pidFile = join(f.directory, "version.pid");
  f.request.executionEnvOverrides.env_variables.push({
    key: "OCTO_DSH_VERSION_PID",
    value: pidFile
  });
  const controller = new AbortController();
  f.request.signal = controller.signal;
  const pending = collect(f.request);
  const pid = Number(await untilFile(pidFile));
  controller.abort();
  assert.equal(terminals(await pending)[0].type, "run.cancelled");
  assert.throws(() => process.kill(pid, 0), /ESRCH/);
});

test(
  "DSH cancellation reclaims a live native descendant after its parent exits",
  {
    skip:
      process.platform === "win32" && "Windows leader-exit ownership limitation is tracked in #14"
  },
  async (t) => {
    const f = await fixture(t, "tree");
    const pidFile = join(f.directory, "child.pid");
    f.request.executionEnvOverrides.env_variables.push({
      key: "OCTO_DSH_CHILD_PID",
      value: pidFile
    });
    const controller = new AbortController();
    f.request.signal = controller.signal;
    const pending = collect(f.request);
    const pid = Number(await untilFile(pidFile));
    controller.abort();
    assert.equal(terminals(await pending)[0].type, "run.cancelled");
    assert.throws(() => process.kill(pid, 0), /ESRCH/);
  }
);

test("DSH rejects a terminal or model step from a different or unstarted turn", () => {
  const trajectory = new DshTrajectory("root", 1024);
  const notify = (type, seq, data) => ({
    method: "session.event",
    params: { sessionId: "root", event: { type, seq, time: 1, data } }
  });
  assert.throws(
    () => trajectory.accept(notify("step/start", 0, { turn: 1, step: 1 })),
    /DSH_TRAJECTORY_INVALID/
  );
  trajectory.accept(notify("turn/start", 1, { turn: 1 }));
  assert.throws(
    () => trajectory.accept(notify("turn/end", 2, { turn: 2, reason: { kind: "completed" } })),
    /DSH_TRAJECTORY_INVALID/
  );
});

test("DSH queue overflow preserves common capacity code and cannot report success", async (t) => {
  const f = await fixture(t);
  const { DEFAULT_STREAM_LIMIT_POLICY } = await import("@mininglamp-oss/octo-runtime-protocol");
  const events = await Array.fromAsync(
    createDshAdapter().invoke(f.request, {
      streamLimits: { ...DEFAULT_STREAM_LIMIT_POLICY, adapterQueueMaxItems: 1 }
    })
  );
  assert.equal(terminals(events)[0].payload.code, "STREAM_QUEUE_ITEMS_EXCEEDED");
  assert.equal(terminals(events).length, 1);
});
