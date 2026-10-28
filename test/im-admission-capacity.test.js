import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate as settle } from "node:timers/promises";
import { prepareInvokeInput } from "@mininglamp-oss/octo-runtime-executor-core";
import { ImRuntime } from "../packages/octo-runtime-extra-channel-gateway/dist/index.js";
import { GatewayTransport } from "../packages/octo-runtime-extra-channel-gateway/dist/transport/channel.js";

test("F26: Bot working 64 and session waiting 4 are independent; rejection never invokes or marks read", async (t) => {
  let receive, release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  t.mock.method(GatewayTransport.prototype, "start", async function () {
    receive = this.callbacks.onMessage;
  });
  t.mock.method(GatewayTransport.prototype, "close", async () => {});
  const calls = [],
    reads = [],
    texts = [],
    cards = [];
  const runtime = new ImRuntime(
    {
      bot_id: "fixture",
      api_url: "https://im-test.deepminer.com.cn/api",
      adapter: { adapter_type: "codex" }
    },
    {
      kernel: {
        async *invoke(input, environment) {
          calls.push(input);
          await Promise.race([
            gate,
            new Promise((resolve) =>
              environment.signal.addEventListener("abort", resolve, { once: true })
            )
          ]);
          yield { protocolVersion: 2, type: "run.completed", payload: {} };
        },
        async cancelInvocation() {
          release();
          return { accepted: true };
        },
        async respondInteraction() {}
      }
    }
  );
  await runtime.start();
  t.after(() => runtime.close());
  let id = 0;
  const send = (session, overrides = {}) =>
    receive({
      messageId: `m${++id}`,
      senderId: "owner",
      conversationId: session,
      conversationKind: "group",
      text: "work",
      async markRead() {
        reads.push(id);
      },
      async buildContext() {
        return { schema: "octo.context-envelope/v3", items: [] };
      },
      async reply(text) {
        texts.push(text);
      },
      async replyFailure(event) {
        cards.push(event);
      },
      ...overrides
    });
  for (let session = 0; session < 20; session++)
    for (let task = 0; task < 5; task++) send(`s${session}`);
  await settle();
  assert.equal(calls.length, 20);
  assert.equal(runtime.status.workingTasks, 20);
  assert.equal(runtime.status.queuedTasks, 80);
  send("s0");
  await settle();
  assert.equal(cards.at(-1).payload.failure.code, "OH-RUN-2004");
  assert.match(texts.at(-1), /当前智能体繁忙，请稍后再试/);
  for (let session = 20; session < 64; session++) send(`s${session}`);
  await settle();
  assert.equal(calls.length, 64);
  send("s65", {
    async replyFailure(event) {
      cards.push(event);
      throw Error("card unavailable");
    }
  });
  await settle();
  assert.equal(cards.at(-1).payload.failure.code, "OH-RUN-2003");
  assert.match(texts.at(-1), /OH-RUN-2003/);
  assert.equal(reads.length, 64);
  release();
  for (let i = 0; i < 40 && runtime.status.sessions.length; i++) await settle();
  assert.equal(calls.length, 144);
  assert.equal(runtime.status.workingTasks, 0);
  assert.equal(runtime.status.queuedTasks, 0);
  assert.equal(reads.length, 144);
});

for (const terminal of ["run.completed", "run.failed", "run.cancelled"]) {
  test(`full Bot admits existing-session queues and transfers slots after ${terminal}`, async (t) => {
    let receive;
    const calls = [],
      reads = [],
      failures = [],
      cancellations = [];
    let finishing = false;
    t.mock.method(GatewayTransport.prototype, "start", async function () {
      receive = this.callbacks.onMessage;
    });
    t.mock.method(GatewayTransport.prototype, "close", async () => {});
    const runtime = new ImRuntime(
      {
        bot_id: "fixture",
        api_url: "https://im-test.deepminer.com.cn/api",
        adapter: { adapter_type: "codex", workdir: process.cwd() }
      },
      {
        kernel: {
          async *invoke(input) {
            const { request } = prepareInvokeInput(input);
            const gate = Promise.withResolvers();
            calls.push({ request, finish: gate.resolve });
            if (finishing) gate.resolve("run.completed");
            const type = await gate.promise;
            yield { protocolVersion: 2, type, payload: {} };
          },
          async cancelInvocation(invocationId) {
            const call = calls.find((entry) => entry.request.invocationId === invocationId);
            assert.ok(call, "cancellation must target an existing invocation");
            cancellations.push(invocationId);
            return { accepted: true };
          },
          async respondInteraction() {}
        }
      }
    );
    t.after(async () => {
      finishing = true;
      for (const call of calls) call.finish("run.completed");
      await runtime.close();
    });
    await runtime.start();
    let sequence = 0;
    const send = (session, text) => {
      const messageId = `capacity-${++sequence}`;
      receive({
        messageId,
        senderId: "owner",
        conversationId: session,
        conversationKind: "direct",
        text,
        async buildContext() {
          return { schema: "octo.context-envelope/v3", items: [] };
        },
        async markRead() {
          reads.push(messageId);
        },
        async reply() {},
        async replyFailure(event) {
          failures.push({ messageId, code: event.payload.failure.code });
        }
      });
      return messageId;
    };
    const until = async (predicate) => {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (predicate()) return;
        await settle();
      }
      assert.fail("capacity transition did not settle");
    };

    // 先占满工作槽，再排队；原回归先排队再满载，无法覆盖这个拒收顺序。
    for (let session = 0; session < 64; session++) send(`s${session}`, `active-${session}`);
    await until(() => calls.length === 64);
    for (let queued = 1; queued <= 4; queued++) send("s0", `queued-${queued}`);
    await settle();
    assert.equal(runtime.status.workingTasks, 64);
    assert.equal(runtime.status.queuedTasks, 4);
    assert.equal(calls.length, 64, "queued messages must not invoke concurrently");
    assert.equal(reads.length, 64, "queued messages stay unread until processing starts");

    const sixth = send("s0", "rejected-sixth");
    const newSession = send("new", "rejected-new");
    await settle();
    assert.deepEqual(failures, [
      { messageId: sixth, code: "OH-RUN-2004" },
      { messageId: newSession, code: "OH-RUN-2003" }
    ]);
    assert.equal(reads.includes(sixth), false);
    assert.equal(reads.includes(newSession), false);
    assert.equal(runtime.status.sessions.length, 64, "rejected sessions retain no scheduler");

    if (terminal === "run.cancelled") {
      send("s0", "/stop");
      await until(() => cancellations.length === 1);
      assert.equal(cancellations[0], calls[0].request.invocationId);
      await settle();
      assert.equal(calls.length, 64, "cancel acknowledgement alone must not advance the queue");
      assert.equal(runtime.status.workingTasks, 64);
      assert.equal(runtime.status.queuedTasks, 4);
      calls[0].finish("run.cancelled");
    } else calls[0].finish(terminal);
    await until(() => calls.length === 65);
    assert.equal(runtime.status.workingTasks, 64, "queued successor keeps the same slot");
    assert.equal(runtime.status.queuedTasks, 3);
    const duringTransfer = send("transfer", "rejected-during-transfer");
    await settle();
    assert.deepEqual(failures.at(-1), {
      messageId: duringTransfer,
      code: "OH-RUN-2003"
    });

    for (let queued = 1; queued <= 4; queued++) {
      const call = calls.at(-1);
      assert.equal(call.request.prompt, `queued-${queued}`, "session queue must remain FIFO");
      assert.equal(call.request.agentSessionId, calls[0].request.agentSessionId);
      call.finish("run.completed");
      await until(() =>
        queued < 4 ? calls.length === 65 + queued : runtime.status.workingTasks === 63
      );
      assert.equal(runtime.status.workingTasks, queued < 4 ? 64 : 63);
      assert.equal(runtime.status.queuedTasks, Math.max(0, 3 - queued));
    }

    assert.equal(reads.length, 68);
    send("new", "accepted-after-release");
    await until(() => calls.length === 69);
    assert.equal(calls.at(-1).request.prompt, "accepted-after-release");
    assert.equal(runtime.status.workingTasks, 64);
    assert.equal(failures.length, 3, "rejected messages must never be replayed automatically");
    assert.equal(reads.length, 69);
    finishing = true;
    for (const call of calls) call.finish("run.completed");
    await until(() => runtime.status.workingTasks === 0);
    assert.equal(runtime.status.queuedTasks, 0);
    assert.equal(runtime.status.sessions.length, 0);
    assert.equal(calls.length, 69);
  });
}
