import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setImmediate as settle } from "node:timers/promises";
import {
  ImRuntime,
  build_im_contexts
} from "../../packages/octo-runtime-extra-channel-gateway/dist/index.js";
import { GatewayTransport } from "../../packages/octo-runtime-extra-channel-gateway/dist/transport/channel.js";
import { WukongConnection } from "../../packages/octo-runtime-extra-channel-gateway/dist/transport/wukong.js";
import { MemoryImSessionStore } from "../../packages/octo-runtime-extra-channel-gateway/dist/application/session-store.js";
import { assistantOutputFingerprint } from "../../packages/octo-runtime-extra-channel-gateway/dist/application/context-gap.js";
import { historyMessages } from "../../packages/octo-runtime-extra-channel-gateway/dist/transport/history-messages.js";
import { prepareInvokeInput } from "../../packages/octo-runtime-executor-core/dist/invoke-input.js";
import { withModelContexts } from "../../packages/octo-runtime-executor-core/dist/model-input.js";
import { createCodexAdapter } from "../../packages/octo-runtime-adapter-codex/dist/index.js";
import { codexAppServerFixture } from "../runtime-fixture.js";

// Deliberately manual: this focused verification must not expand the CI test selector.
const config = {
  bot_id: "history-bot",
  api_url: "https://im-test.deepminer.com.cn/api",
  spaceId: "history-space",
  cards: false,
  adapter: { adapter_type: "codex", workdir: process.cwd() }
};
const event = (type, payload = {}) => ({ protocolVersion: 2, type, payload });
const file = {
  type: 8,
  name: "hello.md",
  url: "https://cdn.example.com/hello.md",
  size: 5,
  extension: "md"
};
const answer = { type: 1, content: "Created [hello.md](https://cdn.example.com/hello.md)" };
const row = (message_seq, payload, from_uid = config.bot_id) => ({
  message_seq,
  message_id: String(message_seq),
  from_uid,
  type: payload.type,
  payload,
  content: JSON.stringify(payload),
  timestamp: 1793256617
});
const history = (request) =>
  request.contexts.items.find((item) => item.name === "history")?.payload;

async function fixture(
  t,
  {
    behavior,
    resumeOutcome,
    rows = [
      row(101, file),
      row(102, answer),
      row(103, { type: 1, content: "joke please" }, "owner")
    ]
  } = {}
) {
  let callbacks, storeKey;
  const store = new MemoryImSessionStore();
  const requests = [],
    calls = [],
    controls = [],
    tokens = new Map();
  const save = store.save.bind(store);
  t.mock.method(store, "save", (key, binding) => {
    storeKey = key;
    save(key, binding);
  });
  t.mock.method(GatewayTransport.prototype, "start", async function () {
    callbacks = this.callbacks;
  });
  t.mock.method(GatewayTransport.prototype, "close", async () => {});
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (String(url).endsWith("/md")) return Response.json({}, { status: 404 });
    if (!String(url).endsWith("/messages/sync")) return Response.json({});
    const input = JSON.parse(options.body);
    calls.push(input);
    return Response.json({
      more: 0,
      messages: rows
        .filter(
          (entry) =>
            entry.message_seq <= input.start_message_seq &&
            (!input.end_message_seq || entry.message_seq > input.end_message_seq)
        )
        .slice()
        .reverse()
    });
  });
  const runtime = new ImRuntime(config, {
    sessions: store,
    kernel: {
      async *invoke(request) {
        requests.push(request);
        if (behavior) {
          yield* behavior(request, requests.length);
          return;
        }
        yield event("session.update", {
          providerSession: {
            sessionId: "provider",
            resumable: true,
            ...(resumeOutcome ? { resumeOutcome } : {})
          }
        });
        yield event("message.update", {
          messageId: "answer",
          channel: "final",
          text: answer.content
        });
        yield event("run.completed");
      },
      async cancelInvocation() {
        return { accepted: true };
      }
    }
  });
  t.after(() => runtime.close());
  await runtime.start();
  const observe = (seq, payload, token = tokens.get(100)) =>
    callbacks.onPosition({
      conversationId: "group____topic",
      conversationKind: "thread",
      messageSeq: seq,
      own: true,
      turn: token,
      outputFingerprint: assistantOutputFingerprint(payload)
    });
  const send = (seq, overrides = {}) =>
    callbacks.onMessage({
      messageId: String(seq),
      senderId: "owner",
      conversationId: "group____topic",
      conversationKind: "thread",
      text: "current-query",
      position: { messageSeq: seq },
      bindHistoryTurn: (token) => tokens.set(seq, token),
      async reply() {},
      async replyFinal() {
        if (seq === 100) {
          observe(101, file);
          observe(102, answer);
        }
      },
      beginPresentation: (_run, _diagnostic, control) => {
        controls.push(control);
        return { update() {}, async finish() {} };
      },
      async buildContext(signal, options) {
        return {
          schema: "octo.context-envelope/v3",
          items: await build_im_contexts(
            config,
            {
              channelId: "group____topic",
              channelType: 5,
              messageId: String(seq),
              messageSeq: seq,
              fromUid: "owner",
              payload: { type: 1, content: "current-query" }
            },
            `bf_${randomUUID()}`,
            signal,
            options
          )
        };
      },
      ...overrides
    });
  const idle = async () => {
    for (let n = 0; runtime.status.workingTasks && n < 1000; n++) await settle();
    assert.equal(runtime.status.workingTasks, 0);
  };
  const patch = (update) => {
    const binding = store.read(storeKey);
    assert.equal(
      store.patchGap(storeKey, { sessionId: binding.id, generation: binding.generation }, update),
      true
    );
  };
  return {
    send,
    idle,
    observe,
    tokens,
    requests,
    calls,
    controls,
    patch,
    binding: () => store.read(storeKey),
    rows
  };
}

test("CH-01 normal continuation partitions own final/cards and retains the new user message", async (t) => {
  const f = await fixture(t);
  f.send(100);
  await f.idle();
  assert.equal(f.tokens.get(100).providerSessionId, "provider");
  assert.equal(f.binding().gap.assistantOutputs.messages.length, 2);
  f.send(104);
  await f.idle();
  const request = f.requests[1];
  assert.deepEqual(
    history(request).messages.map((item) => item.content.text),
    ["joke please"]
  );
  assert.equal(history(request).note, undefined);
  assert.match(request.freshFallbackModelInput, /hello\.md/);
  assert.doesNotMatch(request.freshFallbackModelInput, /joke please/);
  assert.equal(f.calls.length, 2);
});

for (const scenario of [
  "first",
  "reset",
  "pending-number",
  "pending-null",
  "unknown",
  "process",
  "provider",
  "compacted",
  "fresh-fallback",
  "evicted"
]) {
  test(`CH-02/03/04/07 conservative retention: ${scenario}`, async (t) => {
    const f = await fixture(t, {
      resumeOutcome:
        scenario === "compacted"
          ? "compacted"
          : scenario === "fresh-fallback"
            ? "fresh_fallback"
            : undefined
    });
    if (scenario !== "first") {
      f.send(100);
      await f.idle();
      if (scenario === "reset") {
        f.send(103, { text: "/reset" });
        await f.idle();
      } else
        f.patch((previous) => ({
          ...previous,
          ...(scenario === "pending-number" ? { pendingAfterSeq: 99 } : {}),
          ...(scenario === "pending-null" ? { pendingAfterSeq: null } : {}),
          ...(scenario === "unknown" ? { continuityUnknown: true } : {}),
          ...(scenario === "process" ? { processEpoch: "other-process" } : {}),
          ...(scenario === "provider"
            ? { assistantOutputs: { ...previous.assistantOutputs, providerSessionId: "other" } }
            : {}),
          ...(scenario === "evicted" ? { assistantOutputs: undefined } : {})
        }));
    }
    f.send(104);
    await f.idle();
    assert.deepEqual(
      history(f.requests.at(-1)).messages.map((item) => item.content.type),
      ["file", "text", "text"]
    );
  });
}

test("CH-05/06 edits, other bots, old own messages and quoted own text are retained", async (t) => {
  const f = await fixture(t);
  f.send(100);
  await f.idle();
  f.rows[1].payload = { ...answer, content: "edited final with new facts" };
  f.rows.push(row(104, answer, "other-bot"));
  f.rows.push(row(105, answer));
  f.rows.push(
    row(
      106,
      { type: 1, content: "reply", reply: { uid: config.bot_id, content: answer.content } },
      "owner"
    )
  );
  f.send(107);
  await f.idle();
  const messages = history(f.requests[1]).messages;
  assert.equal(messages.length, 5);
  assert.match(JSON.stringify(messages), /edited final with new facts/);
  assert.ok(messages.some((item) => item.uid === "other-bot"));
  assert.equal(f.binding().gap.assistantOutputs.messages.length, 2);
});

for (const outcome of ["run.failed", "run.cancelled", "unknown", "after-completed"]) {
  test(`CH-08 incomplete sources do not certify output: ${outcome}`, async (t) => {
    const f = await fixture(t, {
      behavior: async function* () {
        yield event("session.update", {
          providerSession: { sessionId: "provider", resumable: true }
        });
        yield event("message.update", {
          messageId: "answer",
          channel: "final",
          text: answer.content
        });
        if (outcome !== "unknown")
          yield event(outcome === "after-completed" ? "run.completed" : outcome);
        if (outcome === "after-completed") throw Error("source broke after terminal");
      }
    });
    f.send(100);
    await f.idle();
    assert.equal(f.tokens.get(100).providerSessionId, undefined);
    assert.equal(f.binding().gap.assistantOutputs, undefined);
    f.send(104);
    await f.idle();
    assert.equal(history(f.requests[1]).messages.length, 3);
  });
}

for (const stage of ["resume", "turn"]) {
  test(`CH-09 real Codex ${stage} fallback restores own-only history in the same invocation`, async (t) => {
    const f = await fixture(t, { rows: [row(101, file), row(102, answer)] });
    f.send(100);
    await f.idle();
    f.send(103);
    await f.idle();
    const input = f.requests[1];
    assert.deepEqual(history(input).messages, []);
    assert.equal(history(input).note, undefined);
    const prepared = prepareInvokeInput(input).request;
    const request = withModelContexts(prepared);
    const server = codexAppServerFixture(
      stage === "resume"
        ? { resumeError: "thread not found" }
        : { firstTurnStartError: "thread not found" }
    );
    const adapter = createCodexAdapter({ command: "fixture", spawnFn: server.spawnFn });
    try {
      for await (const e of adapter.invoke({
        ...request,
        approvalMode: "ask",
        signal: AbortSignal.timeout(4000)
      })) {
        if (e.type === "interaction.requested") {
          await adapter.respondInteraction(request.invocationId, {
            interactionId: e.payload.interactionId,
            outcome: "accepted"
          });
          server.complete();
        }
      }
      const turns = server.writes.filter((item) => item.method === "turn/start");
      const text = turns
        .at(-1)
        .params.input.filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n");
      assert.match(text, /Created \[hello\.md\]/);
      assert.equal(text.match(/Created \[hello\.md\]/g).length, 1);
      assert.equal(text.match(/current-query/g).length, 1);
      assert.ok(server.writes.some((item) => item.method === "thread/start"));
    } finally {
      server.close(0);
    }
  });
}

test("CH-11 card retry freezes filtered history and recovery without another API read", async (t) => {
  const f = await fixture(t, {
    behavior: async function* (_request, count) {
      yield event("session.update", {
        providerSession: { sessionId: "provider", resumable: true }
      });
      yield event("message.update", {
        messageId: "answer",
        channel: "final",
        text: answer.content
      });
      yield event(count === 1 ? "run.completed" : "run.failed");
    }
  });
  f.send(100);
  await f.idle();
  f.send(104);
  await f.idle();
  const frozen = structuredClone(f.requests[1]);
  assert.equal(history(frozen).messages.length, 1);
  assert.match(frozen.freshFallbackModelInput, /hello\.md/);
  f.rows.length = 0;
  assert.equal(f.controls.at(-1).retry("owner", "retry-filtered"), true);
  await f.idle();
  const retry = f.requests.at(-1);
  assert.notEqual(retry.invocationId, frozen.invocationId);
  assert.deepEqual(retry.contexts, frozen.contexts);
  assert.deepEqual(retry.freshFallbackModelInputParts, frozen.freshFallbackModelInputParts);
  assert.equal(retry.freshFallbackModelInput, frozen.freshFallbackModelInput);
  assert.equal(f.calls.length, 2);
});

test("CH-03/08 early and reset-late ACKs cannot create final coverage", async (t) => {
  const f = await fixture(t);
  f.send(100, {
    async replyFinal() {
      const { providerSessionId: _id, ...early } = f.tokens.get(100);
      f.observe(101, file, early);
    }
  });
  await f.idle();
  assert.equal(f.binding().gap.assistantOutputs, undefined);
  const old = f.tokens.get(100);
  f.send(103, { text: "/reset" });
  await f.idle();
  f.send(104);
  await f.idle();
  f.observe(102, answer, old);
  assert.equal(f.binding().gap.assistantOutputs, undefined);
  assert.equal(history(f.requests.at(-1)).messages.length, 3);
});

test("CH-10 split history retains the 8000-codepoint union budget", () => {
  const rows = Array.from({ length: 20 }, (_, index) =>
    row(120 - index, { type: 1, content: "long 🧪 message ".repeat(40) })
  );
  const all = historyMessages(rows);
  const split = historyMessages(rows, new Map(), [115, 113, 111]);
  const union = [...split.messages, ...split.recoveryMessages];
  assert.equal(union.length, all.messages.length);
  assert.ok(Array.from(JSON.stringify(union)).length <= 8000);
  assert.equal(split.truncated, all.truncated);
  assert.deepEqual(new Set(union.map(JSON.stringify)), new Set(all.messages.map(JSON.stringify)));
});

for (const mode of ["normal", "control", "artifact-failure", "no-completion"]) {
  test(`CH-06 transport certifies only successful completed final: ${mode}`, async (t) => {
    let receive, inbound;
    const positions = [];
    const signal = AbortSignal.timeout(5000);
    t.mock.method(globalThis, "fetch", async (url) => {
      if (url.endsWith("/auth/verify-bot"))
        return Response.json({ bot_uid: config.bot_id, space_id: config.spaceId });
      if (url.endsWith("/bot/register"))
        return Response.json({
          robot_id: config.bot_id,
          ws_url: "wss://im-test.deepminer.com.cn/ws",
          im_token: randomUUID()
        });
      return Response.json({ uid: "owner", name: "Owner" });
    });
    t.mock.method(WukongConnection.prototype, "connect", async function () {
      receive = this.onMessage;
    });
    t.mock.getter(WukongConnection.prototype, "connected", () => true);
    t.mock.method(WukongConnection.prototype, "close", async () => {});
    t.mock.method(WukongConnection.prototype, "sendText", async (...args) => {
      args[7]?.(101);
      return "sent";
    });
    const transport = new GatewayTransport(config, async () => `bf_${randomUUID()}`, {
      onMessage(message) {
        inbound = message;
      },
      onPosition(position) {
        positions.push(position);
      },
      onDisconnect() {}
    });
    await transport.start(signal);
    t.after(() => transport.close());
    receive({
      messageId: "100",
      fromUid: "owner",
      channelId: "owner",
      channelType: 1,
      payload: { type: 1, content: "task" }
    });
    // The proof hook is group/topic-only, so emulate an accepted group mention next.
    receive({
      messageId: "100",
      fromUid: "owner",
      channelId: "group",
      channelType: 2,
      payload: { type: 1, content: "task", mention: { uids: [config.bot_id] } }
    });
    inbound.bindHistoryTurn({
      sessionId: "s",
      generation: 1,
      processEpoch: "epoch",
      ...(mode === "no-completion" ? {} : { providerSessionId: "provider" })
    });
    if (mode === "control") await inbound.reply("control", "control-key");
    else
      await inbound.replyFinal(
        mode === "artifact-failure" ? "[missing](/not-present/missing.md)" : "answer",
        "final-key",
        {
          signal,
          obsolete: () => false,
          artifacts: {
            mode: "channel",
            workdir: process.cwd(),
            roots: [process.cwd()],
            maxFiles: 16,
            maxFileBytes: 20971520,
            maxTotalBytes: 52428800,
            timeoutMs: 30000
          }
        }
      );
    const own = positions.filter((item) => item.own);
    assert.ok(own.length);
    assert.equal(Boolean(own.at(-1).outputFingerprint), mode === "normal");
  });
}
