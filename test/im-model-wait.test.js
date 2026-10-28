import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate as settle } from "node:timers/promises";
import { resolve } from "node:path";
import { ImModelWait } from "../packages/octo-runtime-extra-channel-gateway/dist/execution/model-wait.js";
import { ImTask } from "../packages/octo-runtime-extra-channel-gateway/dist/execution/task.js";
import { createImInvocation } from "../packages/octo-runtime-extra-channel-gateway/dist/execution/dispatcher.js";
import { buildReasoningFrame } from "../packages/octo-runtime-extra-channel-gateway/dist/transport/reasoning-frame.js";
import { ImRunProjector } from "../packages/octo-runtime-extra-channel-gateway/dist/presentation/run-projector.js";
import { kernelFixture, kernelInput } from "./kernel-fixture.js";

const event = (type, payload = {}) => ({ protocolVersion: 2, type, payload });
function clock() {
  let now = 0;
  const timers = new Set();
  return {
    timers,
    now: () => now,
    schedule(fn, ms) {
      const timer = { fn, at: now + ms };
      timers.add(timer);
      return () => timers.delete(timer);
    },
    tick(ms, late = false) {
      const end = now + ms;
      for (;;) {
        const timer = [...timers].sort((a, b) => a.at - b.at)[0];
        if (!timer || timer.at > end) break;
        now = late ? end : timer.at;
        timers.delete(timer);
        timer.fn();
      }
      now = end;
    },
    random: () => 0,
    wait: async () => {}
  };
}
function fixture() {
  const time = clock(),
    updates = [];
  let timeouts = 0;
  const wait = new ImModelWait(
    time,
    () => updates.push(wait.snapshot),
    () => timeouts++
  );
  wait.start();
  return { wait, time, updates, timeouts: () => timeouts };
}
const delta = (text = "output", extra = {}) =>
  event("message.delta", { messageId: "answer", channel: "final", text, ...extra });

test("model silence updates every 30s and times out once at 300s, including delayed timers", () => {
  const f = fixture();
  f.time.tick(29_999);
  assert.equal(f.updates.length, 0);
  f.time.tick(1);
  assert.equal(f.wait.snapshot.seconds, 30);
  f.time.tick(30_000);
  assert.equal(f.wait.snapshot.seconds, 60);
  f.time.tick(239_999);
  assert.equal(f.timeouts(), 0);
  f.time.tick(1);
  assert.equal(f.timeouts(), 1);
  assert.equal(f.wait.snapshot.timeout, "cancelling");
  f.time.tick(10_000);
  assert.equal(f.wait.snapshot.timeout, "unconfirmed");
  f.wait.confirmTermination();
  assert.equal(f.wait.snapshot.timeout, "terminated");
  assert.equal(f.time.timers.size, 0);
  assert.deepEqual(
    f.updates.slice(0, 9).map((s) => s.seconds),
    [30, 60, 90, 120, 150, 180, 210, 240, 270]
  );
  const late = fixture();
  late.time.tick(305_000, true);
  assert.equal(late.timeouts(), 1);
  late.wait.stop();
});

for (const channel of ["final", "commentary", "analysis"]) {
  test(`${channel} content clears the notice and starts a fresh continuous interval`, () => {
    const f = fixture();
    f.time.tick(60_000);
    f.wait.accept(
      delta("new", { channel, ...(channel === "analysis" ? { exposure: "public_reasoning" } : {}) })
    );
    assert.equal(f.wait.snapshot.seconds, undefined);
    assert.equal(f.wait.snapshot.hasOutput, true);
    f.time.tick(29_999);
    assert.equal(f.wait.snapshot.seconds, undefined);
    f.time.tick(1);
    assert.equal(f.wait.snapshot.seconds, 30);
    f.wait.stop();
    assert.equal(f.time.timers.size, 0);
  });
}

test("ACKs, heartbeats, empty/private/user text and repeated snapshots cannot renew silence", () => {
  const f = fixture();
  f.wait.accept(delta("answer"));
  for (let n = 0; n < 10; n++) {
    f.time.tick(29_000);
    for (const e of [
      event("run.started"),
      event("session.update"),
      event("usage.update"),
      event("activity.updated", { activityId: "thinking", info: {} }),
      event("model_step.started", { stepId: "same" }),
      delta(" "),
      delta("private", { channel: "analysis" }),
      delta("user", { role: "user" }),
      event("message.update", { messageId: "answer", channel: "final", text: "answer" })
    ])
      f.wait.accept(e);
  }
  f.time.tick(10_000);
  assert.equal(f.timeouts(), 1);
  f.wait.stop();
});

test("parallel tools and interactions pause until the last blocker closes, then start fresh", () => {
  const f = fixture();
  f.time.tick(30_000);
  for (const id of ["a", "b"])
    f.wait.accept(event("tool_call.create", { id, name: "exec", args: {}, status: "running" }));
  f.wait.accept(event("interaction.requested", { interactionId: "question" }));
  f.time.tick(900_000);
  assert.equal(f.wait.snapshot.seconds, undefined);
  f.wait.accept(event("tool_call.update", { id: "a", status: "completed" }));
  f.wait.accept(event("interaction.resolved", { interactionId: "question" }));
  f.time.tick(900_000);
  assert.equal(f.timeouts(), 0);
  f.wait.accept(event("tool_call.update", { id: "b", status: "failed" }));
  f.time.tick(30_000);
  assert.equal(f.wait.snapshot.seconds, 30);
  f.wait.stop();
});

test("message metadata follows its identity; private reasoning fragments and user echoes remain excluded", () => {
  const f = fixture();
  for (const [messageId, meta] of [
    ["private", { channel: "analysis" }],
    ["user", { role: "user", channel: "final" }]
  ]) {
    f.wait.accept(event("message.create", { messageId, ...meta }));
    f.time.tick(20_000);
    f.wait.accept(event("message.delta", { messageId, text: "not model output" }));
  }
  assert.equal(f.wait.snapshot.hasOutput, false);
  assert.equal(f.wait.snapshot.seconds, 30);
  f.wait.accept(
    event("message.create", {
      messageId: "public",
      channel: "analysis",
      exposure: "public_summary"
    })
  );
  f.wait.accept(event("message.delta", { messageId: "public", text: "public output" }));
  assert.equal(f.wait.snapshot.hasOutput, true);
  assert.equal(f.wait.snapshot.seconds, undefined);
  f.wait.stop();
});

test("Stop can retry a rejected timeout cancellation; disposal leaves no model-wait timers", async () => {
  const time = clock();
  const input = kernelInput("wait-for-cancel");
  let release,
    cancels = 0;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const task = new ImTask(
    {
      async *invoke() {
        yield event("run.started");
        await gate;
        yield event("run.cancelled");
      },
      async cancelInvocation() {
        cancels++;
        if (cancels === 1) return { accepted: false };
        release();
        return { accepted: true };
      }
    },
    input,
    "test",
    {},
    {},
    () => {},
    time
  );
  const result = (async () => {
    for await (const _event of task.events()) {
      /* 保留原流观察。 */
    }
  })();
  await settle();
  time.tick(300_000);
  await settle();
  assert.equal(task.modelWait.snapshot.timeout, "unconfirmed");
  assert.equal(await task.cancel(), true);
  await result;
  assert.equal(cancels, 2);
  assert.equal(time.timers.size, 0);
  const disposable = new ImTask(
    {
      async *invoke() {
        yield event("run.started");
      },
      async cancelInvocation() {
        return { accepted: true };
      }
    },
    input,
    "test",
    {},
    {},
    () => {},
    time
  );
  const iterator = disposable.events();
  await iterator.next();
  await iterator.return();
  assert.equal(time.timers.size, 0);
});

test("a source error after a terminal cannot confirm timeout termination", async () => {
  const time = clock();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const task = new ImTask(
    {
      async *invoke() {
        yield event("run.started");
        await gate;
        yield event("run.cancelled");
        throw new Error("SOURCE_FAILED");
      },
      async cancelInvocation() {
        release();
        return { accepted: true };
      }
    },
    kernelInput("wait-for-cancel"),
    "test",
    {},
    {},
    () => {},
    time
  );
  const result = (async () => {
    for await (const _event of task.events()) {
      /* 等待源耗尽。 */
    }
  })();
  const rejected = assert.rejects(result, /SOURCE_FAILED/);
  await settle();
  time.tick(300_000);
  await rejected;
  assert.equal(task.modelWait.snapshot.timeout, "unconfirmed");
  assert.equal(time.timers.size, 0);
});

for (const kind of ["executing_tool", "waiting_approval", "waiting_input"]) {
  test(`${kind} activity alone suspends model waiting until its matching finish`, () => {
    const f = fixture();
    f.wait.accept(
      event("activity.started", { activityId: "block", kind, subject: { type: "run" } })
    );
    f.time.tick(600_000);
    f.wait.accept(
      event("activity.started", { activityId: "work", kind: "working", subject: { type: "run" } })
    );
    f.time.tick(600_000);
    assert.equal(f.timeouts(), 0);
    f.wait.accept(event("activity.finished", { activityId: "block", status: "completed" }));
    f.time.tick(30_000);
    assert.equal(f.wait.snapshot.seconds, 30);
    f.wait.stop();
  });
}

test("queue time is excluded, stop and terminal invalidate all callbacks", () => {
  for (const stop of ["stop", "run.completed", "run.failed", "run.cancelled"]) {
    const f = fixture();
    f.wait.accept(event("run.queued"));
    f.time.tick(600_000);
    assert.equal(f.timeouts(), 0);
    f.wait.accept(
      event("activity.started", { activityId: "start", kind: "starting", subject: { type: "run" } })
    );
    f.time.tick(30_000);
    assert.equal(f.wait.snapshot.seconds, 30);
    if (stop === "stop") f.wait.stop();
    else f.wait.accept(event(stop));
    const count = f.updates.length;
    f.time.tick(600_000);
    assert.equal(f.updates.length, count);
    assert.equal(f.time.timers.size, 0);
    f.wait.accept(delta());
    assert.equal(f.time.timers.size, 0);
  }
});

test("footer uses the existing progress field, keeps Stop until confirmed and preserves late completion", () => {
  const projector = new ImRunProjector("run");
  const template = {
    ref: { id: "ai.reasoning-process", version: "0.4.0" },
    maxPayloadBytes: 16384
  };
  const frame = (modelWait, extra = {}) =>
    buildReasoningFrame({ ...projector.snapshot(), modelWait, ...extra }, template);
  const normal = frame({ hasOutput: false });
  const waiting = frame({ hasOutput: false, seconds: 30 });
  assert.match(waiting.progressText, /尚未收到模型输出.*30 秒/);
  assert.deepEqual(waiting.phases, normal.phases);
  assert.equal(
    waiting.traceExpanded,
    true,
    "footer must be visible even without a first source event"
  );
  assert.match(frame({ hasOutput: true, seconds: 60 }).progressText, /暂无新输出.*60 秒/);
  for (const timeout of ["cancelling", "unconfirmed"]) {
    const pending = frame({ hasOutput: false, timeout });
    assert.equal(pending.state, "reasoning", "active template retains reasoning_stop");
    assert.match(pending.progressText, /5 分钟/);
    assert.doesNotMatch(pending.statusLabel, /已停止/);
  }
  assert.equal(
    frame({ hasOutput: false, timeout: "terminated" }, { terminal: "cancelled" }).state,
    "error"
  );
  assert.equal(
    frame({ hasOutput: false, timeout: "unconfirmed" }, { resultUnknown: true }).state,
    "stopped"
  );
  assert.equal(
    frame({ hasOutput: false, timeout: "terminated" }, { terminal: "completed" }).state,
    "completed"
  );
});

for (const adapter of ["codex", "claude-code", "opencode"]) {
  test(`${adapter}: timeout cancels once without aborting observation or authorizing replay`, async () => {
    const time = clock();
    const config = {
      bot_id: "fixture",
      api_url: "https://im-test.deepminer.com.cn/api",
      adapter: { adapter_type: adapter, workdir: process.cwd() }
    };
    const { request } = createImInvocation(
      config,
      { messageId: "m", senderId: "s", conversationId: "c", text: "wait" },
      { schema: "octo.context-envelope/v3", items: [] },
      "key",
      { id: "session", generation: 1 },
      new AbortController().signal
    );
    let release,
      calls = 0,
      cancels = 0,
      observation;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const task = new ImTask(
      {
        async *invoke(_input, environment) {
          calls++;
          observation = environment.signal;
          yield event("run.started");
          await gate;
          yield event("run.cancelled");
        },
        async cancelInvocation() {
          cancels++;
          return { accepted: true };
        }
      },
      request,
      adapter,
      config,
      {},
      () => {},
      time
    );
    const collected = (async () => {
      const events = [];
      for await (const e of task.events()) events.push(e);
      return events;
    })();
    await settle();
    time.tick(300_000);
    assert.equal(cancels, 1);
    assert.equal(observation.aborted, false);
    time.tick(10_000);
    assert.equal(task.modelWait.snapshot.timeout, "unconfirmed");
    release();
    const events = await collected;
    assert.equal(events.at(-1).type, "run.cancelled");
    assert.equal(task.modelWait.snapshot.timeout, "terminated");
    assert.equal(calls, 1);
    assert.equal(time.timers.size, 0);
  });
}

for (const trigger of ["timeout", "IM user stop", "IM card stop"])
  test(
    `real Kernel IPC ${trigger} observes a confirmed terminal through the original stream`,
    { timeout: 10000 },
    async (t) => {
      const k = await kernelFixture(t, { manifest: resolve("test/fixtures/invoke-adapters.json") });
      const time = clock();
      const input = kernelInput("wait-for-cancel");
      const task = new ImTask(
        k.client,
        input,
        "test",
        { codex_retry: { enabled: false } },
        {},
        () => {},
        time
      );
      let started;
      const ready = new Promise((resolve) => {
        started = resolve;
      });
      const result = (async () => {
        const events = [];
        for await (const e of task.events()) {
          events.push(e);
          if (e.type === "activity.started") started();
        }
        return events;
      })();
      await ready;
      if (trigger === "timeout") {
        time.tick(300_000);
        assert.equal(task.modelWait.snapshot.timeout, "cancelling");
      } else assert.equal(await task.cancel(trigger), true);
      const events = await result;
      assert.equal(events.at(-1).type, "run.cancelled");
      assert.equal(
        task.modelWait.snapshot.timeout,
        trigger === "timeout" ? "terminated" : undefined
      );
      assert.equal(task.attempts.length, 1);
      assert.equal(time.timers.size, 0);
    }
  );
