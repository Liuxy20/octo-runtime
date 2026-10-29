// 手动专项：node --expose-gc --test .octospec/tasks/246-gateway-projection-window/regression.mjs
// 不加入现有 CI glob；只使用合成事件、fake Kernel 和本进程对象。
import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate as settle } from "node:timers/promises";
const root = new URL("../../../", import.meta.url);
const { ImRunProjector } = await import(
  new URL("packages/octo-runtime-extra-channel-gateway/dist/presentation/run-projector.js", root)
);
const { CardSession } = await import(
  new URL("packages/octo-runtime-extra-channel-gateway/dist/transport/card-session.js", root)
);
const { ImDeliveryDispatcher } = await import(
  new URL("packages/octo-runtime-extra-channel-gateway/dist/delivery/dispatcher.js", root)
);
const { ImRuntime } = await import(
  new URL("packages/octo-runtime-extra-channel-gateway/dist/application/im-channel.js", root)
);
const { GatewayTransport } = await import(
  new URL("packages/octo-runtime-extra-channel-gateway/dist/transport/channel.js", root)
);
const { buildReasoningFrame } = await import(
  new URL("packages/octo-runtime-extra-channel-gateway/dist/transport/reasoning-frame.js", root)
);
const event = (type, payload = {}) => ({ protocolVersion: 2, type, payload });
const template = { ref: { id: "ai.reasoning-process", version: "0.4.1" }, maxPayloadBytes: 16384 };

test("thousands of rounds and MiB of public text retain five details and lifetime counts", () => {
  const p = new ImRunProjector("long");
  for (let i = 0; i < 2000; i++) {
    p.accept(event("model_step.started", { stepId: `s${i}` }));
    p.accept(
      event("message.update", {
        messageId: `r${i}`,
        stepId: `s${i}`,
        channel: "analysis",
        exposure: "public_summary",
        text: "中".repeat(2048)
      })
    );
    p.accept(
      event("message.update", {
        messageId: `c${i}`,
        stepId: `s${i}`,
        channel: "commentary",
        text: "进度".repeat(2048)
      })
    );
    p.accept(
      event("tool_call.create", {
        id: `t${i}`,
        stepId: `s${i}`,
        name: "exec_command",
        args: { cmd: "echo fixture" }
      })
    );
    p.accept(
      event("tool_call.update", {
        id: `t${i}`,
        status: "completed",
        output: "RAW_TOOL_OUTPUT".repeat(1000)
      })
    );
    p.accept(event("model_step.finished", { stepId: `s${i}`, status: "completed" }));
    assert.ok(p.snapshot().items.length <= 5);
  }
  const s = p.snapshot();
  assert.deepEqual([s.reasoningCount, s.toolCallCount, s.modelStepCount], [2000, 2000, 2000]);
  assert.ok(s.modelSteps.length <= 6);
  assert.ok(Buffer.byteLength(JSON.stringify(s)) < 15000);
  assert.doesNotMatch(JSON.stringify(s), /RAW_TOOL_OUTPUT/);
  p.accept(event("message.delta", { messageId: "final", channel: "final", text: "完整最终回复" }));
  p.accept(event("run.completed"));
  assert.equal(p.finalReply.text, "完整最终回复");
  assert.equal(p.snapshot().terminal, "completed");
  assert.match(buildReasoningFrame(p.snapshot(), template).phases.at(-1).thought, /第 2000 轮/);
});

test("same message deltas update one bounded preview while final messages stay independent", () => {
  const p = new ImRunProjector("delta");
  p.accept(event("message.delta", { messageId: "answer-a", channel: "final", text: "FIRST" }));
  for (let i = 0; i < 40; i++)
    p.accept(
      event("message.delta", {
        messageId: "progress",
        channel: "commentary",
        text: "字".repeat(16384)
      })
    );
  assert.equal(p.snapshot().items.length, 1);
  assert.ok(Array.from(p.snapshot().items[0].content).length <= 180);
  for (let i = 0; i < 20; i++)
    p.accept(
      event("message.update", { messageId: `next-${i}`, channel: "commentary", text: "new" })
    );
  p.accept(event("message.delta", { messageId: "answer-b", channel: "final", text: "SECOND" }));
  p.accept(event("message.update", { messageId: "answer-a", channel: "final", text: "REPLACED" }));
  // 即使某 ID 曾用于进度且已淘汰，显式 final 仍独立接纳。
  p.accept(event("message.update", { messageId: "progress", channel: "final", text: "THIRD" }));
  p.accept(event("run.completed"));
  assert.equal(p.finalReply.text, "REPLACED\n\nSECOND\n\nTHIRD");
});

test("retired updates do not resurrect visible records or increment counts", () => {
  const p = new ImRunProjector("late");
  p.accept(
    event("message.update", {
      messageId: "old",
      channel: "analysis",
      exposure: "public_summary",
      text: "old"
    })
  );
  for (let i = 0; i < 10; i++)
    p.accept(event("message.update", { messageId: `m${i}`, channel: "commentary", text: "new" }));
  p.accept(
    event("message.delta", {
      messageId: "old",
      channel: "analysis",
      exposure: "public_summary",
      text: "late"
    })
  );
  assert.equal(p.snapshot().reasoningCount, 1);
  assert.ok(!p.snapshot().items.some((item) => item.id === "message:old"));
  p.accept(event("message.delta", { messageId: "old", text: "must not become final" }));
  assert.equal(p.finalText, "");
  p.accept(event("model_step.started", { stepId: "old-step" }));
  for (let i = 0; i < 600; i++) {
    p.accept(event("model_step.started", { stepId: `new-step-${i}` }));
    p.accept(
      event("message.update", {
        messageId: `step-message-${i}`,
        stepId: `new-step-${i}`,
        channel: "commentary",
        text: "new"
      })
    );
  }
  p.accept(
    event("message.update", {
      messageId: "unknown-old",
      stepId: "old-step",
      channel: "analysis",
      exposure: "public_summary",
      text: "old step"
    })
  );
  assert.equal(p.snapshot().reasoningCount, 2);
  assert.ok(!p.snapshot().items.some((item) => item.id === "message:unknown-old"));
});

test("a first public summary after an unknown exposure remains visible", () => {
  const p = new ImRunProjector("exposure");
  p.accept(event("model_step.started", { stepId: "s" }));
  p.accept(event("message.create", { messageId: "r", channel: "analysis", exposure: "unknown" }));
  p.accept(
    event("message.delta", {
      messageId: "r",
      channel: "analysis",
      exposure: "private",
      text: "PRIVATE"
    })
  );
  p.accept(
    event("message.update", {
      messageId: "r",
      channel: "analysis",
      exposure: "public_summary",
      text: "公开"
    })
  );
  assert.equal(p.snapshot().reasoningCount, 1);
  assert.equal(p.snapshot().items[0].content, "公开");
  assert.doesNotMatch(JSON.stringify(p.snapshot()), /PRIVATE/);
});

test("long tools outside the visible window finish without reappearing or retaining output", () => {
  const p = new ImRunProjector("tools", true);
  p.accept(
    event("tool_call.create", { id: "long", name: "exec_command", args: { cmd: "echo long" } }),
    100
  );
  for (let i = 0; i < 12; i++) {
    p.accept(event("tool_call.create", { id: `tool-${i}`, name: "exec_command", args: {} }), 200);
    p.accept(event("tool_call.update", { id: `tool-${i}`, status: "completed" }), 300);
  }
  p.accept(
    event("tool_call.update", {
      id: "long",
      status: "completed",
      output: "PRIVATE_LONG_OUTPUT".repeat(10000)
    }),
    10000
  );
  assert.equal(p.snapshot().toolCallCount, 13);
  assert.ok(!p.snapshot().items.some((item) => item.id === "tool:long"));
  assert.doesNotMatch(JSON.stringify(p.snapshot()), /PRIVATE_LONG_OUTPUT/);
  p.accept(event("tool_call.update", { id: "tool-11", status: "completed" }), 500);
  assert.equal(p.snapshot().items.at(-1).durationMs, 300);
  assert.equal(p.snapshot().toolCallCount, 13);
});

test("dispose releases remaining projection bodies and ignores late frames", () => {
  const p = new ImRunProjector("release");
  p.accept(
    event("message.update", { messageId: "final", channel: "final", text: "COMPLETE_FINAL" })
  );
  p.accept(event("run.completed"));
  assert.equal(p.finalReply.text, "COMPLETE_FINAL");
  p.dispose();
  p.dispose();
  p.accept(event("message.delta", { channel: "final", text: "late" }));
  assert.equal(p.finalText, "");
  assert.equal(p.snapshot().items.length, 0);
  assert.equal(p.snapshot().modelSteps.length, 0);
  assert.doesNotMatch(p.finalReply.text, /COMPLETE_FINAL|late/);
});

// Connector 与投影分属不同作用域，避免 fixture 的连接器闭包本身持有 projector。
const memoryConnector = {
  config: { bot_id: "fixture", api_url: "http://127.0.0.1:1" },
  reasoningTemplate: async () => template,
  card: async () => "card-id"
};
function retainedCard() {
  const projector = new ImRunProjector("retained-card");
  const ref = new WeakRef(projector);
  const card = new CardSession(
    memoryConnector,
    new ImDeliveryDispatcher(new AbortController().signal),
    { channelId: "fixture", channelType: 1 },
    "retained-card",
    () => {},
    () => projector.snapshot()
  );
  return { card, ref };
}

test(
  "retained control cards do not keep projections from repeated completed invocations",
  { skip: !globalThis.gc },
  async (t) => {
    let receive;
    const projections = [],
      cards = [];
    const original = ImRunProjector.prototype.dispose;
    // mock.method 的调用记录会强引用 receiver；内存验证只安装不留调用记录的探针。
    ImRunProjector.prototype.dispose = function () {
      projections.push(new WeakRef(this));
      return original.call(this);
    };
    t.after(() => {
      ImRunProjector.prototype.dispose = original;
    });
    t.mock.method(GatewayTransport.prototype, "start", async function () {
      receive = this.callbacks.onMessage;
    });
    t.mock.method(GatewayTransport.prototype, "close", async () => {});
    const runtime = new ImRuntime(
      {
        bot_id: "repeat",
        api_url: "http://127.0.0.1:1",
        adapter: { adapter_type: "codex", workdir: process.cwd() }
      },
      {
        kernel: {
          async *invoke() {
            yield event("message.update", { channel: "final", text: "answer" });
            yield event("run.completed");
          },
          cancelInvocation: async () => ({ accepted: true })
        }
      }
    );
    t.after(() => runtime.close());
    await runtime.start();
    for (let i = 0; i < 1000; i++) {
      receive({
        messageId: `input-${i}`,
        senderId: "owner",
        conversationId: "owner",
        conversationKind: "direct",
        text: "fixture",
        buildContext: async () => ({ schema: "octo.context-envelope/v3", items: [] }),
        reply: async () => {},
        beginPresentation(runId, diagnostic) {
          const card = new CardSession(
            memoryConnector,
            new ImDeliveryDispatcher(new AbortController().signal),
            { channelId: "fixture", channelType: 1 },
            runId,
            () => {},
            diagnostic
          );
          cards.push(card);
          return {
            update: (snapshot) => card.update(snapshot),
            async finish() {
              try {
                await card.finish();
              } finally {
                card.release();
              }
            }
          };
        }
      });
      for (let n = 0; n < 200 && runtime.status.sessions.length; n++)
        await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(runtime.status.sessions.length, 0);
    }
    assert.equal(cards.length, 1000);
    for (let i = 0; i < 8; i++) {
      await settle();
      globalThis.gc();
    }
    assert.ok(projections.length >= 1000);
    assert.ok(projections.every((ref) => ref.deref() === undefined));
  }
);

test("shutdown releases the active projection after the original invocation ends", async (t) => {
  let receive, release;
  const disposed = [];
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const original = ImRunProjector.prototype.dispose;
  t.mock.method(ImRunProjector.prototype, "dispose", function () {
    disposed.push(this);
    return original.call(this);
  });
  t.mock.method(GatewayTransport.prototype, "start", async function () {
    receive = this.callbacks.onMessage;
  });
  t.mock.method(GatewayTransport.prototype, "close", async () => {});
  const runtime = new ImRuntime(
    {
      bot_id: "shutdown",
      api_url: "http://127.0.0.1:1",
      adapter: { adapter_type: "codex", workdir: process.cwd() }
    },
    {
      kernel: {
        async *invoke() {
          yield event("message.update", { messageId: "p", channel: "commentary", text: "pending" });
          await gate;
          yield event("run.cancelled");
        },
        cancelInvocation: async () => {
          release();
          return { accepted: true };
        }
      }
    }
  );
  t.after(async () => {
    release();
    await runtime.close().catch(() => {});
  });
  await runtime.start();
  receive({
    messageId: "input",
    senderId: "owner",
    conversationId: "owner",
    conversationKind: "direct",
    text: "fixture",
    buildContext: async () => ({ schema: "octo.context-envelope/v3", items: [] }),
    reply: async () => {},
    beginPresentation: () => ({ update() {}, async finish() {} })
  });
  for (let n = 0; n < 100 && !runtime.status.tasks.length; n++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(runtime.status.tasks.length);
  await runtime.close();
  assert.ok(disposed.length);
  assert.ok(disposed.every((p) => p.snapshot().items.length === 0 && p.finalText === ""));
});
test(
  "retaining a finished card ID does not retain its projection callback",
  { skip: !globalThis.gc },
  async () => {
    const { card, ref } = retainedCard();
    await card.finish();
    for (let i = 0; i < 3; i++) {
      await settle();
      globalThis.gc();
    }
    assert.ok(ref.deref(), "未释放的诊断回调仍持有投影，fixture 应覆盖此引用链");
    card.release();
    for (let i = 0; i < 8; i++) {
      await settle();
      globalThis.gc();
    }
    assert.equal(ref.deref(), undefined);
    card.update({ phase: "thinking", items: [] });
    await card.finish();
  }
);

for (const outcome of [
  "completed",
  "long-progress",
  "failed",
  "cancelled",
  "stream-error",
  "presentation-error",
  "final-error"
]) {
  test(`runtime releases projection after finalization: ${outcome}`, async (t) => {
    const disposed = [];
    let receive,
      finalText,
      calls = 0,
      cancellations = 0,
      maxItems = 0;
    const original = ImRunProjector.prototype.dispose;
    t.mock.method(ImRunProjector.prototype, "dispose", function () {
      disposed.push(this);
      return original.call(this);
    });
    t.mock.method(GatewayTransport.prototype, "start", async function () {
      receive = this.callbacks.onMessage;
    });
    t.mock.method(GatewayTransport.prototype, "close", async () => {});
    const runtime = new ImRuntime(
      {
        bot_id: "fixture",
        api_url: "http://127.0.0.1:1",
        adapter: { adapter_type: "codex", workdir: process.cwd() },
        codex_retry: { enabled: false }
      },
      {
        kernel: {
          async *invoke() {
            calls++;
            if (outcome === "long-progress") {
              for (let i = 0; i < 1000; i++) {
                yield event("model_step.started", { stepId: `s${i}` });
                yield event("message.update", {
                  messageId: `c${i}`,
                  channel: "commentary",
                  text: "公开进度".repeat(1024)
                });
                yield event("tool_call.create", { id: `t${i}`, name: "exec_command", args: {} });
                yield event("tool_call.update", {
                  id: `t${i}`,
                  status: "completed",
                  output: "raw tool output"
                });
                yield event("model_step.finished", { stepId: `s${i}`, status: "completed" });
              }
            }
            yield event("message.update", {
              messageId: "f",
              channel: "final",
              text: "COMPLETE_FINAL"
            });
            if (outcome === "stream-error") throw Error("synthetic stream failure");
            yield event(
              `run.${["failed", "cancelled"].includes(outcome) ? outcome : "completed"}`,
              { message: "synthetic failure" }
            );
          },
          cancelInvocation: async () => {
            cancellations++;
            return { accepted: true };
          }
        }
      }
    );
    t.after(() => runtime.close());
    await runtime.start();
    receive({
      messageId: "input",
      senderId: "owner",
      conversationId: "owner",
      conversationKind: "direct",
      text: "fixture",
      buildContext: async () => ({ schema: "octo.context-envelope/v3", items: [] }),
      reply: async () => {},
      replyFinal: async (text) => {
        finalText = text;
        if (outcome === "completed") assert.equal(text, "COMPLETE_FINAL");
        if (outcome === "final-error") throw Error("synthetic final failure");
      },
      beginPresentation: () => ({
        update(snapshot) {
          maxItems = Math.max(maxItems, snapshot.items.length);
        },
        async finish() {
          if (outcome === "presentation-error") throw Error("synthetic presentation failure");
        }
      })
    });
    for (let i = 0; i < 300 && (calls === 0 || runtime.status.sessions.length); i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(runtime.status.sessions.length, 0);
    assert.equal(calls, 1);
    assert.ok(disposed.length > 0);
    assert.ok(disposed.every((p) => p.finalText === "" && p.snapshot().items.length === 0));
    if (["completed", "long-progress"].includes(outcome)) assert.equal(finalText, "COMPLETE_FINAL");
    if (outcome === "long-progress") {
      assert.equal(cancellations, 0);
      assert.equal(maxItems, 5);
    }
  });
}
