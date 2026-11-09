import { withAgentEnvItems } from "../../packages/octo-runtime-adapter-sdk/dist/index.js";
// 显式本地专项，不进入默认 CI 测试 glob。
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import adapter from "./fixtures/codex-async-adapter.mjs";
import {
  AsyncQuestionReply,
  KernelError,
  createKernelService,
  attachKernel
} from "../../dist/public/executor-kernel.js";
import { assertCanonicalEvent } from "../../dist/public/protocol.js";
import { invocationInput } from "../../packages/octo-runtime-protocol/dist/index.js";
import { kernelFixture } from "../kernel-fixture.js";
import { invokeRequest } from "../runtime-fixture.js";
// 测试宿主直接注入原生 Adapter；重建 Kernel 时仍使用同一 fake Provider。
const options = {
  get adapters() {
    return [adapter()];
  }
};
const value = {
  schema: "octo.question-response/v1",
  answers: [
    { questionId: "q:0", text: "Red" },
    { questionId: "q:1", text: "custom supplement" }
  ]
};
const input = (scenario = "stale") =>
  invocationInput(
    invokeRequest({
      runId: randomUUID(),
      invocationId: randomUUID(),
      agentSessionId: "supplement-session",
      prompt: scenario,
      modelInput: scenario,
      agentEnv: withAgentEnvItems(undefined, [
        {
          namespace: "adapter.codex",
          name: "options",
          payload: { ...{ finalizationTimeoutMs: 40 } }
        }
      ])
    }),
    "canonical",
    "codex"
  );
async function setup(t, scenario = "stale") {
  const f = await kernelFixture(t, options);
  const request = input(scenario);
  const { ref } = await f.client.submit(request);
  let question;
  for await (const frame of f.client.subscribe(ref)) {
    if (frame.event?.type === "interaction.requested") {
      question = frame.event.payload;
      break;
    }
  }
  assert.ok(question);
  const next = {
    ...request,
    sessionId: ref.agent_session_id,
    providerSession: { sessionId: "thread-async", resumable: true }
  };
  const snapshot = {
    schema: "octo.async-question-reply/v1",
    ref,
    question,
    providerSession: next.providerSession,
    completed: false,
    phase: "pending"
  };
  const handle = new AsyncQuestionReply(f.client, snapshot, () => next);
  return { ...f, ref, request, next, handle, snapshot };
}
async function complete(f) {
  const frames = [];
  for await (const frame of f.client.subscribe(f.ref)) {
    frames.push(frame);
    f.handle.observe(frame);
  }
  assert.equal(f.handle.snapshot().completed, true);
  return frames;
}
test("async cancellation waits for ACK and blocks competing submissions", async (t) => {
  const f = await setup(t);
  const ack = Promise.withResolvers();
  let calls = 0;
  const reply = new AsyncQuestionReply(
    {
      respond: () => {
        calls++;
        return ack.promise;
      }
    },
    f.snapshot,
    () => f.next
  );
  const cancelling = reply.cancel();
  assert.equal(reply.snapshot().phase, "submitting");
  await assert.rejects(reply.cancel(), { code: "INTERACTION_NOT_ACTIVE" });
  await assert.rejects(reply.respond(value), { code: "INTERACTION_NOT_ACTIVE" });
  assert.equal(calls, 1);
  ack.resolve();
  await cancelling;
  assert.equal(reply.snapshot().phase, "cancelled");
});
test("lost cancellation ACK stays unknown after restore and cannot replay", async (t) => {
  const f = await setup(t);
  let calls = 0;
  const client = {
    respond: async () => {
      calls++;
      throw new KernelError("OPERATION_OUTCOME_UNKNOWN");
    }
  };
  const reply = new AsyncQuestionReply(client, f.snapshot, () => f.next);
  await assert.rejects(reply.cancel(), { code: "OPERATION_OUTCOME_UNKNOWN" });
  assert.equal(reply.snapshot().phase, "unknown");
  const restored = new AsyncQuestionReply(client, reply.snapshot(), () => f.next);
  await assert.rejects(restored.cancel(), { code: "INTERACTION_NOT_ACTIVE" });
  await assert.rejects(restored.respond(value), { code: "INTERACTION_NOT_ACTIVE" });
  assert.equal(calls, 1);
});
test("inactive cancellation is invalidated; completed cancellation needs no RPC", async (t) => {
  const f = await setup(t);
  let calls = 0;
  const client = {
    respond: async () => {
      calls++;
      throw new KernelError("INTERACTION_NOT_ACTIVE");
    }
  };
  const inactive = new AsyncQuestionReply(client, f.snapshot, () => f.next);
  await inactive.cancel();
  assert.equal(inactive.snapshot().phase, "invalidated");
  const completed = new AsyncQuestionReply(
    client,
    { ...f.snapshot, completed: true },
    () => f.next
  );
  await completed.cancel();
  assert.equal(completed.snapshot().phase, "cancelled");
  assert.equal(calls, 1);
});
test("observed cancellation survives a lost ACK", async (t) => {
  // 保持 turn 活跃，避免默认 stale 场景的 20ms 完成定时器先关闭交互。
  const f = await setup(t, "normal");
  const ack = Promise.withResolvers();
  const reply = new AsyncQuestionReply({ respond: () => ack.promise }, f.snapshot, () => f.next);
  const cancelling = reply.cancel();
  const rejected = assert.rejects(cancelling, { code: "OPERATION_OUTCOME_UNKNOWN" });
  await f.client.respond(f.ref, {
    interactionId: f.snapshot.question.interactionId,
    outcome: "cancelled"
  });
  for await (const frame of f.client.subscribe(f.ref)) {
    reply.observe(frame);
    if (frame.event?.type === "interaction.resolved") break;
  }
  assert.equal(reply.snapshot().phase, "cancelled");
  ack.reject(new KernelError("OPERATION_OUTCOME_UNKNOWN"));
  await rejected;
  assert.equal(reply.snapshot().phase, "cancelled");
});
test(
  "async final_answer survives more than the finalization deadline without answering",
  { timeout: 10000 },
  async (t) => {
    const f = await setup(t, "long-gap");
    const frames = await complete(f);
    assert.ok(frames.some((frame) => frame.event?.payload.text === "gap-finished"));
    assert.equal(
      frames.some((frame) => frame.event?.payload.code === "CODEX_FINALIZATION_TIMEOUT"),
      false
    );
    assert.equal(
      frames.some((frame) => frame.event?.type === "interaction.resolved"),
      false
    );
    assert.equal(f.snapshot.question.expiresAt, undefined);
    assertCanonicalEvent({
      protocolVersion: 2,
      type: "interaction.requested",
      payload: f.snapshot.question
    });
    assert.throws(() =>
      assertCanonicalEvent({
        protocolVersion: 2,
        type: "interaction.requested",
        payload: { ...f.snapshot.question, delivery: undefined }
      })
    );
  }
);
test(
  "active supplement steers; same handle rejects a second submission",
  { timeout: 10000 },
  async (t) => {
    const f = await setup(t, "normal");
    const first = f.handle.respond(value);
    await assert.rejects(f.handle.respond(value), (e) => e.code === "INTERACTION_NOT_ACTIVE");
    assert.deepEqual(await first, { route: "steer", acceptance: "provider_accepted" });
    await complete(f);
    await assert.rejects(f.handle.respond(value), (e) => e.code === "INTERACTION_NOT_ACTIVE");
  }
);
test(
  "completed question starts a new Run in the original session and preserves the original terminal",
  { timeout: 10000 },
  async (t) => {
    const f = await setup(t);
    await complete(f);
    const result = await f.handle.respond(value);
    assert.equal(result.route, "new_run");
    assert.notEqual(result.input.runId, f.ref.run_id);
    assert.notEqual(result.input.invocationId, f.ref.invocation_id);
    assert.equal(result.input.sessionId, f.ref.agent_session_id);
    assert.equal(result.input.providerSession.requireResume, true);
    assert.equal(f.handle.snapshot().phase, "submitting");
    const events = [];
    for await (const event of result.events) events.push(event);
    assert.ok(
      events.some(
        (e) => e.type === "session.update" && e.payload.providerSession.resumeOutcome === "resumed"
      )
    );
    assert.ok(
      events.some(
        (e) => e.type === "message.update" && e.payload.text?.includes("custom supplement")
      )
    );
    assert.equal(events.at(-1).type, "run.completed");
    assert.equal(f.handle.snapshot().phase, "answered");
    assert.equal((await f.client.get(f.ref)).terminal.control.state, "completed");
  }
);
test(
  "host-persisted completed snapshot can supplement after Kernel restart",
  { timeout: 15000 },
  async (t) => {
    const f = await setup(t);
    await complete(f);
    const saved = JSON.parse(JSON.stringify(f.handle.snapshot()));
    assert.equal((await f.server.close()).complete, true);
    const server = createKernelService({ home: f.directory, endpoint: f.endpoint, ...options });
    t.after(() => server.close());
    await server.initialize();
    const client = attachKernel({ endpoint: f.endpoint });
    t.after(() => client.close());
    const handle = new AsyncQuestionReply(client, saved, () => f.next);
    const result = await handle.respond(value);
    assert.equal(result.route, "new_run");
    for await (const event of result.events) void event;
    assert.equal(handle.snapshot().phase, "answered");
  }
);
test(
  "invalid answers, stale generation, explicit expiry and cancelled forms do not invoke",
  { timeout: 10000 },
  async (t) => {
    const f = await setup(t);
    await complete(f);
    await assert.rejects(
      f.handle.respond({ ...value, answers: [value.answers[0]] }),
      (e) => e.code === "INVALID_QUESTION_RESPONSE"
    );
    assert.equal(f.handle.snapshot().phase, "pending");
    f.next.sessionGeneration = f.ref.session_generation + 1;
    await assert.rejects(f.handle.respond(value), (e) => e.code === "ASYNC_QUESTION_SESSION_STALE");
    delete f.next.sessionGeneration;
    const expired = f.handle.snapshot();
    expired.question.expiresAt = new Date(Date.now() - 100).toISOString();
    await assert.rejects(
      new AsyncQuestionReply(f.client, expired, () => f.next).respond(value),
      (e) => e.code === "INTERACTION_NOT_ACTIVE"
    );
    await f.handle.cancel();
    await assert.rejects(f.handle.respond(value), (e) => e.code === "INTERACTION_NOT_ACTIVE");
  }
);
test(
  "unknown steer delivery never starts a new Run or becomes retryable",
  { timeout: 10000 },
  async (t) => {
    const f = await setup(t, "lost");
    await assert.rejects(f.handle.respond(value), (e) => e.code === "OPERATION_OUTCOME_UNKNOWN");
    assert.equal(f.handle.snapshot().phase, "unknown");
    await assert.rejects(f.handle.respond(value), (e) => e.code === "INTERACTION_NOT_ACTIVE");
  }
);
test("missing original execution is not evidence of completion", { timeout: 10000 }, async (t) => {
  const f = await setup(t);
  const client = {
    ...f.client,
    get: async () => {
      throw new KernelError("RUN_NOT_FOUND");
    }
  };
  const handle = new AsyncQuestionReply(client, f.snapshot, () => f.next);
  await assert.rejects(handle.respond(value), (e) => e.code === "RUN_NOT_FOUND");
  assert.equal(handle.snapshot().phase, "pending");
  for (const phase of ["submitting", "unknown", "answered", "cancelled", "invalidated"]) {
    const restored = new AsyncQuestionReply(client, { ...f.snapshot, phase }, () => f.next);
    await assert.rejects(restored.respond(value), (e) => e.code === "INTERACTION_NOT_ACTIVE");
  }
});
for (const change of ["expiry", "generation"])
  test(`lazy continuation rechecks ${change} before invoke`, { timeout: 10000 }, async (t) => {
    const f = await setup(t);
    await complete(f);
    const saved = f.handle.snapshot();
    if (change === "expiry") saved.question.expiresAt = new Date(Date.now() + 200).toISOString();
    const handle = new AsyncQuestionReply(f.client, saved, () => f.next);
    const result = await handle.respond(value);
    if (change === "expiry") await new Promise((resolve) => setTimeout(resolve, 250));
    else f.next.sessionGeneration = f.ref.session_generation + 1;
    await assert.rejects(result.events.next(), (e) =>
      ["INTERACTION_NOT_ACTIVE", "ASYNC_QUESTION_SESSION_STALE"].includes(e.code)
    );
  });
for (const sessionId of ["resume-reject", "resume-turn-reject"])
  test(
    `required resume never starts a fresh provider session: ${sessionId}`,
    { timeout: 10000 },
    async (t) => {
      const f = await setup(t);
      await complete(f);
      const saved = f.handle.snapshot();
      saved.providerSession = { sessionId, resumable: true };
      const reply = new AsyncQuestionReply(f.client, saved, () => ({
        ...f.next,
        providerSession: saved.providerSession
      }));
      const result = await reply.respond(value);
      const events = [];
      for await (const event of result.events) events.push(event);
      assert.ok(events.some((e) => e.type === "run.failed"));
      assert.equal(
        events.some(
          (e) =>
            e.type === "session.update" &&
            e.payload.providerSession.resumeOutcome === "fresh_fallback"
        ),
        false
      );
      assert.equal(reply.snapshot().phase, "unknown");
    }
  );
