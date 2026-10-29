// 手动隐私回归；合法 canonical 事件，原生归一化器输入均为合成数据，不扩展 CI。
import test from "node:test";
import assert from "node:assert/strict";
const root = new URL("../../../", import.meta.url);
const { ImRunProjector } = await import(
  new URL("packages/octo-runtime-extra-channel-gateway/dist/presentation/run-projector.js", root)
);
const { assertCanonicalEvent } = await import(
  new URL("packages/octo-runtime-protocol/dist/index.js", root)
);
const { normalizeOpenCodeEvent, OpenCodeEventNormalizer } = await import(
  new URL("packages/octo-runtime-adapter-opencode/dist/index.js", root)
);
const { normalizeAcpUpdate } = await import(
  new URL("packages/octo-runtime-adapter-acp/dist/index.js", root)
);
const { AcpTurnNormalizer } = await import(
  new URL("packages/octo-runtime-adapter-sdk/dist/index.js", root)
);
const event = (type, payload = {}) => ({ protocolVersion: 2, type, payload });
function accept(p, e) {
  assertCanonicalEvent(e);
  p.accept(e);
}
function advance(p) {
  accept(p, event("model_step.finished", { stepId: "s1", status: "completed" }));
  accept(p, event("model_step.started", { stepId: "s2" }));
  for (let i = 0; i < 400; i++)
    accept(
      p,
      event("message.update", {
        messageId: `new-${i}`,
        stepId: "s2",
        channel: "commentary",
        text: "new",
        status: "completed"
      })
    );
}
for (const kind of ["private_reasoning", "commentary", "tool"])
  test(`closed ${kind} identity cannot leak or reappear when both scope fields are omitted`, () => {
    const p = new ImRunProjector(`closed-${kind}`);
    accept(p, event("model_step.started", { stepId: "s1" }));
    if (kind === "tool") {
      accept(
        p,
        event("tool_call.create", {
          id: "old",
          stepId: "s1",
          name: "read",
          args: {},
          status: "running"
        })
      );
      accept(p, event("tool_call.update", { id: "old", stepId: "s1", status: "completed" }));
    } else
      accept(
        p,
        event("message.delta", {
          messageId: "old",
          stepId: "s1",
          channel: kind === "commentary" ? "commentary" : "analysis",
          ...(kind === "commentary"
            ? {}
            : {
                exposure: "private_reasoning",
                provenance: { provider: "fixture", nativeEvent: "private" }
              }),
          text: "ORIGINAL"
        })
      );
    advance(p);
    if (kind === "tool")
      accept(
        p,
        event("tool_call.update", { id: "old", name: "read", args: {}, status: "completed" })
      );
    else accept(p, event("message.delta", { messageId: "old", text: "PRIVATE_OR_STALE_TAIL" }));
    accept(
      p,
      event("message.update", { messageId: "answer", channel: "final", text: "ONLY_FINAL" })
    );
    accept(p, event("run.completed"));
    assert.equal(p.finalReply.text, "ONLY_FINAL");
    assert.equal(p.snapshot().toolCallCount, kind === "tool" ? 1 : 0);
    assert.ok(!p.snapshot().items.some((x) => x.id === "tool:old" || x.id === "message:old"));
    p.dispose();
  });

test("unknown messages are not published as final, including anonymous tails after a real final", () => {
  const p = new ImRunProjector("unknown-final");
  accept(p, event("message.delta", { messageId: "unknown", text: "UNKNOWN_TEXT" }));
  accept(p, event("message.update", { channel: "final", text: "ANONYMOUS_FINAL" }));
  accept(p, event("message.delta", { text: "ANONYMOUS_UNKNOWN_TAIL" }));
  accept(p, event("message.update", { messageId: "", channel: "final", text: "EMPTY_ID_FINAL" }));
  accept(p, event("message.delta", { messageId: "", text: "EMPTY_ID_UNKNOWN_TAIL" }));
  accept(p, event("message.update", { messageId: "known-final", channel: "final", text: "KNOWN" }));
  accept(p, event("message.delta", { messageId: "known-final", text: "_TAIL" }));
  accept(p, event("run.completed"));
  assert.equal(p.finalReply.text, "ANONYMOUS_FINAL\n\nEMPTY_ID_FINAL\n\nKNOWN_TAIL");
  p.dispose();
  const alias = new ImRunProjector("anonymous-alias");
  accept(
    alias,
    event("message.delta", {
      messageId: "unidentified:run:final",
      channel: "commentary",
      text: "PUBLIC_PROGRESS"
    })
  );
  accept(alias, event("message.delta", { text: "PRIVATE_ALIAS_TAIL" }));
  accept(alias, event("message.update", { channel: "final", text: "ONLY_FINAL" }));
  accept(alias, event("run.completed"));
  assert.equal(alias.finalReply.text, "ONLY_FINAL");
  assert.doesNotMatch(JSON.stringify(alias.snapshot()), /PRIVATE_ALIAS_TAIL/);
  alias.dispose();
  const forged = new ImRunProjector("stable-id-cannot-borrow-anonymous");
  accept(forged, event("message.update", { channel: "commentary", text: "PUBLIC_PROGRESS" }));
  accept(
    forged,
    event("message.delta", {
      messageId: "unidentified:run:commentary",
      text: "PRIVATE_PROGRESS_ALIAS"
    })
  );
  accept(forged, event("message.update", { channel: "final", text: "ONLY_FINAL" }));
  accept(
    forged,
    event("message.delta", { messageId: "unidentified:run:final", text: "PRIVATE_FINAL_ALIAS" })
  );
  accept(forged, event("run.completed"));
  assert.equal(forged.finalReply.text, "ONLY_FINAL");
  assert.doesNotMatch(
    JSON.stringify(forged.snapshot()),
    /PRIVATE_PROGRESS_ALIAS|PRIVATE_FINAL_ALIAS/
  );
  forged.dispose();
});

test("scope-free late public summaries do not get assigned to a subsequent step", () => {
  const p = new ImRunProjector("scope-free-summary");
  accept(p, event("model_step.started", { stepId: "s1" }));
  const summary = {
    messageId: "old",
    channel: "analysis",
    exposure: "public_summary",
    provenance: { provider: "fixture", nativeEvent: "summary" },
    text: "summary"
  };
  accept(p, event("message.update", { ...summary, stepId: "s1" }));
  advance(p);
  accept(p, event("message.update", summary));
  assert.equal(p.snapshot().reasoningCount, 1);
  assert.ok(!p.snapshot().items.some((x) => x.id === "message:old"));
  p.dispose();
});

test("OpenCode marks native text final and its snapshot continuation stays complete", () => {
  const p = new ImRunProjector("opencode-final");
  const normalizer = new OpenCodeEventNormalizer();
  for (const native of [
    { type: "step_start", part: { type: "step-start", messageID: "s" } },
    {
      type: "reasoning",
      part: { type: "reasoning", messageID: "s", id: "reason", text: "public reasoning" }
    },
    { type: "text", part: { type: "text", messageID: "s", id: "answer", text: "FINAL" } },
    { type: "text", part: { type: "text", messageID: "s", id: "answer", text: "FINAL_COMPLETE" } },
    { type: "step_finish", part: { type: "step-finish", messageID: "s", reason: "stop" } }
  ])
    for (const e of normalizer.normalize(native)) {
      if (e.type.startsWith("message.") && e.payload.messageId === "opencode:answer")
        assert.equal(e.payload.channel, "final");
      accept(p, e);
    }
  assert.equal(
    normalizeOpenCodeEvent({ type: "text", part: { text: "anonymous answer" } })[0].payload.channel,
    "final"
  );
  accept(p, event("run.completed"));
  assert.equal(p.finalReply.text, "FINAL_COMPLETE");
  p.dispose();
});

test("real ACP turn normalization keeps a new terminal-only tool scoped after a prior step", () => {
  const p = new ImRunProjector("acp-terminal");
  const turn = new AcpTurnNormalizer("fixture");
  for (const update of [
    { sessionUpdate: "tool_call", toolCallId: "first", name: "read", status: "completed" },
    { sessionUpdate: "tool_call", toolCallId: "second", name: "read", status: "failed" }
  ])
    for (const e of turn.normalize(update.sessionUpdate, normalizeAcpUpdate(update, "fixture")))
      accept(p, e);
  assert.equal(p.snapshot().modelStepCount, 2);
  assert.equal(p.snapshot().toolCallCount, 2);
  assert.equal(p.snapshot().items.at(-1).status, "failed");
  p.dispose();
});
