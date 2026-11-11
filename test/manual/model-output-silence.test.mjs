import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import { AgentExecutor } from "../../packages/octo-runtime-executor-core/dist/index.js";
import Ajv from "ajv";
import { ModelOutputSilence } from "../../packages/octo-runtime-executor-core/dist/model-output-silence.js";
import {
  assertCanonicalEvent,
  assertHostControl
} from "../../packages/octo-runtime-protocol/dist/index.js";
import { defineAdapter } from "../../packages/octo-runtime-adapter-sdk/dist/index.js";
import { attachKernel } from "@mininglamp-oss/octo-runtime-client";
import { kernelFixture, kernelInput } from "../kernel-fixture.js";

const event = (type, payload = {}) => ({ protocolVersion: 2, type, payload });
const text = (value, extra = {}) =>
  event("message.update", {
    messageId: "m",
    role: "assistant",
    channel: "final",
    text: value,
    ...extra
  });
function fixture() {
  let now = 0,
    id = 0,
    wakes = 0;
  const timers = new Map();
  const observer = new ModelOutputSilence({
    now: () => now,
    schedule(callback, delay) {
      const key = ++id;
      timers.set(key, { at: now + delay, callback });
      return () => timers.delete(key);
    }
  });
  let detach = observer.listen(() => wakes++);
  return {
    observer,
    timers,
    wakes: () => wakes,
    tick(ms) {
      const end = now + ms;
      while (true) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        now = next[1].at;
        timers.delete(next[0]);
        next[1].callback();
      }
      now = end;
    },
    late(ms) {
      now += ms;
    },
    listen() {
      detach();
      detach = observer.listen(() => wakes++);
    },
    detach() {
      detach();
    }
  };
}

test("one notice per silence interval; actual updates reset the full 60 seconds", () => {
  const f = fixture();
  f.tick(59_999);
  assert.equal(f.wakes(), 0);
  f.tick(1);
  const first = f.observer.take();
  assert.equal(first.payload.params.silenceMs, 60_000);
  assert.equal(first.payload.params.message, "60s no LLM output");
  assert.doesNotThrow(() => assertCanonicalEvent(first));
  f.tick(90_000);
  assert.equal(f.wakes(), 1);
  f.observer.canonical(text("hello"), true);
  f.tick(30_000);
  f.observer.canonical(event("message.update", { messageId: "m", status: "completed" }));
  f.observer.canonical(text(""));
  f.observer.canonical(text("he"));
  f.observer.canonical(text("hello"));
  f.tick(29_999);
  assert.equal(f.wakes(), 1);
  f.tick(1);
  const second = f.observer.take();
  assert.notEqual(second.payload.noticeId, first.payload.noticeId);
  assert.equal(second.payload.params.silenceMs, 60_000);
  f.observer.canonical(text("hello more"), true);
  f.tick(59_999);
  assert.equal(f.wakes(), 2);
  f.tick(1);
  assert.equal(f.wakes(), 3);
  f.observer.dispose();
  assert.equal(f.timers.size, 0);
});

test("only Core-confirmed output refreshes the clock; other events do not", () => {
  const f = fixture();
  f.tick(30_000);
  f.observer.activity({ kind: "turn_progress", method: "usage" });
  f.observer.activity({ kind: "transport_response", method: "rpc_response" });
  f.observer.canonical(event("usage.update", {}));
  f.observer.canonical(text(" "));
  f.observer.canonical(text("user", { messageId: "u", role: "user" }));
  f.observer.canonical(text("tool", { messageId: "t", role: "tool" }));
  f.observer.canonical(
    text("hidden", { messageId: "p", channel: "analysis", exposure: "private_reasoning" })
  );
  f.tick(30_000);
  assert.equal(f.wakes(), 1);
  f.observer.take();
  f.observer.canonical(
    text("visible", { messageId: "a", channel: "analysis", exposure: "public_summary" }),
    true
  );
  f.tick(59_999);
  assert.equal(f.wakes(), 1);
  f.observer.canonical(event("message.delta", { messageId: "a", text: " more" }), true);
  f.tick(59_999);
  assert.equal(f.wakes(), 1);
  f.tick(1);
  assert.equal(f.wakes(), 2);
  f.observer.dispose();
});

test("overlapping tool and interaction facts pause until the last blocker ends", () => {
  const f = fixture();
  f.tick(55_000);
  f.observer.activity({
    kind: "turn_progress",
    method: "item_lifecycle",
    toolCallId: "t",
    toolState: "started"
  });
  f.observer.canonical(
    event("activity.started", {
      activityId: "tool",
      kind: "executing_tool",
      subject: { type: "tool", id: "t" }
    })
  );
  f.observer.canonical(event("interaction.requested", { interactionId: "q" }));
  f.observer.canonical(
    event("activity.started", {
      activityId: "approval",
      kind: "waiting_approval",
      subject: { type: "interaction", id: "q" }
    })
  );
  f.tick(600_000);
  assert.equal(f.wakes(), 0);
  f.observer.canonical(event("tool_call.update", { id: "t", status: "running" }));
  f.tick(60_000);
  assert.equal(f.wakes(), 0);
  f.observer.canonical(event("tool_call.update", { id: "t", status: "completed" }));
  f.tick(60_000);
  assert.equal(f.wakes(), 0);
  f.observer.canonical(event("interaction.resolved", { interactionId: "q" }));
  f.tick(59_999);
  assert.equal(f.wakes(), 0);
  f.tick(1);
  assert.equal(f.wakes(), 1);
  f.observer.dispose();
});

test("queue pauses while asynchronous questions do not block model work", () => {
  const f = fixture();
  f.observer.canonical(event("run.queued"));
  f.tick(120_000);
  assert.equal(f.wakes(), 0);
  f.observer.canonical(event("run.started"));
  f.observer.canonical(
    event("interaction.requested", { interactionId: "async", delivery: "async" })
  );
  f.tick(60_000);
  assert.equal(f.wakes(), 1);
  f.observer.dispose();
});

test("late timers preserve queued facts across output resets; terminal and disposal clear them", () => {
  const f = fixture();
  const callback = [...f.timers.values()][0].callback;
  f.late(65_432);
  callback();
  assert.equal(f.observer.take().payload.params.silenceMs, 65_432);
  f.observer.canonical(text("resume"), true);
  f.tick(60_000);
  assert.equal(f.wakes(), 2);
  f.observer.canonical(text("resume again"), true);
  assert.equal(f.observer.take().payload.params.silenceMs, 60_000);
  f.tick(60_000);
  f.observer.canonical(event("run.completed"));
  assert.equal(f.observer.take(), undefined);
  callback();
  f.tick(600_000);
  assert.equal(f.wakes(), 3);
  assert.equal(f.timers.size, 0);
});

test("one queued fact survives interval resets without being overwritten or delaying the new interval", () => {
  const f = fixture();
  f.tick(60_000);
  f.observer.canonical(text("new output"), true);
  f.tick(90_000);
  assert.equal(f.wakes(), 1);
  assert.equal(f.timers.size, 0);
  const first = f.observer.take();
  assert.equal(first.payload.params.silenceMs, 60_000);
  f.tick(1);
  const second = f.observer.take();
  assert.notEqual(second.payload.noticeId, first.payload.noticeId);
  assert.equal(second.payload.params.silenceMs, 90_001);
  f.observer.dispose();
});

test("a tool wait pauses future intervals but does not revoke an already queued fact", () => {
  const f = fixture();
  f.tick(60_000);
  f.observer.canonical(event("tool_call.create", { id: "tool" }));
  f.tick(120_000);
  assert.equal(f.observer.take().payload.params.silenceMs, 60_000);
  assert.equal(f.timers.size, 0);
  f.observer.canonical(event("tool_call.update", { id: "tool", status: "completed" }));
  f.tick(59_999);
  assert.equal(f.wakes(), 1);
  f.tick(1);
  assert.equal(f.wakes(), 2);
  f.observer.dispose();
  assert.equal(f.observer.take(), undefined);
});

for (const delayedWake of [false, true])
  test(`queued notice precedes a racing deferred Provider result: delayedWake=${delayedWake}`, async (t) => {
    let release,
      elapsed = 0,
      fired = false,
      reads = 0;
    const listen = ModelOutputSilence.prototype.listen;
    // 只注入时钟及唤醒顺序；pending创建、源结果准备和take都执行真实实现。
    t.mock.method(ModelOutputSilence.prototype, "listen", function (wake) {
      this.time = {
        now: () => performance.now() + elapsed,
        schedule(callback) {
          if (fired) return () => {};
          const timer = setTimeout(() => {
            fired = true;
            elapsed += 60_001;
            callback();
            release({
              done: false,
              value: event("message.delta", {
                messageId: "race",
                channel: "final",
                text: "new output"
              })
            });
          }, 0);
          return () => clearTimeout(timer);
        }
      };
      return listen.call(
        this,
        delayedWake ? () => queueMicrotask(() => queueMicrotask(wake)) : wake
      );
    });
    const host = new AgentExecutor();
    host.register({
      metadata: {
        type: "test",
        protocolSupport: { protocol: "test.canonical", modes: ["canonical"], nativeMethods: [] }
      },
      invoke(_request, context) {
        context.configureRuntimeLimits({ firstFrameTimeoutMs: 10_000, runTimeoutMs: 20_000 });
        return {
          [Symbol.asyncIterator]() {
            return this;
          },
          next() {
            reads++;
            if (reads === 1) return Promise.resolve({ done: false, value: event("run.started") });
            if (reads === 2)
              return new Promise((resolve) => {
                release = resolve;
              });
            if (reads === 3) return Promise.resolve({ done: false, value: event("run.completed") });
            return Promise.resolve({ done: true });
          },
          return() {
            return Promise.resolve({ done: true });
          }
        };
      }
    });
    t.after(async () => assert.equal((await host.shutdown()).cleanup, "complete"));
    const events = [];
    for await (const frame of host.invokeFrames(kernelInput()))
      if (frame.kind === "canonical") events.push(frame.event);
    const noticeIndex = events.findIndex((e) => e.type === "run.notice");
    const outputIndex = events.findIndex((e) => e.type === "message.delta");
    assert.equal(events.filter((e) => e.type === "run.notice").length, 1);
    assert.equal(events.filter((e) => e.type === "message.delta").length, 1);
    assert.ok(noticeIndex < outputIndex);
    assert.ok(events[noticeIndex].payload.params.silenceMs >= 60_000);
    assert.equal(events.at(-1).type, "run.completed");
    assert.equal(reads, 4);
  });

test("repeated wait subscriptions stay bounded and no timer runs without a waiter", () => {
  const f = fixture();
  for (let i = 0; i < 10_000; i++) {
    f.listen();
    assert.equal(f.timers.size, 1);
  }
  f.detach();
  assert.equal(f.timers.size, 0);
  f.late(120_000);
  assert.equal(f.wakes(), 0);
  f.listen();
  // 已就绪的真实输出在 timer 之前处理，不能把消费者停顿误报为过期静默。
  f.observer.canonical(text("buffered output"), true);
  f.tick(59_999);
  assert.equal(f.wakes(), 0);
  f.tick(1);
  assert.equal(f.wakes(), 1);
  f.observer.dispose();
});

test("notice schema and semantic checks reject malformed values; native controls stay unchanged", async () => {
  const schema = JSON.parse(
    await readFile(
      new URL("../../packages/octo-runtime-protocol/schema/protocol.schema.json", import.meta.url)
    )
  );
  const ajv = new Ajv({ strict: false });
  ajv.addSchema(schema);
  const validate = ajv.compile({ $ref: `${schema.$id}#/definitions/RunNoticePayload` });
  const f = fixture();
  f.tick(60_000);
  const notice = f.observer.take();
  assert.equal(validate(notice.payload), true);
  for (const change of [
    { severity: "warning" },
    { params: { silenceMs: 59_999, message: "59s no LLM output" } },
    { params: { silenceMs: 60_000.5, message: "60s no LLM output" } },
    { params: { silenceMs: 60_000, message: "60s no LLM output", extra: true } },
    { params: { silenceMs: 60_000 } }
  ]) {
    const invalid = { ...notice, payload: { ...notice.payload, ...change } };
    assert.equal(validate(invalid.payload), false);
    assert.throws(() => assertCanonicalEvent(invalid));
  }
  assert.throws(() =>
    assertCanonicalEvent({
      ...notice,
      payload: { ...notice.payload, params: { silenceMs: 60_000, message: "90s no LLM output" } }
    })
  );
  assert.throws(() => assertHostControl({ type: "notice", payload: notice.payload }));
  f.observer.dispose();
});

test("Core shares normalized message identity and public output facts without a 256-message cutoff", async (t) => {
  const facts = [];
  const observe = ModelOutputSilence.prototype.canonical;
  t.mock.method(ModelOutputSilence.prototype, "canonical", function (value, hasOutput) {
    facts.push({ value, hasOutput });
    return observe.call(this, value, hasOutput);
  });
  const outputs = Array.from({ length: 257 }, (_, i) => text("new", { messageId: `message-${i}` }));
  outputs.push(
    event("message.create", { channel: "final", text: "first anonymous message" }),
    event("message.create", { channel: "final", text: "short" }),
    event("message.update", { channel: "final", stepId: "step-new", text: "x" }),
    text("hello", { messageId: "stable" }),
    event("message.update", { messageId: "stable", status: "completed" }),
    text("", { messageId: "stable" }),
    text("he", { messageId: "stable" }),
    text("hello", { messageId: "stable" }),
    text("hello more", { messageId: "stable" }),
    text("public", {
      messageId: "analysis",
      channel: "analysis",
      exposure: "public_summary",
      provenance: { provider: "test", nativeEvent: "text" }
    }),
    event("message.delta", { messageId: "analysis", text: "unknown exposure" }),
    event("message.delta", {
      messageId: "analysis",
      text: "public again",
      exposure: "public_summary"
    }),
    text("user text", { messageId: "user", role: "user" }),
    event("message.delta", { messageId: "user", text: " more user text" }),
    text("tool text", { messageId: "tool", role: "tool" }),
    text(" ", { messageId: "empty" })
  );
  const adapter = defineAdapter({
    metadata: { type: "test", workspace: false },
    async *invoke() {
      yield event("run.started");
      yield* outputs;
      yield event("run.completed");
    }
  });
  const fixture = await kernelFixture(t, { adapters: [adapter] });
  const { ref } = await fixture.client.submit(kernelInput());
  const frames = [];
  for await (const frame of fixture.client.subscribe(ref)) frames.push(frame);
  assert.ok(
    frames.some((frame) => frame.kind === "canonical" && frame.event.type === "run.completed"),
    JSON.stringify(frames.slice(-3))
  );
  const messages = facts.filter(({ value }) => value.type.startsWith("message."));
  assert.equal(messages.length, outputs.length);
  assert.ok(messages.slice(0, 257).every(({ hasOutput }) => hasOutput));
  assert.equal(
    new Set(messages.slice(257, 260).map(({ value }) => value.payload.messageId)).size,
    3
  );
  assert.deepEqual(
    messages.slice(257).map(({ hasOutput }) => hasOutput),
    [
      true,
      true,
      true,
      true,
      false,
      false,
      false,
      false,
      true,
      true,
      false,
      true,
      false,
      false,
      false,
      false
    ]
  );
});

for (const outcome of ["completed", "error", "missing-terminal", "invalid-event"])
  test(`source ${outcome} during notice backpressure preserves its outcome`, async (t) => {
    // 仅注入通知唤醒，不缩短产品60s阈值；实测通知后在途next与旧首帧预算的竞态。
    let emitted = false,
      taken = false,
      release,
      sourceCompleted = false;
    t.mock.method(ModelOutputSilence.prototype, "listen", (wake) => {
      if (emitted) return () => {};
      const timer = setTimeout(() => {
        emitted = true;
        wake();
      }, 5);
      return () => clearTimeout(timer);
    });
    t.mock.method(ModelOutputSilence.prototype, "take", () => {
      if (!emitted || taken) return undefined;
      taken = true;
      return event("run.notice", {
        noticeId: "injected",
        code: "model_output_idle",
        severity: "info",
        params: { silenceMs: 60_000, message: "60s no LLM output" }
      });
    });
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const host = new AgentExecutor();
    host.register(
      defineAdapter({
        metadata: { type: "test", workspace: false },
        async *invoke() {
          yield event("run.started");
          await gate;
          sourceCompleted = true;
          if (outcome === "error") throw new Error("SOURCE_FAILURE_SENTINEL");
          if (outcome === "missing-terminal") return;
          if (outcome === "invalid-event") {
            yield { protocolVersion: 0, type: "run.completed", payload: {} };
            return;
          }
          yield event("run.completed");
        }
      })
    );
    t.after(async () => {
      release();
      assert.equal(
        (await host.shutdown()).cleanup,
        outcome === "error" ? "incomplete" : "complete"
      );
    });
    const input = kernelInput("backpressure probe", {
      agentEnv: {
        schema: "octo.context-envelope/v3",
        items: [
          {
            namespace: "octo.execution",
            name: "limits",
            payload: { first_frame_timeout_ms: 100, run_timeout_ms: 10_000, cancel_grace_ms: 100 }
          }
        ]
      }
    });
    const seen = [];
    for await (const frame of host.invokeFrames(input)) {
      if (frame.kind !== "canonical") continue;
      seen.push(frame.event);
      if (frame.event.type === "run.notice") {
        release();
        await delay(200);
        assert.equal(sourceCompleted, true);
        if (outcome === "completed")
          assert.equal(host.cancel(frame.invocation_id, "late consumer cancellation"), false);
      }
    }
    assert.ok(seen.some((e) => e.type === "run.notice"));
    assert.equal(
      seen.some((e) => e.type === "run.completed"),
      outcome === "completed"
    );
    assert.equal(
      seen.some((e) => e.type === "run.cancelled"),
      false
    );
    const failure = seen.find((e) => e.type === "run.failed");
    if (outcome === "completed") assert.equal(failure, undefined);
    else {
      assert.ok(failure);
      assert.notEqual(failure.payload.code, "ADAPTER_FIRST_FRAME_TIMEOUT");
      if (outcome === "error") assert.match(failure.payload.message, /SOURCE_FAILURE_SENTINEL/);
      if (outcome === "missing-terminal")
        assert.equal(failure.payload.message, "HOST_ENDED_WITHOUT_TERMINAL");
      if (outcome === "invalid-event") assert.match(failure.payload.message, /protocolVersion/);
    }
  });

test("cancellation releases a pending Provider read and every notice listener", async (t) => {
  let activeListeners = 0,
    cleaned = false;
  const listen = ModelOutputSilence.prototype.listen;
  t.mock.method(ModelOutputSilence.prototype, "listen", function (wake) {
    activeListeners++;
    const detach = listen.call(this, wake);
    return () => {
      activeListeners--;
      detach();
    };
  });
  const adapter = defineAdapter({
    metadata: { type: "test", workspace: false },
    async *invoke(request) {
      let onAbort;
      try {
        yield event("run.started");
        await new Promise((resolve) => {
          onAbort = resolve;
          if (request.signal.aborted) resolve();
          else request.signal.addEventListener("abort", onAbort, { once: true });
        });
      } finally {
        if (onAbort) request.signal.removeEventListener("abort", onAbort);
        cleaned = true;
      }
    }
  });
  const fixture = await kernelFixture(t, { adapters: [adapter] });
  const { ref } = await fixture.client.submit(kernelInput());
  let cancelled = false;
  for await (const frame of fixture.client.subscribe(ref)) {
    if (frame.kind !== "canonical") continue;
    if (frame.event.type === "run.started")
      assert.equal((await fixture.client.cancel(ref, "silence observer cleanup")).accepted, true);
    if (frame.event.type === "run.cancelled") cancelled = true;
    assert.notEqual(frame.event.payload.code, "model_output_idle");
  }
  assert.equal(cancelled, true);
  assert.equal(cleaned, true);
  assert.equal(activeListeners, 0);
});

test("native execution never subscribes to the canonical silence observer", async (t) => {
  const listen = t.mock.method(ModelOutputSilence.prototype, "listen", () => {
    throw new Error("native must not observe canonical silence");
  });
  const adapter = defineAdapter({
    metadata: {
      type: "test",
      workspace: false,
      protocolSupport: { protocol: "test.native", modes: ["native"], nativeMethods: [] }
    },
    async *invoke() {
      yield { kind: "control", control: { type: "state", state: "completed" } };
    }
  });
  const fixture = await kernelFixture(t, { adapters: [adapter] });
  const { ref } = await fixture.client.submit({ ...kernelInput(), protocol_mode: "native" });
  let completed = false;
  for await (const frame of fixture.client.subscribe(ref)) {
    assert.notEqual(frame.kind, "canonical");
    if (
      frame.kind === "control" &&
      frame.control.type === "state" &&
      frame.control.state === "completed"
    )
      completed = true;
  }
  assert.equal(completed, true);
  assert.equal(listen.mock.callCount(), 0);
});

// 仅显式手动运行；两个真实 60 秒区间，不修改产品阈值或新增默认 CI。
test(
  "real Kernel/client delivers silence, replays the original fact, and resets after model output",
  { skip: process.env.OCTO_SILENCE_LIVE !== "1", timeout: 155_000 },
  async (t) => {
    let releaseFirst,
      releaseSecond,
      calls = 0,
      cleaned = false;
    const first = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    const second = new Promise((resolve) => {
      releaseSecond = resolve;
    });
    const adapter = defineAdapter({
      metadata: { type: "test", workspace: false },
      async *invoke(request, context) {
        calls++;
        try {
          context.reportActivity({ kind: "turn_started", method: "turn_start" });
          yield event("run.started");
          const abort = new Promise((_, reject) =>
            request.signal.addEventListener("abort", () => reject(request.signal.reason), {
              once: true
            })
          );
          await Promise.race([first, abort]);
          yield event("message.delta", { messageId: "m", channel: "final", text: "new output" });
          await Promise.race([second, abort]);
          yield event("run.completed");
        } finally {
          cleaned = true;
        }
      }
    });
    const fixture = await kernelFixture(t, { adapters: [adapter] });
    const client = attachKernel({ endpoint: fixture.endpoint });
    t.after(() => client.close());
    const input = kernelInput("silence probe", {
      agentEnv: {
        schema: "octo.context-envelope/v3",
        items: [
          {
            namespace: "octo.execution",
            name: "limits",
            payload: {
              first_frame_timeout_ms: 150_000,
              model_idle_policy: "observe",
              run_timeout_ms: 150_000
            }
          }
        ]
      }
    });
    const { ref } = await client.submit(input);
    t.after(() => {
      releaseFirst();
      releaseSecond();
    });
    const notices = [];
    let sawOutput = false,
      completed = false,
      previousSeq = 0;
    for await (const frame of client.subscribe(ref)) {
      assert.equal(frame.seq, previousSeq + 1);
      previousSeq = frame.seq;
      if (frame.kind !== "canonical") continue;
      const e = frame.event;
      if (e.type === "message.delta") sawOutput = true;
      if (e.type === "run.notice" && e.payload.code === "model_output_idle") {
        notices.push(e);
        assert.ok(e.payload.params.silenceMs >= 60_000);
        assert.equal(calls, 1);
        if (notices.length === 1) {
          const replay = client.subscribe(ref, frame.seq - 1)[Symbol.asyncIterator]();
          try {
            assert.deepEqual((await replay.next()).value, frame);
          } finally {
            await replay.return();
          }
          releaseFirst();
        } else {
          assert.equal(sawOutput, true);
          assert.notEqual(e.payload.noticeId, notices[0].payload.noticeId);
          releaseSecond();
        }
      }
      if (e.type === "run.completed") completed = true;
    }
    assert.equal(notices.length, 2);
    assert.equal(completed, true);
    assert.equal(cleaned, true);
  }
);
