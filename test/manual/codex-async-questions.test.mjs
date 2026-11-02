import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate as tick } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { CodexAsyncQuestions } from "../../packages/octo-runtime-adapter-codex/dist/async-questions.js";
import {
  normalizeCodexEvent,
  createCodexAdapter
} from "../../packages/octo-runtime-adapter-codex/dist/index.js";
import {
  assertCanonicalEvent,
  assertQuestionResponse,
  invocationInput,
  canonicalEvents
} from "../../packages/octo-runtime-protocol/dist/index.js";
import { InvocationWatchdog } from "../../packages/octo-runtime-executor-core/dist/watchdog.js";
import { InvocationExperience } from "../../packages/octo-runtime-executor-core/dist/experience.js";
import { nativeHost } from "../native-host-fixture.js";
import { invokeRequest } from "../runtime-fixture.js";

const item = (
  questions = [
    { title: "Color?", options: ["Red", "Green"] },
    { title: "Details?", options: null }
  ]
) => ({
  type: "agentMessage",
  id: "message-native",
  text: "Color? Details?",
  phase: "final_answer",
  delivery: "async",
  questions
});
const response = (id) => ({
  interactionId: id,
  outcome: "answered",
  value: {
    schema: "octo.question-response/v1",
    answers: [
      { questionId: "q:1", text: "custom" },
      { questionId: "q:0", text: "Red" }
    ]
  }
});
function fixture({ send, now, lifetimeMs, invocation = "invoke" } = {}) {
  const events = [],
    calls = [];
  let accept, resolve, reject;
  const state = new CodexAsyncQuestions(
    invocation,
    (e) => {
      assertCanonicalEvent(e);
      events.push(e);
    },
    (params, callback) => {
      calls.push(params);
      accept = callback;
      return send
        ? send(params, callback)
        : new Promise((a, b) => {
            resolve = a;
            reject = b;
          });
    },
    now,
    lifetimeMs
  );
  state.register(item(), "thread", "turn", 0);
  return {
    state,
    events,
    calls,
    id: events[0].payload.interactionId,
    ack: (value = { turnId: "turn" }) => {
      try {
        accept(value);
        resolve(value);
      } catch (e) {
        reject(e);
      }
    },
    reject: (e) => reject(e)
  };
}

test("standalone projection preserves async snapshots and ordinary messages stay ordinary", () => {
  for (const method of ["item/started", "item/completed"]) {
    const events = normalizeCodexEvent({
      method,
      params: { threadId: "thread", turnId: "turn", item: item() }
    });
    const message = events.find((e) => e.type.startsWith("message."));
    assert.deepEqual(message.payload.questions, item().questions);
    assert.equal(message.payload.delivery, "async");
    assert.equal(message.payload.messageId, "message-native");
    assertCanonicalEvent(message);
  }
  const plain = normalizeCodexEvent({
    method: "item/completed",
    params: { item: { type: "agentMessage", id: "plain", text: "Which option?" } }
  });
  assert.ok(plain.every((e) => !e.payload.questions && !e.type.startsWith("interaction.")));
});
test("null and empty options survive; malformed questions fail instead of flattening", () => {
  const f = fixture();
  f.state.invalidate("cleanup");
  for (const options of [null, []]) {
    const q = item([{ title: "Explain?", options }]);
    const result = normalizeCodexEvent({ method: "item/completed", params: { item: q } }).find(
      (e) => e.type === "message.update"
    );
    assert.deepEqual(result.payload.questions[0].options, options);
  }
  for (const questions of [
    [{ title: "bad", options: [7] }],
    "bad",
    [{ title: "x".repeat(4097), options: null }],
    Array.from({ length: 51 }, () => ({ title: "x", options: null }))
  ])
    assert.throws(() =>
      normalizeCodexEvent({ method: "item/completed", params: { item: item(questions) } })
    );
});
test("identity is stable per invocation, duplicates do not reactivate, conflicting snapshots fail", async () => {
  const f = fixture(),
    other = fixture({ invocation: "other" });
  assert.notEqual(f.id, other.id);
  f.state.register(item(), "thread", "turn", 0);
  assert.equal(f.events.length, 1);
  assert.throws(
    () =>
      f.state.register(
        { ...item(), questions: [{ title: "changed", options: null }] },
        "thread",
        "turn",
        0
      ),
    /CONFLICT/
  );
  await f.state.respond({ interactionId: f.id, outcome: "cancelled" });
  f.state.register(item(), "thread", "turn", 0);
  assert.equal(f.events.length, 2);
  await assert.rejects(f.state.respond(response(f.id)), (e) => e.code === "INTERACTION_NOT_ACTIVE");
  other.state.invalidate("cleanup");
});
test("submission waits for matching provider acceptance; answers are correlated and ordered", async () => {
  const f = fixture();
  let settled = false;
  const pending = f.state.respond(response(f.id)).then(() => {
    settled = true;
  });
  await tick();
  assert.equal(settled, false);
  assert.equal(f.events.length, 1);
  await assert.rejects(f.state.respond(response(f.id)), (e) => e.code === "INTERACTION_NOT_ACTIVE");
  await assert.rejects(
    f.state.respond({ interactionId: f.id, outcome: "cancelled" }),
    (e) => e.code === "INTERACTION_NOT_ACTIVE"
  );
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].expectedTurnId, "turn");
  const data = JSON.parse(f.calls[0].input[0].text.split("\n")[1]);
  assert.equal(data.messageId, "message-native");
  assert.deepEqual(
    data.answers.map((a) => a.text),
    ["Red", "custom"]
  );
  f.ack();
  await pending;
  assert.equal(f.events.at(-1).payload.reasonCode, "provider_accepted");
  await assert.rejects(f.state.respond(response(f.id)));
  assert.equal(f.calls.length, 1);
});
for (const variant of [
  "missing",
  "unknown",
  "duplicate",
  "empty",
  "oversized",
  "outcome",
  "cancel-value"
])
  test(`invalid answers are rejected before write: ${variant}`, async () => {
    const f = fixture(),
      r = response(f.id);
    if (variant === "missing") r.value.answers.pop();
    if (variant === "unknown") r.value.answers[0].questionId = "q:9";
    if (variant === "duplicate") r.value.answers[0].questionId = "q:0";
    if (variant === "empty") r.value.answers[0].text = "  ";
    if (variant === "oversized") r.value.answers[0].text = "x".repeat(4097);
    if (variant === "outcome") r.outcome = "accepted";
    if (variant === "cancel-value") r.outcome = "cancelled";
    await assert.rejects(f.state.respond(r));
    assert.equal(f.calls.length, 0);
    assert.equal(f.state.size, 1);
    f.state.invalidate("cleanup");
  });
for (const kind of ["wrong-turn", "rpc-reject", "timeout", "disconnect", "terminal-first"])
  test(`failed/ambiguous delivery never resolves successfully: ${kind}`, async () => {
    const f = fixture();
    const pending = f.state.respond(response(f.id));
    const rejected = assert.rejects(
      pending,
      (e) =>
        e.code === (kind === "rpc-reject" ? "ASYNC_ANSWER_REJECTED" : "OPERATION_OUTCOME_UNKNOWN")
    );
    if (kind === "wrong-turn") f.ack({ turnId: "other" });
    else if (kind === "terminal-first") {
      f.state.invalidate("run_terminal");
      f.ack();
    } else
      f.reject(
        Object.assign(new Error("failed"), {
          name: kind === "rpc-reject" ? "CodexAppServerRpcError" : "Error"
        })
      );
    await rejected;
    assert.equal(f.events.at(-1).payload.status, "invalidated");
    assert.equal(f.calls.length, 1);
    await assert.rejects(f.state.respond(response(f.id)));
    assert.equal(f.events.length, 2);
  });
test("known unsent failure allows explicit retry; cancellation does not send", async () => {
  let attempts = 0;
  const f = fixture({
    send: async (_p, accept) => {
      if (!attempts++) throw Object.assign(new Error("unsent"), { deliveryNotAttempted: true });
      accept({ turnId: "turn" });
    }
  });
  await assert.rejects(f.state.respond(response(f.id)), /unsent/);
  assert.equal(f.state.size, 1);
  await f.state.respond(response(f.id));
  assert.equal(f.calls.length, 2);
  const cancelled = fixture();
  await cancelled.state.respond({ interactionId: cancelled.id, outcome: "cancelled" });
  assert.equal(cancelled.calls.length, 0);
  assert.equal(cancelled.events.at(-1).payload.reasonCode, "user_cancelled");
});
test("expiry and capacity enforce finite lifetime and never silently truncate", async () => {
  let now = 0;
  const f = fixture({ now: () => now, lifetimeMs: 600000 });
  now = 600000;
  await assert.rejects(f.state.respond(response(f.id)));
  assert.equal(f.events.at(-1).payload.status, "expired");
  assert.equal(f.calls.length, 0);
  const g = fixture();
  for (let i = 1; i < 16; i++) g.state.register({ ...item(), id: `id-${i}` }, "thread", "turn", 0);
  assert.throws(
    () => g.state.register({ ...item(), id: "overflow" }, "thread", "turn", 0),
    /LIMIT/
  );
  g.state.invalidate("cleanup");
});
test("consumer edits to the public form cannot change the registered native question", async () => {
  const f = fixture();
  const publicRequest = f.events[0].payload.request;
  publicRequest.messageId = "changed-message";
  publicRequest.questions[0].id = "changed-id";
  publicRequest.questions[0].title = "Changed by consumer";
  publicRequest.questions[0].options.push("changed-option");
  const pending = f.state.respond(response(f.id));
  const input = JSON.parse(f.calls[0].input[0].text.split("\n")[1]);
  assert.equal(input.messageId, "message-native");
  assert.equal(input.answers[0].questionId, "q:0");
  assert.equal(input.answers[0].title, "Color?");
  f.ack();
  await pending;
});

test("async questions leave experience and watchdog non-blocking", () => {
  const f = fixture(),
    e = f.events[0];
  const generated = new InvocationExperience().accept(e);
  assert.ok(generated.every((v) => v.payload.kind !== "waiting_input"));
  const watch = new InvocationWatchdog({}, new AbortController());
  watch.canonical(e);
  assert.equal(watch.snapshot().pendingInteractionCount, 0);
  watch.canonical({ ...e, payload: { ...e.payload, delivery: undefined } });
  assert.equal(watch.snapshot().pendingInteractionCount, 1);
  watch.dispose();
  f.state.invalidate("cleanup");
});

const fake = fileURLToPath(new URL("./fixtures/codex-async-server.mjs", import.meta.url));
for (const scenario of ["normal", "wrong", "reject", "lost", "stale"])
  test(`native Kernel / Core RPC round trip: ${scenario}`, { timeout: 10000 }, async () => {
    const native = await nativeHost([
      createCodexAdapter({ command: process.execPath, appServerArgs: [fake] })
    ]);
    const host = native.client,
      events = [];
    const req = invokeRequest({
      modelInput: scenario,
      prompt: scenario,
      signal: AbortSignal.timeout(8000)
    });
    let original;
    try {
      for await (const event of canonicalEvents(
        host.invokeFrames(invocationInput(req, "canonical", "codex"))
      )) {
        events.push(event);
        if (event.type !== "interaction.requested") continue;
        original = response(event.payload.interactionId);
        if (scenario === "stale") continue;
        if (scenario === "normal") await host.respondInteraction(req.invocationId, original);
        else
          await assert.rejects(
            host.respondInteraction(req.invocationId, original),
            (e) =>
              e.code ===
              (scenario === "reject" ? "ASYNC_ANSWER_REJECTED" : "OPERATION_OUTCOME_UNKNOWN")
          );
      }
      assert.equal(events.filter((e) => e.type === "interaction.requested").length, 1);
      assert.equal(
        events.filter((e) => e.type === "interaction.resolved").length,
        scenario === "stale" ? 0 : 1
      );
      const resolved = events.find((e) => e.type === "interaction.resolved")?.payload;
      if (scenario !== "stale")
        assert.equal(resolved.status, scenario === "normal" ? "resolved" : "invalidated");
      if (scenario === "normal")
        assert.ok(events.some((e) => e.payload.text?.includes("steers=1")));
      await assert.rejects(async () => host.respondInteraction(req.invocationId, original));
    } finally {
      await native.close();
    }
  });
