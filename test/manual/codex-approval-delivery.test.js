import test from "node:test";
import assert from "node:assert/strict";
import { createScopedCodexAdapter as createCodexAdapter } from "../../test-support/scoped-codex-adapter.mjs";
import {
  classifyFailure,
  assertHostControl
} from "../../packages/octo-runtime-protocol/dist/index.js";
import { invokeRequest } from "../runtime-fixture.js";
import { withAgentEnvItems } from "../../packages/octo-runtime-adapter-sdk/dist/index.js";
import { approvalFixture, until } from "./codex-approval-fixture.js";

async function running(t, mode, approvalMode, options) {
  const fixture = approvalFixture(options);
  const adapter = createCodexAdapter({
    command: "fixture",
    spawnFn: () => fixture.child
  });
  const controller = new AbortController();
  const request = invokeRequest({
    signal: controller.signal,
    agentEnv: withAgentEnvItems(undefined, [
      { namespace: "octo.security", name: "approval_policy", payload: { mode: approvalMode } }
    ])
  });
  const events = [];
  let error;
  const source = adapter.invoke(request, {
    protocolMode: mode,
    streamLimits: options?.streamLimits
  });
  const done = (async () => {
    try {
      for await (const event of source) events.push(event);
    } catch (cause) {
      error = cause;
    }
  })();
  t.after(async () => {
    fixture.release();
    fixture.close();
    await done;
    await adapter.close({ deadline: performance.now() + 2500 });
  });
  await until(() => fixture.started, "turn start");
  const pending = () =>
    events.filter((e) =>
      mode === "native"
        ? e.control?.type === "interaction" && e.control.status === "pending"
        : e.type === "interaction.requested"
    );
  const resolved = () =>
    events.filter((e) =>
      mode === "native"
        ? e.control?.type === "interaction" && e.control.status === "resolved"
        : e.type === "interaction.resolved" && e.payload.status === "resolved"
    );
  const respond = (event) =>
    mode === "native"
      ? adapter.respondNative(request.invocationId, {
          requestId: event.control.requestId,
          payload: { jsonrpc: "2.0", id: event.control.requestId, result: { decision: "accept" } }
        })
      : adapter.respondInteraction(request.invocationId, {
          interactionId: event.payload.interactionId,
          outcome: "accepted"
        });
  const complete = async () => {
    fixture.complete();
    await done;
    assert.equal(error, undefined);
    assert.equal(
      mode === "native" ? events.at(-1).control?.state : events.at(-1).type,
      mode === "native" ? "completed" : "run.completed"
    );
  };
  return {
    fixture,
    controller,
    adapter,
    request,
    events,
    pending,
    resolved,
    respond,
    complete,
    done,
    get error() {
      return error;
    }
  };
}
for (const mode of ["canonical", "native"]) {
  for (const count of [32, 100, 256, 512]) {
    test(
      `${mode}: ${count} automatic approvals bypass human quota with delayed writes`,
      { timeout: 5000 },
      async (t) => {
        const r = await running(t, mode, "full_access", { hold: true, highWaterMark: 1 });
        // 服务 writer 有独立的 128 条容量；分批制造背压，验证总审批数不占人工配额。
        for (let start = 0; start < count; start += 64) {
          const end = Math.min(count, start + 64);
          r.fixture.hold();
          for (let i = start; i < end; i++) r.fixture.request(`id-${i}`);
          await until(() => r.pending().length === end, "batch admitted");
          assert.equal(r.resolved().length, start);
          r.fixture.release();
          await until(() => r.resolved().length === end, "batch written");
        }
        assert.ok(r.pending().every((e) => (e.control ?? e.payload).responseRequired === false));
        r.fixture.release();
        await until(() => r.resolved().length === count, "all written");
        assert.equal(r.fixture.responses.length, count);
        assert.equal(new Set(r.fixture.responses.map((e) => e.id)).size, count);
        await r.complete();
      }
    );
  }
  for (const approvalMode of ["ask", "assisted"]) {
    test(
      `${mode}/${approvalMode}: 256 human slots, 257 rejection, decision releases slot before write`,
      { timeout: 5000 },
      async (t) => {
        const r = await running(t, mode, approvalMode);
        for (let i = 0; i < 257; i++) r.fixture.request(`id-${i}`);
        await until(() => r.fixture.responses.length === 1, "capacity rejection");
        assert.equal(r.pending().length, 256);
        assert.equal(r.fixture.responses[0].error.message, "APPROVAL_PENDING_LIMIT_EXCEEDED");
        const promise = r.respond(r.pending()[0]);
        await assert.rejects(r.respond(r.pending()[0]));
        r.fixture.request("replacement");
        await until(() => r.pending().length === 257, "replacement admitted");
        await promise;
        await r.complete();
      }
    );
  }
  for (const approvalMode of ["ask", "assisted"]) {
    test(
      `${mode}/${approvalMode}: 512 human requests drain capacity rejections without aborting admitted approvals`,
      { timeout: 5000 },
      async (t) => {
        const r = await running(t, mode, approvalMode, { hold: true, highWaterMark: 1 });
        for (let i = 0; i < 257; i++) r.fixture.request(`id-${i}`);
        await until(() => r.pending().length === 256 && r.fixture.responses.length === 1);
        assert.equal(r.error, undefined);
        r.fixture.release();
        for (let i = 257; i < 512; i++) {
          r.fixture.request(`id-${i}`);
          await until(() => r.fixture.responses.length === i - 255);
        }
        await until(() => r.fixture.responses.length === 256);
        assert.ok(
          r.fixture.responses.every(
            (reply) => reply.error?.message === "APPROVAL_PENDING_LIMIT_EXCEEDED"
          )
        );
        for (const event of r.pending()) await r.respond(event);
        await until(() => r.resolved().length === 256);
        assert.equal(r.fixture.responses.length, 512);
        assert.equal(new Set(r.fixture.responses.map((reply) => reply.id)).size, 512);
        await r.complete();
      }
    );
  }
  test(
    `${mode}: manual slot is released while actual response callback is blocked`,
    { timeout: 5000 },
    async (t) => {
      const r = await running(t, mode, "ask", { hold: true });
      for (let i = 0; i < 256; i++) r.fixture.request(`id-${i}`);
      await until(() => r.pending().length === 256);
      let settled = false;
      const response = r.respond(r.pending()[0]).then(() => {
        settled = true;
      });
      await assert.rejects(r.respond(r.pending()[0]));
      r.fixture.request("new");
      await until(() => r.pending().length === 257);
      assert.equal(settled, false);
      assert.equal(r.resolved().length, 0);
      r.fixture.release();
      await response;
      await r.complete();
    }
  );
  test(
    `${mode}: terminal cancels queued approvals before a late callback`,
    { timeout: 5000 },
    async (t) => {
      const r = await running(t, mode, "full_access", { hold: true });
      for (let i = 0; i < 32; i++) r.fixture.request(`id-${i}`);
      await until(() => r.fixture.responses.length === 1 && r.pending().length === 32);
      r.fixture.complete();
      await until(() => r.events.some((e) => (e.control ?? e.payload)?.status === "invalidated"));
      r.fixture.release();
      await r.done;
      assert.equal(r.fixture.responses.length, 1);
      assert.equal(r.resolved().length, 0);
    }
  );
  for (const termination of ["cancel", "exit"]) {
    test(
      `${mode}: ${termination} invalidates blocked and queued responses once`,
      { timeout: 5000 },
      async (t) => {
        const r = await running(t, mode, "ask", { hold: true });
        for (let i = 0; i < 32; i++) r.fixture.request(`id-${i}`);
        await until(() => r.pending().length === 32);
        const responses = r.pending().map((event) => r.respond(event));
        const settled = Promise.allSettled(responses);
        await until(() => r.fixture.responses.length === 1);
        if (termination === "cancel") r.controller.abort("test_cancel");
        else r.fixture.close(1);
        await until(
          () =>
            r.events.filter((e) => (e.control ?? e.payload)?.status === "invalidated").length === 32
        );
        r.fixture.release();
        await r.done;
        assert.ok((await settled).every((entry) => entry.status === "rejected"));
        assert.equal(r.fixture.responses.length, 1);
        assert.equal(r.resolved().length, 0);
        assert.equal(
          r.events.filter((e) => (e.control ?? e.payload)?.status === "invalidated").length,
          32
        );
      }
    );
  }
  test(
    `${mode}: retained params budget is released after a decision`,
    { timeout: 5000 },
    async (t) => {
      const r = await running(t, mode, "ask", {
        streamLimits: {
          rawMessageMaxBytes: 8192,
          adapterQueueItemMaxBytes: 8192,
          adapterQueueMaxBytes: 8192
        }
      });
      const extra = { diagnostic: "x".repeat(5000) };
      r.fixture.request("first", undefined, extra);
      await until(() => r.pending().length === 1);
      await r.respond(r.pending()[0]);
      r.fixture.request("second", undefined, extra);
      await until(() => r.pending().length === 2);
      r.fixture.request("overflow", undefined, extra);
      await r.done;
      if (mode === "native") assert.equal(r.error?.code, "CODEX_INTERACTION_BYTES_EXCEEDED");
      else
        assert.equal(
          r.events.find((e) => e.type === "run.failed")?.payload.code,
          "CODEX_INTERACTION_BYTES_EXCEEDED"
        );
    }
  );
  test(
    `${mode}: full_access still asks questions and elicitations`,
    { timeout: 5000 },
    async (t) => {
      const r = await running(t, mode, "full_access");
      r.fixture.request("question", "item/tool/requestUserInput", {
        questions: [
          { id: "q", question: "Choose", options: [{ label: "one", description: "first" }] }
        ]
      });
      r.fixture.request("elicitation", "mcpServer/elicitation/request", {
        message: "Input",
        requestedSchema: { type: "object" }
      });
      for (let i = 0; i < 32; i++) r.fixture.request(`auto-${i}`);
      await until(() => r.resolved().length === 32);
      assert.equal(
        r.pending().filter((e) => (e.control ?? e.payload).responseRequired === true).length,
        2
      );
      assert.equal(r.fixture.responses.length, 32);
      await r.complete();
    }
  );
}
for (const reason of [
  "APPROVAL_PENDING_LIMIT_EXCEEDED",
  "CODEX_INTERACTION_BYTES_EXCEEDED",
  "INTERACTION_PENDING_LIMIT_EXCEEDED",
  "CODEX_STDIN_QUEUE_ITEMS_EXCEEDED",
  "CODEX_STDIN_QUEUE_BYTES_EXCEEDED",
  "CODEX_STDIN_WRITE_FAILED",
  "CODEX_TRANSPORT_FAILED",
  "CODEX_STDIN_STALLED",
  "CODEX_STDIN_DELIVERY_TIMEOUT"
]) {
  test(`local cause ${reason} outranks unrelated plugin Unauthorized`, () => {
    const failure = classifyFailure(
      { code: reason, message: `${reason}\n[codex stderr]\nplugin catalog 401 Unauthorized` },
      {
        stage: "adapter.invoke",
        defaultDomain: "provider",
        source: { component: "octo-runtime", adapter: "codex" }
      }
    );
    assert.equal(failure.reasonCode, reason);
    assert.notEqual(failure.code, "OH-PRV-4001");
    assert.equal(failure.retryable, false);
    assertHostControl({ type: "error", code: "HOST_EXECUTION_FAILED", message: reason, failure });
    assert.throws(() =>
      assertHostControl({
        type: "error",
        code: "HOST_EXECUTION_FAILED",
        message: reason,
        failure: { ...failure, params: { arbitrary: true } }
      })
    );
    assert.throws(() =>
      assertHostControl({
        type: "error",
        code: "HOST_EXECUTION_FAILED",
        message: reason,
        failure: { ...failure, source: { component: "octo-runtime", adapter: "other" } }
      })
    );
  });
}
test("actual provider authentication rejection retains classification", () => {
  assert.equal(
    classifyFailure(
      { status: 401, message: "Unauthorized" },
      { stage: "provider.invoke", defaultDomain: "provider" }
    ).code,
    "OH-PRV-4001"
  );
});

test("legacy local reason names do not alter another adapter classification", () => {
  assert.equal(
    classifyFailure(
      { code: "INTERACTION_EXPIRED", status: 401, message: "Unauthorized" },
      {
        stage: "adapter.invoke",
        defaultDomain: "provider",
        source: { component: "octo-runtime", adapter: "other" }
      }
    ).code,
    "OH-PRV-4001"
  );
});

function asyncQuestion(fixture, id) {
  fixture.send({
    method: "item/completed",
    params: {
      threadId: "thread-fixture",
      turnId: "turn-fixture",
      item: {
        id,
        type: "agentMessage",
        phase: "commentary",
        delivery: "async",
        text: "Choose?",
        questions: [{ title: "Choose?", options: ["yes", "no"] }]
      }
    }
  });
}
for (const approvalMode of ["ask", "full_access"]) {
  test(
    `canonical/${approvalMode}: async answers share the writer without consuming approval slots`,
    { timeout: 5000 },
    async (t) => {
      const r = await running(t, "canonical", approvalMode, { hold: true, highWaterMark: 1 });
      const count = approvalMode === "full_access" ? 64 : 256;
      for (let i = 0; i < count; i++) r.fixture.request(`id-${i}`);
      await until(() => r.pending().length === count);
      asyncQuestion(r.fixture, "async-question");
      await until(() => r.pending().length === count + 1);
      const question = r.pending().find((event) => event.payload.delivery === "async");
      const response = r.adapter.respondInteraction(r.request.invocationId, {
        interactionId: question.payload.interactionId,
        outcome: "answered",
        value: {
          schema: "octo.question-response/v1",
          answers: [{ questionId: "q:0", text: "yes" }]
        }
      });
      r.fixture.release();
      await response;
      await until(() =>
        r.events.some(
          (event) =>
            event.type === "interaction.resolved" &&
            event.payload.reasonCode === "provider_accepted"
        )
      );
      assert.equal(r.fixture.writes.filter((frame) => frame.method === "turn/steer").length, 1);
      await r.complete();
    }
  );
}
for (const first of ["async", "sync"]) {
  test(
    `canonical: ${first} questions share the independent 16-question limit`,
    { timeout: 5000 },
    async (t) => {
      const r = await running(t, "canonical", "full_access");
      const syncQuestion = (id) =>
        r.fixture.request(id, "item/tool/requestUserInput", {
          questions: [
            { id: "q", question: "Choose?", options: [{ label: "yes", description: "Yes" }] }
          ]
        });
      for (let i = 0; i < 16; i++) {
        if (first === "async") asyncQuestion(r.fixture, `q-${i}`);
        else syncQuestion(`q-${i}`);
      }
      await until(() => r.pending().length === 16);
      if (first === "async") syncQuestion("overflow");
      else asyncQuestion(r.fixture, "overflow");
      await r.done;
      assert.equal(
        r.events.find((event) => event.type === "run.failed")?.payload.code,
        first === "async"
          ? "CODEX_INTERACTION_PENDING_LIMIT_EXCEEDED"
          : "INTERACTION_PENDING_LIMIT_EXCEEDED"
      );
    }
  );
}

for (const reason of [
  "INVALID_ASYNC_QUESTIONS",
  "INVALID_ASYNC_QUESTION_ID",
  "ASYNC_QUESTION_CONFLICT"
]) {
  test(
    `canonical: structured async ${reason} is not a transport failure`,
    { timeout: 5000 },
    async (t) => {
      const r = await running(t, "canonical", "full_access");
      if (reason === "ASYNC_QUESTION_CONFLICT") {
        asyncQuestion(r.fixture, "same");
        await until(() => r.pending().length === 1);
      }
      r.fixture.send({
        method: "item/completed",
        params: {
          threadId: "thread-fixture",
          turnId: "turn-fixture",
          item: {
            id: reason === "INVALID_ASYNC_QUESTION_ID" ? "" : "same",
            type: "agentMessage",
            delivery: "async",
            text: "Question",
            questions:
              reason === "INVALID_ASYNC_QUESTIONS" ? "bad" : [{ title: "Changed?", options: null }]
          }
        }
      });
      await r.done;
      assert.equal(r.events.find((event) => event.type === "run.failed")?.payload.code, reason);
    }
  );
}
