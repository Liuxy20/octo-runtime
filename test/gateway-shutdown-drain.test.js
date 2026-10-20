import test from "node:test";
import assert from "node:assert/strict";
import { ImRuntime } from "../packages/octo-runtime-extra-channel-gateway/dist/application/im-channel.js";
import { GatewayTransport } from "../packages/octo-runtime-extra-channel-gateway/dist/transport/channel.js";
import { MemoryImSessionStore } from "../packages/octo-runtime-extra-channel-gateway/dist/application/session-store.js";
import { waitFor } from "./runtime-fixture.js";
import { performance } from "node:perf_hooks";
import { withShutdownDeadline } from "../packages/octo-runtime-host-sdk/dist/shutdown.js";

test("Gateway owner stop keeps accepted tail events and final delivery ahead of connector teardown", async (t) => {
  let callbacks, invokeSignal, release;
  const terminal = new Promise((resolve) => {
    release = resolve;
  });
  const order = [];
  const controller = new AbortController();
  const store = new MemoryImSessionStore();
  let saved;
  t.mock.method(store, "save", function (key, binding) {
    saved = structuredClone(binding);
    return MemoryImSessionStore.prototype.save.call(this, key, binding);
  });
  t.mock.method(GatewayTransport.prototype, "start", async function () {
    callbacks = this.callbacks;
  });
  t.mock.method(GatewayTransport.prototype, "close", async () => {
    order.push("connector.close");
  });
  const kernel = {
    async *invoke(_input, environment) {
      invokeSignal = environment.signal;
      await terminal;
      order.push("tail");
      yield {
        protocolVersion: 2,
        type: "session.update",
        payload: { providerSession: { adapterType: "codex", sessionId: "last-provider-session" } }
      };
      yield { protocolVersion: 2, type: "run.cancelled", payload: {} };
    },
    async cancelInvocation() {
      order.push("cancel.ack");
      return { accepted: true };
    }
  };
  const runtime = new ImRuntime(
    {
      bot_id: "drain",
      api_url: "https://im-test.deepminer.com.cn/api",
      adapter: { adapter_type: "codex", workdir: process.cwd() }
    },
    { kernel, signal: controller.signal, sessions: store }
  );
  await runtime.start();
  // start 可关闭空旧 connector；只观察已接纳任务后的顺序。
  order.length = 0;
  callbacks.onMessage({
    messageId: "first",
    senderId: "sender",
    conversationId: "conversation",
    conversationKind: "direct",
    text: "run",
    buildContext: async () => ({ schema: "octo.context-envelope/v3", items: [] }),
    reply: async () => {
      order.push("final");
    }
  });
  await waitFor(() => invokeSignal);
  controller.abort();
  const closing = runtime.close();
  callbacks.onMessage({ messageId: "late", text: "must not run" });
  await waitFor(() => order.includes("cancel.ack"));
  try {
    assert.equal(invokeSignal.aborted, false, "accepted invocation tail must survive owner stop");
    assert.equal(order.includes("connector.close"), false);
  } finally {
    release();
  }
  await closing;
  assert.equal(order.filter((item) => item === "final").length, 1);
  assert.ok(order.indexOf("tail") < order.indexOf("final"));
  assert.ok(order.indexOf("final") < order.indexOf("connector.close"));
  assert.equal(runtime.status.sessions.length, 0);
  assert.equal(saved.providerSession.sessionId, "last-provider-session");
});

for (const phase of ["presentation", "final"]) {
  test(`Gateway stop preserves the connection after terminal while ${phase} is pending`, async (t) => {
    let callbacks,
      connectionSignal,
      holding = false,
      release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    let finals = 0;
    t.mock.method(GatewayTransport.prototype, "start", async function (signal) {
      connectionSignal = signal;
      callbacks = this.callbacks;
    });
    t.mock.method(GatewayTransport.prototype, "close", async () => {});
    const runtime = new ImRuntime(
      {
        bot_id: "finalizing",
        api_url: "https://im-test.deepminer.com.cn/api",
        adapter: { adapter_type: "codex", workdir: process.cwd() }
      },
      {
        kernel: {
          async *invoke() {
            yield { protocolVersion: 2, type: "run.completed", payload: {} };
          },
          cancelInvocation: async () => ({ accepted: false })
        }
      }
    );
    t.after(async () => {
      release();
      await runtime.close();
    });
    await runtime.start();
    callbacks.onMessage({
      messageId: "finalizing",
      senderId: "sender",
      conversationId: "chat",
      conversationKind: "direct",
      text: "run",
      buildContext: async () => ({ schema: "octo.context-envelope/v3", items: [] }),
      beginPresentation: () => ({
        update() {},
        async finish() {
          if (phase === "presentation") {
            holding = true;
            await gate;
          }
        }
      }),
      reply: async () => {
        if (phase === "final") {
          holding = true;
          await gate;
        }
        assert.equal(connectionSignal.aborted, false);
        finals++;
      }
    });
    await waitFor(() => holding);
    assert.equal(runtime.status.tasks.length, 0, "the source terminal has already been consumed");
    const closing = runtime.close();
    assert.equal(connectionSignal.aborted, false, "finalization still owns the live connection");
    release();
    await closing;
    assert.equal(finals, 1);
  });
}

for (const scenario of [
  "unknown",
  "delivery",
  "timeout",
  "rules",
  "binding",
  "presentation",
  "presentation-finish"
]) {
  test(`Gateway drain reports ${scenario} failure and fences late work`, async (t) => {
    let callbacks,
      started = false,
      release;
    let calls = 0,
      replies = 0,
      saves = 0;
    const blocked = new Promise((resolve) => {
      release = resolve;
    });
    const store = new MemoryImSessionStore();
    t.mock.method(store, "save", function (key, binding) {
      if (scenario === "binding" && binding.providerSession) throw new Error("test binding failed");
      saves++;
      return MemoryImSessionStore.prototype.save.call(this, key, binding);
    });
    if (scenario === "rules")
      t.mock.method(store, "patchRules", function (...args) {
        if (started) throw new Error("test rules finalization failed");
        return MemoryImSessionStore.prototype.patchRules.apply(this, args);
      });
    t.mock.method(GatewayTransport.prototype, "start", async function () {
      callbacks = this.callbacks;
    });
    t.mock.method(GatewayTransport.prototype, "close", async () => {});
    const runtime = new ImRuntime(
      {
        bot_id: "drain-failure",
        api_url: "https://im-test.deepminer.com.cn/api",
        adapter: { adapter_type: "codex", workdir: process.cwd() }
      },
      {
        sessions: store,
        kernel: {
          async *invoke() {
            calls++;
            started = true;
            await blocked;
            yield {
              protocolVersion: 2,
              type: "session.update",
              payload: { providerSession: { adapterType: "codex", sessionId: "late-session" } }
            };
            if (scenario !== "unknown")
              yield { protocolVersion: 2, type: "run.completed", payload: {} };
          },
          cancelInvocation: async () => ({ accepted: true })
        }
      }
    );
    await runtime.start();
    const message = {
      messageId: "first",
      senderId: "sender",
      conversationId: "conversation",
      conversationKind: scenario === "rules" ? "group" : "direct",
      text: "run",
      buildContext: async () => ({ schema: "octo.context-envelope/v3", items: [] }),
      reply: async () => {
        replies++;
        if (scenario === "delivery") throw new Error("test delivery failed");
      },
      ...(scenario === "presentation" || scenario === "presentation-finish"
        ? {
            beginPresentation: () => ({
              update(value) {
                if (scenario === "presentation" && value.terminal)
                  throw new Error("test terminal presentation failed");
              },
              async finish() {
                if (scenario === "presentation-finish") throw new Error("IM_PRESENTATION_FAILED");
              }
            })
          }
        : {})
    };
    callbacks.onMessage(message);
    callbacks.onMessage({ ...message, messageId: "queued" });
    await waitFor(() => started);
    const closing = withShutdownDeadline(
      performance.now() + (scenario === "timeout" ? 1050 : 4000),
      () => runtime.close()
    );
    const rejected = assert.rejects(closing, /IM_DISPOSE_FAILED/);
    if (scenario !== "timeout") release();
    await rejected;
    await assert.rejects(runtime.close(), /IM_DISPOSE_FAILED/);
    if (scenario === "presentation-finish")
      assert.equal(
        replies,
        1,
        "final text must still be delivered after failed presentation cleanup"
      );
    const before = { replies, saves };
    release();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(calls, 1);
    assert.deepEqual({ replies, saves }, before);
  });
}

for (const scenario of ["pending-gap", "fresh-fallback", "output-position", "rules-invalidation"]) {
  test(`Gateway drain preserves failure of ${scenario} persistence`, async (t) => {
    let callbacks,
      release,
      storeKey,
      started = false,
      draining = false;
    let finals = 0,
      connectorsClosed = 0;
    const blocked = new Promise((resolve) => {
      release = resolve;
    });
    const store = new MemoryImSessionStore();
    t.mock.method(store, "save", function (key, value) {
      storeKey = key;
      return MemoryImSessionStore.prototype.save.call(this, key, value);
    });
    t.mock.method(store, "patchGap", function (...args) {
      if (draining && scenario !== "rules-invalidation")
        throw new Error("fixture gap write failed");
      return MemoryImSessionStore.prototype.patchGap.apply(this, args);
    });
    t.mock.method(store, "invalidateRules", function (...args) {
      if (draining) throw new Error("fixture rules invalidation failed");
      return MemoryImSessionStore.prototype.invalidateRules.apply(this, args);
    });
    t.mock.method(GatewayTransport.prototype, "start", async function () {
      callbacks = this.callbacks;
    });
    t.mock.method(GatewayTransport.prototype, "close", async () => {
      connectorsClosed++;
    });
    const runtime = new ImRuntime(
      {
        bot_id: "persist-drain",
        api_url: "https://im-test.deepminer.com.cn/api",
        adapter: { adapter_type: "codex", workdir: process.cwd() }
      },
      {
        sessions: store,
        kernel: {
          async *invoke() {
            started = true;
            await blocked;
            if (scenario === "fresh-fallback")
              yield {
                protocolVersion: 2,
                type: "session.update",
                payload: {
                  providerSession: {
                    adapterType: "codex",
                    sessionId: "fresh",
                    resumeOutcome: "fresh_fallback"
                  }
                }
              };
            yield {
              protocolVersion: 2,
              type: scenario === "pending-gap" ? "run.cancelled" : "run.completed",
              payload: {}
            };
          },
          cancelInvocation: async () => ({ accepted: true })
        }
      }
    );
    await runtime.start();
    connectorsClosed = 0;
    callbacks.onMessage({
      messageId: "110",
      senderId: "owner",
      conversationId: "group",
      conversationKind: "group",
      text: "run",
      position: { messageSeq: 110 },
      buildContext: async () => ({ schema: "octo.context-envelope/v3", items: [] }),
      reply: async () => {
        finals++;
      }
    });
    await waitFor(() => started);
    const gapBefore = structuredClone(store.read(storeKey).gap);
    draining = true;
    const closing = runtime.close();
    const rejected = assert.rejects(closing, /IM_DISPOSE_FAILED/);
    if (scenario === "rules-invalidation") callbacks.onRulesChanged({ groupNo: "group" });
    if (scenario === "output-position")
      callbacks.onPosition({ conversationKind: "group", conversationId: "group", messageSeq: 111 });
    release();
    await rejected;
    await assert.rejects(runtime.close(), /IM_DISPOSE_FAILED/);
    assert.equal(finals, 1, "other finalizers must still run");
    assert.equal(connectorsClosed, 1);
    if (scenario === "pending-gap")
      assert.deepEqual(
        store.read(storeKey).gap,
        gapBefore,
        "failed persistence leaves the prior boundary unchanged"
      );
  });
}
