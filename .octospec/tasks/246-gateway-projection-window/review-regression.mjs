// 手动 review 回归：真实归一化器、合法 canonical 事件，不调用 Provider/IM，不扩展默认 CI。
import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate as settle } from "node:timers/promises";
const root = new URL("../../../", import.meta.url);
const { ImRunProjector } = await import(
  new URL("packages/octo-runtime-extra-channel-gateway/dist/presentation/run-projector.js", root)
);
const { normalizeOpenCodeEvent } = await import(
  new URL("packages/octo-runtime-adapter-opencode/dist/index.js", root)
);
const { normalizeAcpUpdate } = await import(
  new URL("packages/octo-runtime-adapter-acp/dist/index.js", root)
);
const { assertCanonicalEvent } = await import(
  new URL("packages/octo-runtime-protocol/dist/index.js", root)
);
const event = (type, payload = {}) => ({ protocolVersion: 2, type, payload });
function accept(p, e) {
  assertCanonicalEvent(e);
  p.accept(e);
}
async function heap() {
  await settle();
  globalThis.gc();
  await settle();
  globalThis.gc();
  return process.memoryUsage().heapUsed;
}

test(
  "OpenCode completed steps release reasoning metadata without per-message completion",
  { skip: !globalThis.gc },
  async (t) => {
    const p = new ImRunProjector("opencode-completed-steps");
    t.after(() => p.dispose());
    const samples = [];
    for (let batch = 0; batch < 5; batch++) {
      for (let i = batch * 20000; i < (batch + 1) * 20000; i++) {
        const messageID = `s${i}`;
        for (const native of [
          { type: "step_start", part: { type: "step-start", messageID } },
          {
            type: "reasoning",
            part: { type: "reasoning", messageID, id: `r${i}`, text: "public reasoning" }
          },
          { type: "step_finish", part: { type: "step-finish", messageID, reason: "stop" } }
        ])
          for (const e of normalizeOpenCodeEvent(native)) accept(p, e);
      }
      samples.push(await heap());
      assert.equal(p.snapshot().items.length, 5);
    }
    t.diagnostic(`retained heap at 20k/40k/60k/80k/100k completed steps: ${samples.join(",")}`);
    assert.ok(
      samples.at(-1) - samples[0] < 4 * 1024 * 1024,
      "completed-step identities accumulated throughout the invocation"
    );
    assert.equal(p.snapshot().reasoningCount, 100000);
    assert.equal(p.snapshot().modelStepCount, 100000);
  }
);

for (const provider of ["ACP", "OpenCode"])
  test(`${provider} terminal-only tool retains identity, failure and one lifetime count`, () => {
    const p = new ImRunProjector("terminal-only", true);
    const events =
      provider === "ACP"
        ? normalizeAcpUpdate(
            {
              sessionUpdate: "tool_call",
              toolCallId: "t",
              name: "exec_command",
              rawInput: { cmd: "echo fixture" },
              status: "failed",
              rawOutput: "RAW_OUTPUT"
            },
            "fixture"
          )
        : normalizeOpenCodeEvent({
            type: "tool_use",
            part: {
              type: "tool",
              callID: "t",
              tool: "exec_command",
              state: {
                status: "error",
                input: { cmd: "echo fixture" },
                error: "RAW_OUTPUT",
                time: { start: 100, end: 150 }
              }
            }
          });
    assert.equal(events[0].type, "tool_call.update");
    for (const e of events) accept(p, e);
    const item = p.snapshot().items[0];
    assert.equal(p.snapshot().toolCallCount, 1);
    assert.equal(item.toolName, "exec_command");
    assert.equal(item.status, "failed");
    assert.equal(item.summary, "echo fixture");
    assert.equal(item.durationMs, provider === "OpenCode" ? 50 : undefined);
    for (const e of events) accept(p, e);
    assert.equal(p.snapshot().toolCallCount, 1);
    assert.doesNotMatch(JSON.stringify(p.snapshot()), /RAW_OUTPUT/);
    for (let i = 0; i < 6; i++)
      accept(
        p,
        event("message.update", { messageId: `m${i}`, channel: "commentary", text: "new" })
      );
    for (const e of events) accept(p, e);
    assert.equal(p.snapshot().toolCallCount, 1);
    assert.ok(!p.snapshot().items.some((x) => x.id === "tool:t"));
    p.dispose();
  });

for (const channel of ["commentary", "analysis"])
  test(`completed ${channel} identity cannot revive after 400 retirements`, () => {
    const p = new ImRunProjector("completed-rollover");
    const exposure =
      channel === "analysis"
        ? {
            exposure: "public_summary",
            provenance: { provider: "fixture", nativeEvent: "summary" }
          }
        : {};
    accept(p, event("model_step.started", { stepId: "s" }));
    accept(
      p,
      event("message.update", {
        messageId: "old",
        stepId: "s",
        channel,
        ...exposure,
        status: "completed",
        text: "old"
      })
    );
    for (let i = 0; i < 400; i++)
      accept(
        p,
        event("message.update", {
          messageId: `m${i}`,
          stepId: "s",
          channel: "commentary",
          text: "new",
          status: "completed"
        })
      );
    if (channel === "commentary")
      accept(p, event("message.delta", { messageId: "old", stepId: "s", text: "STALE_PROGRESS" }));
    else
      accept(
        p,
        event("message.update", {
          messageId: "old",
          stepId: "s",
          channel,
          ...exposure,
          text: "STALE_SUMMARY",
          status: "completed"
        })
      );
    accept(
      p,
      event("message.update", { messageId: "final", channel: "final", text: "ONLY_FINAL" })
    );
    accept(p, event("run.completed"));
    assert.equal(p.finalReply.text, "ONLY_FINAL");
    assert.equal(p.snapshot().reasoningCount, channel === "analysis" ? 1 : 0);
    assert.ok(!p.snapshot().items.some((x) => x.id === "message:old"));
    p.dispose();
  });

test("an evicted completed tool is counted once after 400 newer details in its unfinished step", () => {
  const p = new ImRunProjector("tool-rollover");
  accept(p, event("model_step.started", { stepId: "s" }));
  const terminal = event("tool_call.update", {
    id: "old-tool",
    stepId: "s",
    name: "read",
    args: { path: "fixture" },
    status: "failed",
    durationMs: 50
  });
  accept(p, terminal);
  for (let i = 0; i < 400; i++)
    accept(
      p,
      event("message.update", {
        messageId: `m${i}`,
        stepId: "s",
        channel: "commentary",
        text: "new"
      })
    );
  accept(p, terminal);
  assert.equal(p.snapshot().toolCallCount, 1);
  assert.ok(!p.snapshot().items.some((x) => x.id === "tool:old-tool"));
  p.dispose();
});

test("closed-step late progress stays isolated while a new OpenCode implicit final still works", () => {
  const p = new ImRunProjector("closed-step");
  for (let i = 0; i < 400; i++) {
    const messageID = `s${i}`;
    for (const native of [
      { type: "step_start", part: { type: "step-start", messageID } },
      {
        type: "reasoning",
        part: { type: "reasoning", messageID, id: `r${i}`, text: "public reasoning" }
      },
      { type: "step_finish", part: { type: "step-finish", messageID, reason: "stop" } }
    ])
      for (const e of normalizeOpenCodeEvent(native)) accept(p, e);
  }
  accept(
    p,
    event("message.delta", { messageId: "opencode:r0", stepId: "s0", text: "STALE_PROGRESS" })
  );
  accept(
    p,
    event("message.update", {
      messageId: "opencode:r0",
      stepId: "s0",
      channel: "analysis",
      exposure: "public_summary",
      provenance: { provider: "fixture", nativeEvent: "late" },
      text: "STALE_SUMMARY"
    })
  );
  for (const native of [
    { type: "step_start", part: { type: "step-start", messageID: "answer-step" } },
    {
      type: "text",
      part: { type: "text", messageID: "answer-step", id: "answer", text: "ONLY_FINAL" }
    },
    { type: "step_finish", part: { type: "step-finish", messageID: "answer-step", reason: "stop" } }
  ])
    for (const e of normalizeOpenCodeEvent(native)) accept(p, e);
  accept(p, event("run.completed"));
  assert.equal(p.finalReply.text, "ONLY_FINAL");
  assert.equal(p.snapshot().reasoningCount, 400);
  assert.ok(!p.snapshot().items.some((x) => x.id === "message:opencode:r0"));
  p.dispose();
});

test("explicit final promotion remains complete when later deltas omit channel", () => {
  const p = new ImRunProjector("final-promotion");
  accept(p, event("model_step.started", { stepId: "s" }));
  accept(
    p,
    event("message.update", {
      messageId: "same",
      stepId: "s",
      channel: "commentary",
      text: "PROGRESS"
    })
  );
  accept(
    p,
    event("message.update", { messageId: "same", stepId: "s", channel: "final", text: "FINAL" })
  );
  accept(p, event("model_step.finished", { stepId: "s", status: "completed" }));
  accept(p, event("message.delta", { messageId: "same", stepId: "s", text: "_TAIL" }));
  accept(p, event("run.completed"));
  assert.equal(p.finalReply.text, "FINAL_TAIL");
  p.dispose();
});
