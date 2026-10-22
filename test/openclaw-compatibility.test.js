import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Ajv from "ajv";
import { createOpenClawAdapter } from "../packages/octo-runtime-adapter-openclaw/dist/index.js";
import {
  gatewayTerminal,
  resolveGatewayContract
} from "../packages/octo-runtime-adapter-openclaw/dist/compatibility.js";
import { assertCanonicalEvent } from "../packages/octo-runtime-protocol/dist/index.js";

const contracts = JSON.parse(
  readFileSync(new URL("../test-support/openclaw-request-contracts.json", import.meta.url))
);
const ajv = new Ajv();
const validators = Object.fromEntries(
  Object.entries(contracts.schemas).map(([key, schema]) => [key, ajv.compile(schema)])
);
const methods = [
  "agents.list",
  "sessions.create",
  "sessions.patch",
  "sessions.messages.subscribe",
  "agent",
  "agent.wait",
  "sessions.abort"
];
function hello(version, approval = true) {
  return {
    protocol: 4,
    server: { version },
    features: {
      methods: [...methods, ...(approval ? ["exec.approval.list", "exec.approval.resolve"] : [])],
      events: ["agent", ...(approval ? ["exec.approval.requested", "exec.approval.resolved"] : [])]
    }
  };
}
function request(overrides = {}) {
  return {
    protocolVersion: 2,
    invocationId: "invocation",
    agentSessionId: "session",
    runId: "run",
    prompt: "hello",
    modelInput: "hello",
    controlInstructions: "trusted system instruction",
    context: { schema: "octo.context-envelope/v3", items: [] },
    approvalMode: "ask",
    agentSource: "preset",
    workdir: "",
    agentConfig: {
      providerAgentId: "main",
      model: "fixture/model",
      effort: "high",
      providerOptions: {
        OPENCLAW_GATEWAY_URL: "ws://localhost:1",
        OPENCLAW_GATEWAY_TOKEN: "secret-fixture",
        OPENCLAW_GATEWAY_DEVICE_ID: "d",
        OPENCLAW_GATEWAY_PUBLIC_KEY: "p",
        OPENCLAW_GATEWAY_PRIVATE_KEY: "k"
      }
    },
    ...overrides
  };
}
function fixture({
  version = "2026.10.5",
  handshake = hello(version),
  fail,
  result = { status: "ok" },
  waits = [{ status: "ok" }],
  approval = false,
  cancel,
  cancelBeforeAccepted = false,
  lifecycle
} = {}) {
  const calls = [];
  let listener,
    closed = 0,
    detached = 0,
    waitIndex = 0,
    finish;
  const source = contracts.versions.find((entry) => entry.tag === version.replace(/^v/, ""));
  const client = {
    connect: async () => handshake,
    onEvent(fn) {
      listener = fn;
      return () => {
        detached++;
      };
    },
    close: async () => {
      closed++;
      finish?.({ status: "ok" });
    },
    async request(method, params, options = {}) {
      calls.push({ method, params });
      const name = {
        "sessions.create": "SessionsCreateParamsSchema",
        "sessions.patch": "SessionsPatchParamsSchema",
        agent: "AgentParamsSchema"
      }[method];
      if (name && source) {
        const validate = validators[source.schemas[name]];
        assert.ok(validate, `Unexpected RPC ${method} on ${version}`);
        assert.equal(validate(params), true, JSON.stringify(validate.errors));
      }
      const failure = fail?.(method, params);
      if (failure instanceof Error) throw failure;
      if (failure !== undefined) return failure;
      if (method === "agents.list") return { agents: [{ id: "main" }] };
      if (method === "sessions.create") return { key: params.key };
      if (method === "sessions.patch")
        return {
          ok: true,
          key: params.key,
          entry: { execSecurity: params.execSecurity, execAsk: params.execAsk }
        };
      if (method === "exec.approval.list") return [];
      if (method === "agent.wait") return waits[Math.min(waitIndex++, waits.length - 1)];
      if (method === "exec.approval.resolve") {
        listener({
          event: "exec.approval.resolved",
          payload: { id: "approval", decision: params.decision }
        });
        finish?.(result);
        return { ok: true };
      }
      if (method === "agent") {
        const runId = params.idempotencyKey;
        if (cancelBeforeAccepted) {
          cancel.abort("cancel before ACK");
          throw new Error("aborted before ACK");
        }
        options.onAccepted?.({ runId });
        if (cancel) {
          cancel.abort("user cancellation");
          throw new Error("aborted");
        }
        if (approval) {
          const pending = new Promise((resolve) => {
            finish = resolve;
          });
          listener({
            event: "exec.approval.requested",
            payload: {
              id: "approval",
              expiresAtMs: Date.now() + 60000,
              request: {
                sessionKey: params.sessionKey,
                runId,
                command: "echo fixture",
                allowedDecisions: ["allow-once", "allow-always", "deny"]
              }
            }
          });
          return pending;
        }
        listener({
          event: "agent",
          payload: { runId, seq: 1, stream: "assistant", data: { text: "fixture answer" } }
        });
        if (lifecycle)
          listener({
            event: "agent",
            payload: { runId, seq: 2, stream: "lifecycle", data: lifecycle }
          });
        if (result instanceof Error) throw result;
        return result;
      }
      return {};
    }
  };
  const adapter = createOpenClawAdapter({ clientFactory: () => client });
  return {
    adapter,
    client,
    calls,
    get closed() {
      return closed;
    },
    get detached() {
      return detached;
    }
  };
}
async function invoke(f, req = request()) {
  const events = [];
  for await (const event of f.adapter.invoke(req)) {
    assertCanonicalEvent(event);
    events.push(event);
  }
  return events;
}

for (const { tag, schemas } of contracts.versions)
  for (const mode of ["ask", "full_access"]) {
    test(`OpenClaw ${tag} ${mode} executes once with source-derived strict requests`, async () => {
      const f = fixture({ version: tag });
      const events = await invoke(f, request({ approvalMode: mode }));
      assert.equal(events.at(-1).type, "run.completed");
      const legacy = Boolean(schemas.SessionsPatchParamsSchema);
      assert.deepEqual(
        f.calls.map(({ method }) => method),
        [
          "agents.list",
          "sessions.create",
          ...(legacy ? ["sessions.patch"] : []),
          "sessions.messages.subscribe",
          ...(!legacy && mode === "ask" ? ["exec.approval.list"] : []),
          "agent"
        ]
      );
      const create = f.calls.find((call) => call.method === "sessions.create").params;
      const agent = f.calls.find((call) => call.method === "agent").params;
      assert.equal(agent.thinking, "high");
      assert.equal(agent.model, "fixture/model");
      assert.match(agent.extraSystemPrompt, /trusted system instruction/);
      assert.match(agent.idempotencyKey, /^octo-runtime-run-/);
      assert.equal(create.thinkingLevel, legacy ? undefined : "high");
      assert.equal(create.permissionMode, legacy ? undefined : mode === "ask" ? "guarded" : "full");
      assert.equal(create.idempotencyKey, legacy ? undefined : `${agent.idempotencyKey}-session`);
      assert.equal(
        events.filter((event) => event.type === "run.notice").length,
        legacy && mode === "ask" ? 1 : 0
      );
      assert.equal(
        events.filter((event) => event.type.startsWith("run.") && event.type !== "run.notice")
          .length,
        1
      );
      assert.equal(f.closed, 1);
      assert.equal(f.detached, 1);
    });
  }

test("legacy strict requests reproduce the regression when any modern-only create field leaks", () => {
  const entry = contracts.versions[0];
  const validate = validators[entry.schemas.SessionsCreateParamsSchema];
  for (const [field, value] of [
    ["permissionMode", "full"],
    ["thinkingLevel", "high"],
    ["idempotencyKey", "key"]
  ]) {
    assert.equal(validate({ key: "session", agentId: "main", [field]: value }), false);
    assert.equal(validate.errors[0].keyword, "additionalProperties");
  }
});

test("release normalization preserves maintenance suffixes and rejects unverified versions", async () => {
  for (const version of ["v2026.7.1-1", "v2026.7.1-2", "v2026.10.5"]) {
    assert.equal((await invoke(fixture({ version }))).at(-1).type, "run.completed");
  }
  for (const version of [
    undefined,
    "2026.7.2",
    "2026.10.10-beta.1",
    "2026.10.5-fork",
    "2027.1.1"
  ]) {
    const f = fixture({ handshake: hello(version) });
    const events = await invoke(f);
    assert.equal(events.at(-1).type, "run.failed");
    assert.match(events.at(-1).payload.message, /COMPATIBILITY_UNSUPPORTED/);
    assert.deepEqual(f.calls, []);
    assert.equal(f.closed, 1);
  }
});

test("probe and invocation revalidate their own connection in both version directions", async () => {
  for (const versions of [
    ["2026.7.1", "2026.10.5"],
    ["2026.10.5", "2026.7.1"]
  ]) {
    const first = fixture({ version: versions[0] }),
      second = fixture({ version: versions[1] });
    let count = 0;
    const adapter = createOpenClawAdapter({
      clientFactory: () => (count++ === 0 ? first.client : second.client)
    });
    assert.equal(
      (await adapter.probe({ providerOptions: request().agentConfig.providerOptions })).available,
      true
    );
    assert.deepEqual(
      first.calls.map((call) => call.method),
      ["agents.list"]
    );
    const events = await invoke({ adapter });
    assert.equal(events.at(-1).type, "run.completed");
    assert.equal(
      events.find((event) => event.type === "model_step.started").payload.stepId,
      events.find((event) => event.type === "model_step.finished").payload.stepId
    );
    const create = second.calls.find((call) => call.method === "sessions.create");
    assert.equal(
      create.params.permissionMode,
      versions[1].startsWith("2026.7.") ? undefined : "guarded"
    );
  }
});

test("missing core capabilities fail before session creation while absent approval transport falls back", async () => {
  for (const method of methods.filter((method) => method !== "sessions.patch")) {
    const handshake = hello("2026.10.5");
    handshake.features.methods = handshake.features.methods.filter((item) => item !== method);
    const f = fixture({ handshake });
    assert.equal((await invoke(f)).at(-1).type, "run.failed");
    assert.deepEqual(f.calls, []);
  }
  const f = fixture({ handshake: hello("2026.10.5", false) });
  const events = await invoke(f);
  assert.equal(events.at(-1).type, "run.completed");
  assert.equal(
    f.calls.find((call) => call.method === "sessions.create").params.permissionMode,
    "full"
  );
  assert.match(
    events.find((event) => event.type === "run.notice").payload.params.message,
    /approval_transport_unavailable/
  );
});

test("insufficient native scope is not misreported as an available full fallback", async () => {
  const handshake = {
    ...hello("2026.10.5", false),
    auth: { scopes: ["operator.read", "operator.write"] }
  };
  const f = fixture({ handshake });
  const events = await invoke(f);
  assert.equal(events.at(-1).type, "run.failed");
  assert.match(events.at(-1).payload.message, /full requires operator.admin/);
  assert.deepEqual(f.calls, []);
});

test(
  "effective full automatically resolves legacy approvals while retaining requested ask and context identity",
  { timeout: 3000 },
  async () => {
    const f = fixture({ version: "2026.7.1", approval: true });
    const req = request();
    const original = structuredClone(req);
    const events = await invoke(f, req);
    assert.equal(events.at(-1).type, "run.completed");
    assert.deepEqual(req, original);
    const interaction = events.find((event) => event.type === "interaction.requested");
    assert.equal(interaction.payload.request.policy.mode, "ask");
    assert.deepEqual(
      f.calls.filter((call) => call.method === "exec.approval.resolve"),
      [{ method: "exec.approval.resolve", params: { id: "approval", decision: "allow-once" } }]
    );
    assert.equal(events.filter((event) => event.type === "interaction.resolved").length, 1);
    const notice = JSON.stringify(events.find((event) => event.type === "run.notice"));
    assert.doesNotMatch(notice, /secret-fixture|trusted system instruction|fixture answer/);
  }
);

test("create, permission patch and subscription failures never dispatch or replay agent", async () => {
  for (const method of ["sessions.create", "sessions.patch", "sessions.messages.subscribe"]) {
    const f = fixture({
      version: "2026.7.1",
      fail: (current) =>
        current === method ? new Error("fixture timeout: state unknown") : undefined
    });
    const events = await invoke(f);
    assert.equal(events.at(-1).type, "run.failed");
    assert.equal(f.calls.filter((call) => call.method === method).length, 1);
    assert.equal(f.calls.filter((call) => call.method === "agent").length, 0);
    assert.equal(f.closed, 1);
  }
  for (const patched of [
    { ok: true, key: "foreign", entry: { execSecurity: "full", execAsk: "off" } },
    { ok: true, entry: {} }
  ]) {
    const f = fixture({
      version: "2026.7.1",
      fail: (method) => (method === "sessions.patch" ? patched : undefined)
    });
    assert.equal((await invoke(f)).at(-1).type, "run.failed");
    assert.equal(f.calls.filter((call) => call.method === "agent").length, 0);
  }
});

for (const stopReason of ["rpc", "stop", "restart"])
  test(`native ${stopReason} cancellation reconciles without duplicate abort`, async () => {
    const controller = new AbortController();
    const f = fixture({
      version: "2026.7.1",
      cancel: controller,
      waits: [{ status: "timeout", endedAt: Date.now(), stopReason }]
    });
    const events = await invoke(f, request({ signal: controller.signal }));
    assert.equal(events.at(-1).type, "run.cancelled");
    assert.equal(f.calls.filter((call) => call.method === "sessions.abort").length, 1);
    assert.equal(f.calls.filter((call) => call.method === "agent").length, 1);
  });

test("a nonterminal final receipt waits through pendingError and wait timeout", async () => {
  const f = fixture({
    result: { status: "queued" },
    waits: [
      { status: "error", pendingError: true },
      { status: "timeout" },
      { status: "ok", endedAt: Date.now() }
    ]
  });
  const events = await invoke(f);
  assert.equal(events.at(-1).type, "run.completed");
  assert.equal(f.calls.filter((call) => call.method === "agent.wait").length, 3);
  assert.equal(events.filter((event) => event.type === "model_step.started").length, 1);
  assert.equal(events.filter((event) => event.type === "model_step.finished").length, 1);
});

test("a pending lifecycle error does not finish the model step before the final receipt", async () => {
  const f = fixture({ lifecycle: { phase: "error", pendingError: true } });
  const events = await invoke(f);
  assert.equal(events.at(-1).type, "run.completed");
  const finishes = events.filter((event) => event.type === "model_step.finished");
  assert.equal(finishes.length, 1);
  assert.equal(finishes[0].payload.status, "completed");
});

test("cancellation after dispatch but before ACK requires native terminal confirmation", async () => {
  const controller = new AbortController();
  const f = fixture({
    version: "2026.7.1",
    cancel: controller,
    cancelBeforeAccepted: true,
    waits: [{ status: "error", stopReason: "rpc", endedAt: Date.now() }]
  });
  const events = await invoke(f, request({ signal: controller.signal }));
  assert.equal(events.at(-1).type, "run.cancelled");
  assert.equal(f.calls.filter((call) => call.method === "agent").length, 1);
  assert.equal(f.calls.filter((call) => call.method === "sessions.abort").length, 1);
  assert.equal(f.calls.filter((call) => call.method === "agent.wait").length, 1);
});

test("abort ACK alone cannot turn a completed native run into confirmed cancellation", async () => {
  for (const cancelBeforeAccepted of [false, true]) {
    const controller = new AbortController();
    const f = fixture({
      cancel: controller,
      cancelBeforeAccepted,
      waits: [{ status: "ok", endedAt: 1 }]
    });
    const events = await invoke(f, request({ signal: controller.signal }));
    assert.equal(events.at(-1).type, "run.failed");
    assert.match(events.at(-1).payload.message, /confirmed completed, not cancelled/);
    assert.equal(events.filter((event) => event.type === "run.cancelled").length, 0);
    assert.equal(f.calls.filter((call) => call.method === "sessions.abort").length, 1);
  }
});

for (const lifecycle of [undefined, { phase: "end" }])
  for (const abortAt of ["model_step.finished", "message.update"])
    test(`late cancellation preserves native completion: ${lifecycle ? "lifecycle" : "final receipt"}, ${abortAt}`, async () => {
      const controller = new AbortController();
      const f = fixture({ lifecycle, waits: [{ status: "ok", endedAt: 1 }] });
      const events = [];
      for await (const event of f.adapter.invoke(request({ signal: controller.signal }))) {
        assertCanonicalEvent(event);
        events.push(event);
        if (event.type === abortAt && event.payload.status === "completed")
          controller.abort("consumer cancelled after native completion");
      }
      assert.equal(controller.signal.aborted, true);
      assert.equal(events.at(-1).type, "run.completed");
      assert.equal(events.filter((event) => event.type === "run.cancelled").length, 0);
      assert.equal(events.filter((event) => event.payload.status === "stopped").length, 0);
      assert.equal(f.calls.filter((call) => call.method === "sessions.abort").length, 0);
    });

test("terminal interpretation distinguishes normal stop, cancellation cleanup and provider timeout", () => {
  for (const source of ["wait", "final"]) {
    for (const stopReason of ["rpc", "stop"]) {
      assert.equal(gatewayTerminal({ status: "ok", stopReason }, source), "completed");
      assert.equal(
        gatewayTerminal({ status: "timeout", endedAt: 1, stopReason }, source),
        "cancelled"
      );
      assert.equal(
        gatewayTerminal(
          { status: "timeout", endedAt: 1, stopReason, providerStarted: true },
          source
        ),
        "failed"
      );
    }
    assert.equal(
      gatewayTerminal({ status: "timeout", endedAt: 1, stopReason: "restart" }, source),
      "cancelled"
    );
    assert.equal(
      gatewayTerminal(
        { status: "error", result: { meta: { aborted: true, timeoutPhase: "provider" } } },
        source
      ),
      "failed"
    );
    assert.equal(
      gatewayTerminal(
        { status: "error", result: { meta: { aborted: true, stopReason: "timeout" } } },
        source
      ),
      "failed"
    );
    assert.equal(gatewayTerminal({ status: "ok", livenessState: " BLOCKED " }, source), "failed");
    assert.equal(gatewayTerminal({ status: "ok", livenessState: "abandoned" }, source), "failed");
    for (const status of ["accepted", "in_flight", "queued", "pending", "running"])
      assert.equal(gatewayTerminal({ status }, source), undefined);
  }
  assert.equal(gatewayTerminal({ phase: "end", aborted: true }, "lifecycle"), "cancelled");
  assert.throws(
    () => resolveGatewayContract({ ...hello("2026.10.5"), protocol: 3 }),
    /unsupported Gateway protocol/
  );
});

test("lost acknowledgement never replays an agent request", async () => {
  const f = fixture({
    fail: (method) => (method === "agent" ? new Error("ACK lost: state unknown") : undefined)
  });
  const events = await invoke(f);
  assert.equal(events.at(-1).type, "run.failed");
  assert.equal(f.calls.filter((call) => call.method === "agent").length, 1);
  assert.equal(f.calls.filter((call) => call.method === "sessions.create").length, 1);
});

test("disconnect reconciliation rechecks contracts and preserves the actual terminal without replay", async () => {
  for (const [status, stopReason, expected] of [
    ["ok", undefined, "run.completed"],
    ["error", undefined, "run.failed"],
    ["timeout", "rpc", "run.cancelled"]
  ]) {
    const first = fixture({ version: "2026.7.1", result: new Error("connection lost") });
    const second = fixture({ version: "2026.10.5", waits: [{ status, stopReason, endedAt: 1 }] });
    let count = 0;
    const adapter = createOpenClawAdapter({
      clientFactory: () => (count++ === 0 ? first.client : second.client)
    });
    const events = await invoke({ adapter });
    assert.equal(events.at(-1).type, expected);
    assert.equal(first.calls.filter((call) => call.method === "agent").length, 1);
    assert.deepEqual(
      second.calls.map((call) => call.method),
      ["agent.wait"]
    );
    assert.equal(first.closed, 1);
    assert.equal(second.closed, 1);
  }
  const first = fixture({ result: new Error("connection lost") });
  const second = fixture({ handshake: hello("2027.1.1") });
  let count = 0;
  const adapter = createOpenClawAdapter({
    clientFactory: () => (count++ === 0 ? first.client : second.client)
  });
  const events = await invoke({ adapter });
  assert.equal(events.at(-1).type, "run.failed");
  assert.match(events.at(-1).payload.message, /COMPATIBILITY_UNSUPPORTED/);
  assert.deepEqual(second.calls, []);
});

for (const path of ["lifecycle", "final receipt", "reconnect"])
  for (const staleOutcome of ["ok", "error"])
    test(`confirmed cancellation wins over an older ${path} wait: ${staleOutcome}`, async () => {
      const controller = new AbortController();
      const older = Promise.withResolvers();
      const holdOlderWait = () => {
        queueMicrotask(() => controller.abort("cancel during older reconciliation"));
        return older.promise;
      };
      let waits = 0;
      const first = fixture({
        lifecycle: path === "lifecycle" ? { phase: "end" } : undefined,
        result: path === "reconnect" ? new Error("connection lost") : { status: "queued" },
        fail: (method) => {
          if (method !== "agent.wait") return;
          if (path !== "reconnect" && ++waits === 1) return holdOlderWait();
          return { status: "error", endedAt: 2, stopReason: "rpc" };
        }
      });
      const close = first.client.close;
      first.client.close = async () => {
        await close();
        older.resolve({ status: staleOutcome, endedAt: 1 });
      };
      const second = fixture({
        fail: (method) => (method === "agent.wait" ? holdOlderWait() : undefined)
      });
      let factories = 0;
      const adapter = createOpenClawAdapter({
        clientFactory: () => (factories++ === 0 ? first.client : second.client)
      });
      const events = await invoke({ adapter }, request({ signal: controller.signal }));
      assert.equal(events.at(-1).type, "run.cancelled");
      assert.equal(events.filter((event) => event.type === "run.completed").length, 0);
      assert.equal(events.filter((event) => event.type === "run.failed").length, 0);
      const finishes = events.filter((event) => event.type === "model_step.finished");
      assert.equal(finishes.length, 1);
      assert.equal(finishes[0].payload.status, "cancelled");
      assert.equal(first.calls.filter((call) => call.method === "agent").length, 1);
      assert.equal(first.calls.filter((call) => call.method === "sessions.abort").length, 1);
      assert.equal(factories, path === "reconnect" ? 2 : 1);
    });

test("late cancellation preserves confirmed native failure and its diagnostic", async () => {
  const controller = new AbortController();
  const f = fixture({ result: { status: "error", summary: "native failure retained" } });
  const events = [];
  for await (const event of f.adapter.invoke(request({ signal: controller.signal }))) {
    events.push(event);
    if (event.type === "model_step.finished") controller.abort("late cancellation");
  }
  assert.equal(events.at(-1).type, "run.failed");
  assert.equal(events.at(-1).payload.message, "native failure retained");
  assert.equal(f.calls.filter((call) => call.method === "sessions.abort").length, 0);
});

test("confirmed cancellation does not hide transport cleanup failure", async () => {
  const controller = new AbortController();
  const f = fixture({ cancel: controller, waits: [{ status: "error", stopReason: "rpc" }] });
  f.client.close = async () => {
    throw new Error("fixture cleanup failed");
  };
  await assert.rejects(invoke(f, request({ signal: controller.signal })), /fixture cleanup failed/);
  assert.equal(f.calls.filter((call) => call.method === "sessions.abort").length, 1);
});

for (const [status, stopReason, expected] of [
  ["ok", undefined, "completed"],
  ["error", undefined, "failed"],
  ["error", "rpc", "cancelled"]
])
  test(`lifecycle reconciliation after disconnect preserves the model-step terminal: ${expected}`, async () => {
    const first = fixture({
      lifecycle: { phase: "end" },
      fail: (method) => (method === "agent.wait" ? new Error("connection lost") : undefined)
    });
    const second = fixture({ waits: [{ status, stopReason, endedAt: 1 }] });
    let factories = 0;
    const adapter = createOpenClawAdapter({
      clientFactory: () => (factories++ === 0 ? first.client : second.client)
    });
    const events = await invoke({ adapter });
    const finishes = events.filter((event) => event.type === "model_step.finished");
    assert.equal(events.filter((event) => event.type === "model_step.started").length, 1);
    assert.equal(finishes.length, 1);
    assert.equal(finishes[0].payload.status, expected);
    assert.equal(first.calls.filter((call) => call.method === "agent").length, 1);
    assert.equal(second.closed, 1);
  });
