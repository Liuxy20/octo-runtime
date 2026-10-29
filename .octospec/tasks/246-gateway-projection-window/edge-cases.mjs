// 扩展专项，手动执行，不扩展 CI。先覆盖长并发消息跨越退役身份窗口的情况。
import test from "node:test";
import assert from "node:assert/strict";
const root = new URL("../../../", import.meta.url);
const { ImRunProjector } = await import(
  new URL("packages/octo-runtime-extra-channel-gateway/dist/presentation/run-projector.js", root)
);
const { ProgressScheduler } = await import(
  new URL("packages/octo-runtime-extra-channel-gateway/dist/delivery/scheduler.js", root)
);
const { setImmediate: settle } = await import("node:timers/promises");
const event = (type, payload = {}) => ({ protocolVersion: 2, type, payload });

function passRetiredWindow(p) {
  for (let i = 0; i < 400; i++)
    p.accept(
      event("message.update", {
        messageId: `progress-${i}`,
        channel: "commentary",
        text: "new progress"
      })
    );
}

test("an evicted but still-streaming message cannot become final when a late delta omits channel", () => {
  const p = new ImRunProjector("late-active");
  p.accept(event("message.create", { messageId: "long", channel: "commentary" }));
  p.accept(event("message.delta", { messageId: "long", channel: "commentary", text: "progress" }));
  passRetiredWindow(p);
  p.accept(event("message.delta", { messageId: "long", text: "PRIVATE_PROGRESS_TAIL" }));
  p.accept(event("message.update", { messageId: "long", text: "COMPLETE_PROGRESS" }));
  p.accept(event("message.update", { messageId: "answer", channel: "final", text: "ONLY_FINAL" }));
  p.accept(event("run.completed"));
  assert.equal(p.finalReply.text, "ONLY_FINAL");
  assert.ok(!p.snapshot().items.some((item) => item.id === "message:long"));
});

test("an active public summary outside the five details is counted once even after 400 newer messages", () => {
  const p = new ImRunProjector("late-summary");
  p.accept(
    event("message.create", { messageId: "long", channel: "analysis", exposure: "public_summary" })
  );
  p.accept(
    event("message.delta", {
      messageId: "long",
      channel: "analysis",
      exposure: "public_summary",
      text: "summary"
    })
  );
  passRetiredWindow(p);
  p.accept(
    event("message.update", {
      messageId: "long",
      channel: "analysis",
      exposure: "public_summary",
      text: "COMPLETE_SUMMARY"
    })
  );
  assert.equal(p.snapshot().reasoningCount, 1);
  assert.ok(!p.snapshot().items.some((item) => item.id === "message:long"));
});

test("private in-flight reasoning never turns into a final message after its public peers are evicted", () => {
  const p = new ImRunProjector("private-active");
  p.accept(
    event("message.create", { messageId: "private", channel: "analysis", exposure: "unknown" })
  );
  passRetiredWindow(p);
  p.accept(event("message.delta", { messageId: "private", text: "PRIVATE_REASONING_TAIL" }));
  p.accept(
    event("message.update", {
      messageId: "private",
      channel: "analysis",
      exposure: "public_summary",
      text: "公开摘要"
    })
  );
  p.accept(event("message.update", { messageId: "answer", channel: "final", text: "ONLY_FINAL" }));
  p.accept(event("run.completed"));
  assert.equal(p.finalReply.text, "ONLY_FINAL");
  assert.doesNotMatch(JSON.stringify(p.snapshot()), /PRIVATE_REASONING_TAIL/);
});

test("streaming replacement snapshots retain classification after eviction until the real completion", () => {
  const p = new ImRunProjector("replacement");
  p.accept(
    event("message.update", {
      messageId: "long",
      channel: "commentary",
      status: "streaming",
      text: "ongoing"
    })
  );
  passRetiredWindow(p);
  p.accept(event("message.delta", { messageId: "long", text: "late progress" }));
  p.accept(
    event("message.update", { messageId: "long", status: "completed", text: "progress done" })
  );
  p.accept(event("message.update", { messageId: "final", channel: "final", text: "ONLY_FINAL" }));
  p.accept(event("run.completed"));
  assert.equal(p.finalReply.text, "ONLY_FINAL");
});

test("a first public summary for an old step is counted once throughout its remaining deltas", () => {
  const p = new ImRunProjector("old-step-active");
  p.accept(event("model_step.started", { stepId: "old" }));
  p.accept(
    event("message.create", {
      messageId: "long",
      stepId: "old",
      channel: "analysis",
      exposure: "private"
    })
  );
  p.accept(event("model_step.started", { stepId: "new" }));
  passRetiredWindow(p);
  for (let i = 0; i < 3; i++)
    p.accept(
      event("message.delta", {
        messageId: "long",
        channel: "analysis",
        exposure: "public_summary",
        text: "public"
      })
    );
  p.accept(
    event("message.update", {
      messageId: "long",
      channel: "analysis",
      exposure: "public_summary",
      text: "complete"
    })
  );
  assert.equal(p.snapshot().reasoningCount, 1);
  assert.ok(!p.snapshot().items.some((x) => x.id === "message:long"));
});

test("overlapping tools complete in reverse order without resurrecting 400 evicted rows", () => {
  const p = new ImRunProjector("overlap", true);
  for (let i = 0; i < 432; i++) {
    p.accept(
      event("tool_call.create", {
        id: `t${i}`,
        name: "exec_command",
        args: { cmd: "echo fixture" }
      }),
      i
    );
  }
  for (let i = 431; i >= 0; i--) {
    p.accept(
      event("tool_call.update", {
        id: `t${i}`,
        status: i % 7 ? "completed" : "failed",
        exitCode: i % 7 ? 0 : 1,
        output: "RAW_OUTPUT".repeat(4096)
      }),
      5000
    );
  }
  const s = p.snapshot();
  assert.equal(s.toolCallCount, 432);
  assert.deepEqual(
    s.items.map((x) => x.id),
    [427, 428, 429, 430, 431].map((i) => `tool:t${i}`)
  );
  for (const x of s.items) assert.equal(x.durationMs, 5000 - Number(x.id.slice(6)));
  assert.doesNotMatch(JSON.stringify(s), /RAW_OUTPUT/);
});

test("Unicode previews retain whole characters, both edges, and at most 180 code points", () => {
  const p = new ImRunProjector("unicode");
  for (const body of [
    "😀".repeat(100000),
    "头" + "😀中".repeat(100000) + "尾",
    "a".repeat(100001) + "😀".repeat(200)
  ]) {
    p.accept(event("message.update", { messageId: "unicode", channel: "commentary", text: body }));
    const preview = p.snapshot().items[0].content;
    assert.ok([...preview].length <= 180);
    assert.equal(preview.isWellFormed(), true);
    assert.ok(body.startsWith([...preview][0]));
    assert.ok(body.endsWith([...preview].at(-1)));
  }
});

test("scheduler disposal waits for owned in-flight send and drops pending/late work", async () => {
  let complete;
  const sent = [];
  const gate = new Promise((resolve) => {
    complete = resolve;
  });
  const scheduler = new ProgressScheduler(
    async (value) => {
      sent.push(value);
      await gate;
    },
    () => assert.fail("unexpected send failure"),
    1
  );
  scheduler.enqueue("first");
  let drained = false;
  const drain = scheduler.flush().then(() => {
    drained = true;
  });
  await settle();
  assert.deepEqual(sent, ["first"]);
  scheduler.enqueue("pending");
  scheduler.dispose();
  scheduler.dispose();
  scheduler.enqueue("late", true);
  await settle();
  assert.equal(drained, false);
  complete();
  await drain;
  assert.equal(drained, true);
  assert.deepEqual(sent, ["first"]);
});

test("scheduler terminal replaces queued progress and reports a real send failure once", async () => {
  const sent = [];
  let errors = 0;
  const scheduler = new ProgressScheduler(
    async (value) => {
      sent.push(value);
      throw new Error("fixture failure");
    },
    () => errors++,
    10000
  );
  scheduler.enqueue("old");
  scheduler.enqueue("final", true);
  scheduler.enqueue("late");
  await scheduler.flush();
  scheduler.dispose();
  assert.deepEqual(sent, ["final"]);
  assert.equal(errors, 1);
});

test(
  "100000 rounds have a bounded retained heap after GC, independent lifetime counts and intact final",
  { skip: !globalThis.gc },
  async (t) => {
    const p = new ImRunProjector("stress");
    const samples = [];
    const body = "公开进度😀".repeat(500);
    for (let batch = 0; batch < 5; batch++) {
      for (let i = batch * 20000; i < (batch + 1) * 20000; i++) {
        const stepId = `s${i}`;
        p.accept(event("model_step.started", { stepId }));
        p.accept(
          event("message.create", {
            messageId: `r${i}`,
            stepId,
            channel: "analysis",
            exposure: "public_summary"
          })
        );
        p.accept(
          event("message.delta", {
            messageId: `r${i}`,
            channel: "analysis",
            exposure: "public_summary",
            text: body
          })
        );
        p.accept(
          event("message.update", {
            messageId: `r${i}`,
            channel: "analysis",
            exposure: "public_summary",
            text: body
          })
        );
        p.accept(
          event("tool_call.create", {
            id: `t${i}`,
            stepId,
            name: "exec_command",
            args: { cmd: "echo fixture" }
          })
        );
        p.accept(event("tool_call.update", { id: `t${i}`, status: "completed", output: body }));
        p.accept(event("model_step.finished", { stepId, status: "completed" }));
      }
      await settle();
      globalThis.gc();
      samples.push(process.memoryUsage().heapUsed);
      assert.equal(p.snapshot().items.length, 5);
      assert.ok(p.snapshot().modelSteps.length <= 6);
    }
    const delta = samples.at(-1) - samples[0];
    t.diagnostic(
      `heap samples after 20k/40k/60k/80k/100k rounds: ${samples.join(",")}; retained delta=${delta}`
    );
    assert.ok(delta < 8 * 1024 * 1024, `retained heap grew ${delta} bytes`);
    const s = p.snapshot();
    assert.deepEqual(
      [s.reasoningCount, s.toolCallCount, s.modelStepCount],
      [100000, 100000, 100000]
    );
    p.accept(
      event("message.update", { messageId: "final", channel: "final", text: "FINAL_AFTER_100000" })
    );
    p.accept(event("run.completed"));
    assert.equal(p.finalReply.text, "FINAL_AFTER_100000");
    p.dispose();
    assert.equal(p.finalText, "");
  }
);
