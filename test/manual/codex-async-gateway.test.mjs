import test from "node:test";
import assert from "node:assert/strict";
import { ImTask } from "../../packages/octo-runtime-extra-channel-gateway/dist/execution/task.js";
import { createImInvocation } from "../../packages/octo-runtime-extra-channel-gateway/dist/execution/dispatcher.js";
import { ImRunProjector } from "../../packages/octo-runtime-extra-channel-gateway/dist/presentation/run-projector.js";

const event = (type, payload = {}) => ({ protocolVersion: 2, type, payload });
function clock() {
  let now = 0;
  const timers = new Set();
  return {
    now: () => now,
    random: () => 0,
    wait: async () => {},
    schedule(fn, ms) {
      const timer = { fn, at: now + ms };
      timers.add(timer);
      return () => timers.delete(timer);
    },
    tick(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...timers].sort((a, b) => a.at - b.at)[0];
        if (!next || next.at > end) break;
        now = next.at;
        timers.delete(next);
        next.fn();
      }
      now = end;
    }
  };
}
const question = (id, async) =>
  event("interaction.requested", {
    interactionId: id,
    kind: "question",
    executionInstanceId: "invoke",
    expiresAt: new Date(Date.now() + 600000).toISOString(),
    ...(async ? { delivery: "async" } : {}),
    request: {
      schema: "octo.question-request/v1",
      messageId: id,
      questions: [{ id: "q:0", title: "Color?", options: ["Red"], allowCustom: true }]
    }
  });

for (const sync of [false, true])
  test(`Gateway ignores async forms and their resolutions; synchronous pending=${sync}`, async () => {
    const time = clock(),
      projector = new ImRunProjector("run"),
      seen = [];
    const config = {
      bot_id: "async-gateway-fixture",
      api_url: "https://im-test.deepminer.com.cn/api",
      adapter: { adapter_type: "codex", workdir: process.cwd() }
    };
    const request = createImInvocation(
      config,
      { messageId: "msg", senderId: "owner", conversationId: "chat", text: "test" },
      { schema: "octo.context-envelope/v3", items: [] },
      "key",
      { id: "session", generation: 1 },
      new AbortController().signal
    ).request;
    let responses = 0,
      cancellations = 0,
      task;
    const kernel = {
      async *invoke() {
        yield event("run.started");
        if (sync) yield question("sync", false);
        yield question("async", true);
        time.tick(30000);
        assert.equal(task.modelWait.snapshot.seconds, sync ? undefined : 30);
        assert.equal(projector.snapshot().phase, sync ? "waiting" : "model");
        yield event("interaction.resolved", {
          interactionId: "async",
          status: "invalidated",
          reasonCode: "run_terminal"
        });
        assert.equal(projector.snapshot().phase, sync ? "waiting" : "model");
        if (sync)
          yield event("interaction.resolved", {
            interactionId: "sync",
            status: "resolved",
            outcome: "answered"
          });
        yield event("message.update", {
          messageId: "async-message",
          role: "assistant",
          channel: "final",
          delivery: "async",
          questions: [{ title: "Color?", options: ["Red"] }],
          text: "Color?"
        });
        yield event("run.completed");
      },
      async respondInteraction() {
        responses++;
      },
      async cancelInvocation() {
        cancellations++;
        return { accepted: true };
      }
    };
    task = new ImTask(kernel, request, "codex", config, {}, () => {}, time);
    for await (const value of task.events()) {
      seen.push(value);
      projector.accept(value);
    }
    assert.equal(seen.filter((e) => e.type.startsWith("interaction.")).length, sync ? 2 : 0);
    assert.ok(seen.some((e) => e.type === "message.update" && e.payload.delivery === "async"));
    assert.equal(projector.snapshot().terminal, "completed");
    assert.equal(responses, 0);
    assert.equal(cancellations, 0);
  });
