import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import adapter from "./fixtures/codex-async-adapter.mjs";
import { attachKernel, createKernelService } from "../../dist/public/executor-kernel.js";
import { invocationInput } from "../../packages/octo-runtime-protocol/dist/index.js";
import { kernelFixture } from "../kernel-fixture.js";
import { invokeRequest } from "../runtime-fixture.js";

// 测试宿主直接注入原生 Adapter；重建 Kernel 时仍使用同一 fake Provider。
const options = { adapters: [adapter] };
const input = (extra = {}) =>
  invocationInput(
    invokeRequest({
      runId: randomUUID(),
      invocationId: randomUUID(),
      prompt: "normal",
      modelInput: "normal",
      ...extra
    }),
    "canonical",
    "codex"
  );
const answer = (id) => ({
  interactionId: id,
  outcome: "answered",
  value: {
    schema: "octo.question-response/v1",
    answers: [
      { questionId: "q:0", text: "Red" },
      { questionId: "q:1", text: "custom" }
    ]
  }
});
async function question(client, ref) {
  for await (const frame of client.subscribe(ref))
    if (frame.event?.type === "interaction.requested") return frame.event.payload;
  assert.fail("missing question");
}

test(
  "same live RunRef replays the form after reconnect; resume cannot answer the old batch",
  { timeout: 15000 },
  async (t) => {
    const f = await kernelFixture(t, options);
    const { ref } = await f.client.submit(input());
    const q = await question(f.client, ref);
    f.client.close();
    const client = attachKernel({ endpoint: f.endpoint });
    t.after(() => client.close());
    const replay = await question(client, ref);
    assert.equal(replay.interactionId, q.interactionId);
    await client.respond(ref, answer(q.interactionId));
    const events = [];
    for await (const frame of client.subscribe(ref)) events.push(frame);
    assert.equal(events.filter((e) => e.event?.type === "interaction.resolved").length, 1);
    await assert.rejects(
      client.respond(ref, answer(q.interactionId)),
      (e) => e.code === "INTERACTION_NOT_ACTIVE"
    );
    const resumed = await client.submit(input({ providerSession: { sessionId: "thread-async" } }));
    const next = await question(client, resumed.ref);
    assert.notEqual(next.interactionId, q.interactionId);
    await assert.rejects(
      client.respond(resumed.ref, answer(q.interactionId)),
      (e) => e.code === "INTERACTION_NOT_ACTIVE"
    );
    await client.respond(resumed.ref, answer(next.interactionId));
    for await (const frame of client.subscribe(resumed.ref)) void frame;
  }
);

test(
  "Kernel reconstruction rejects the original question reference",
  { timeout: 15000 },
  async (t) => {
    const f = await kernelFixture(t, options);
    const { ref } = await f.client.submit(input());
    const q = await question(f.client, ref);
    assert.equal((await f.server.close()).complete, true);
    const restarted = createKernelService({
      endpoint: f.endpoint,
      ...options
    });
    t.after(() => restarted.close());
    await restarted.initialize();
    const client = attachKernel({ endpoint: f.endpoint });
    t.after(() => client.close());
    await assert.rejects(client.respond(ref, answer(q.interactionId)), (e) =>
      /INSTANCE|STALE|NOT_FOUND|GENERATION/.test(e.code)
    );
  }
);

test(
  "Adapter rejection crosses Kernel socket with the public snake_case provider diagnostic",
  { timeout: 15000 },
  async (t) => {
    const f = await kernelFixture(t, options);
    const { ref } = await f.client.submit(input({ prompt: "reject", modelInput: "reject" }));
    const q = await question(f.client, ref);
    await assert.rejects(f.client.respond(ref, answer(q.interactionId)), (error) => {
      // Adapter 错误携带 camelCase；公开 socket 统一转为 snake_case，不能跨层对比字段名。
      assert.equal(error.code, "ASYNC_ANSWER_REJECTED");
      assert.equal(error.data.provider_rpc_code, -32602);
      assert.equal(error.data.providerRpcCode, undefined);
      return true;
    });
    const events = [];
    for await (const frame of f.client.subscribe(ref)) events.push(frame.event);
    assert.equal(
      events.find((e) => e?.type === "interaction.resolved").payload.reasonCode,
      "provider_rejected"
    );
  }
);
