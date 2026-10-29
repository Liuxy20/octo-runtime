import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  ExtraPlugins,
  createContextLoader
} from "../../packages/octo-runtime-host-sdk/dist/index.js";
import { assertContextEnvelope } from "../../packages/octo-runtime-protocol/dist/index.js";
import { build_im_contexts } from "../../packages/octo-runtime-extra-channel-gateway/dist/index.js";
import { createImInvocation } from "../../packages/octo-runtime-extra-channel-gateway/dist/execution/dispatcher.js";
import { MENTION_GUIDANCE } from "../../packages/octo-runtime-extra-channel-gateway/dist/transport/mentions.js";
import { WecomTransport } from "../../packages/octo-runtime-extra-channel-wecom/dist/transport/channel.js";
import { WecomConnection } from "../../packages/octo-runtime-extra-channel-wecom/dist/transport/connection.js";
import { waitFor } from "../runtime-fixture.js";

// 保留命名空间专项仅显式本地运行，不加入默认测试或 CI。
const schema = "octo.context-envelope/v3";
const reservedNames = [
  "mention-instructions",
  "artifact-delivery",
  "history-instructions",
  "message-trigger",
  "history",
  "history-gap",
  "group-rules",
  "topic-rules",
  "custom-host-item"
];
const reserved = reservedNames.map((name) => ({
  namespace: "extra.im",
  name,
  guidance: "HOST-RESERVED-MATERIAL",
  payload: { text: "HOST-RESERVED-MATERIAL" }
}));
const business = { namespace: "extra.business", name: "history", payload: { text: "business" } };
const instructions = {
  namespace: "octo.control",
  name: "instructions",
  payload: { entries: [{ text: "host instruction" }, { text: "host instruction" }] }
};
const config = {
  bot_id: "ownership-fixture",
  api_url: "https://im-test.deepminer.com.cn/api",
  spaceId: "synthetic",
  adapter: { adapter_type: "codex", workdir: process.cwd() },
  context: { schema, items: [business, ...reserved, instructions] }
};

for (const kind of ["gateway", "wecom"])
  test(`${kind}: static and dynamic host extra.im are ignored with a warning and AgentRun continues`, async (t) => {
    const base = `../../packages/octo-runtime-extra-channel-${kind}/dist/`;
    const { default: load, name } = await import(`${base}extra.js`);
    const transport = await import(`${base}transport/channel.js`);
    const Transport = transport.GatewayTransport ?? transport.WecomTransport;
    let callbacks;
    const requests = [],
      logs = [],
      replies = [];
    let calls = 0;
    t.mock.method(Transport.prototype, "start", async function () {
      callbacks = this.callbacks;
    });
    t.mock.method(Transport.prototype, "close", async () => {});
    const extras = new ExtraPlugins(
      [],
      {
        async *invoke(request) {
          requests.push(request);
          yield { protocolVersion: 2, type: "run.completed", payload: {} };
        },
        async cancelInvocation() {
          return { accepted: true };
        }
      },
      () =>
        (...args) =>
          logs.push(args)
    );
    t.after(() => extras.close());
    const bot =
      kind === "gateway"
        ? config
        : {
            bot_id: config.bot_id,
            adapter: config.adapter,
            context: config.context
          };
    const before = structuredClone(bot);
    await extras.load(
      { name, default: load },
      { bots: [bot] },
      {
        loadContexts() {
          calls++;
          return calls === 1
            ? []
            : reserved.map((item) => ({
                ...item,
                payload: { text: "DYNAMIC-HOST-RESERVED-MATERIAL" }
              }));
        }
      }
    );
    for (const [index, messageId] of ["static", "dynamic"].entries()) {
      callbacks.onMessage({
        messageId,
        senderId: "actor",
        conversationId: "dm",
        conversationKind: "direct",
        text: "task",
        buildContext: async (_signal, options) => ({ schema, items: options.configuredItems }),
        reply: async (text) => {
          replies.push(text);
        }
      });
      await waitFor(() => replies.length === index + 1);
    }
    assert.equal(requests.length, 2);
    for (const request of requests) {
      assert.doesNotMatch(JSON.stringify(request), /HOST-RESERVED-MATERIAL|custom-host-item/);
      assert.ok(request.contexts.items.some((item) => item.namespace === "extra.business"));
      const entries = request.contexts.items.find((item) => item.namespace === "octo.control")
        .payload.entries;
      assert.deepEqual(entries, [
        ...instructions.payload.entries,
        ...(kind === "gateway" ? [{ text: MENTION_GUIDANCE }] : [])
      ]);
    }
    assert.deepEqual(bot, before);
    const warnings = logs.filter((entry) => entry[1] === "channel.context.reserved_ignored");
    assert.equal(warnings.length, 2);
    for (const [index, warning] of warnings.entries()) {
      assert.equal(warning[0], "warn");
      assert.equal(warning[2].ignored_items, reserved.length * (index + 1));
    }
    assert.doesNotMatch(JSON.stringify(warnings), /HOST-RESERVED-MATERIAL/);
  });

for (const kind of ["gateway", "wecom"])
  test(`${kind}: ignored items do not consume merged count or byte budgets; real business limits remain`, async (t) => {
    const base = `../../packages/octo-runtime-extra-channel-${kind}/dist/`;
    const { default: load, name } = await import(`${base}extra.js`);
    const transport = await import(`${base}transport/channel.js`);
    const Transport = transport.GatewayTransport ?? transport.WecomTransport;
    let callbacks;
    t.mock.method(Transport.prototype, "start", async function () {
      callbacks = this.callbacks;
    });
    t.mock.method(Transport.prototype, "close", async () => {});
    const items = (namespace, prefix, count, text = "material") =>
      Array.from({ length: count }, (_, index) => ({
        namespace,
        name: `${prefix}-${index}`,
        payload: { text }
      }));
    const ignored = items("extra.im", "host", 32);
    for (const scenario of [
      { name: "static count", staticItems: ignored, dynamic: [business], ignored: 32 },
      { name: "dynamic count", staticItems: [business], dynamic: ignored, ignored: 32 },
      {
        name: "bytes",
        staticItems: items("extra.im", "host", 6, "x".repeat(8000)),
        dynamic: items("extra.business", "retained", 3, "y".repeat(8000)),
        ignored: 6
      },
      { name: "no callback", staticItems: [...ignored.slice(0, 31), business], ignored: 31 },
      {
        name: "actual business overflow",
        staticItems: items("extra.business", "base", 17),
        dynamic: items("extra.business", "dynamic", 16),
        rejected: true
      }
    ]) {
      assertContextEnvelope({ schema, items: scenario.staticItems });
      if (scenario.dynamic) assertContextEnvelope({ schema, items: scenario.dynamic });
      const requests = [],
        replies = [],
        logs = [],
        snapshots = [];
      let calls = 0;
      const bot = {
        bot_id: config.bot_id,
        adapter: config.adapter,
        ...(kind === "gateway"
          ? { api_url: config.api_url, spaceId: config.spaceId, bot_name: config.bot_id }
          : {}),
        context: { schema, items: scenario.staticItems }
      };
      const before = structuredClone(bot);
      const extras = new ExtraPlugins(
        [],
        {
          async *invoke(request) {
            requests.push(request);
            yield { protocolVersion: 2, type: "run.completed", payload: {} };
          },
          async cancelInvocation() {
            return { accepted: true };
          }
        },
        () =>
          (...args) =>
            logs.push(args)
      );
      try {
        await extras.load(
          { name, default: load },
          { bots: [bot] },
          scenario.dynamic
            ? {
                loadContexts(value) {
                  calls++;
                  snapshots.push(value);
                  return scenario.dynamic;
                }
              }
            : {}
        );
        callbacks.onMessage({
          messageId: scenario.name,
          senderId: "actor",
          conversationId: "dm",
          conversationKind: "direct",
          text: "task",
          buildContext: async (_signal, options) => ({ schema, items: options.configuredItems }),
          reply: async (text) => {
            replies.push(text);
          }
        });
        await waitFor(() => replies.length === 1);
        assert.equal(calls, scenario.dynamic ? 1 : 0, scenario.name);
        for (const snapshot of snapshots)
          assert.deepEqual(snapshot, before, "callback must receive the original complete config");
        assert.equal(
          requests.length,
          scenario.rejected ? 0 : 1,
          `${scenario.name}: ${JSON.stringify({ replies, logs })}`
        );
        assert.deepEqual(bot, before, "host config must not be mutated");
        const warnings = logs.filter((entry) => entry[1] === "channel.context.reserved_ignored");
        if (scenario.rejected) {
          assert.match(replies[0], /准备失败/);
          assert.equal(warnings.length, 0);
        } else {
          assert.equal(warnings.length, 1, scenario.name);
          assert.equal(warnings[0][0], "warn");
          assert.equal(warnings[0][2].ignored_items, scenario.ignored);
          assert.ok(requests[0].contexts.items.some((item) => item.namespace === "extra.business"));
          assert.equal(
            requests[0].contexts.items.some(
              (item) => item.namespace === "extra.im" && item.name.startsWith("host-")
            ),
            false
          );
        }
      } finally {
        await extras.close();
      }
    }
  });

test("loader selection preserves default merging, source validation, cancellation and in-flight limits", async () => {
  const stop = new AbortController();
  const base = Array.from({ length: 32 }, (_, index) => ({
    namespace: "extra.im",
    name: `host-${index}`,
    payload: {}
  }));
  const value = { context: { schema, items: base } };
  const select = (items) => items.filter((item) => item.namespace !== "extra.im");
  const plain = createContextLoader(() => [business], undefined, stop.signal);
  try {
    await assert.rejects(plain.load(value, stop.signal), /CONTEXT_BUDGET_EXCEEDED/);
    assert.deepEqual(await plain.load(value, stop.signal, select), [business]);
  } finally {
    await plain.close();
  }
  let selected = 0;
  const invalid = createContextLoader(() => [reserved[0], reserved[0]], undefined, stop.signal);
  try {
    await assert.rejects(
      invalid.load(value, stop.signal, (items) => {
        selected++;
        return select(items);
      })
    );
    assert.equal(selected, 0, "invalid source cannot be hidden by selection");
  } finally {
    await invalid.close();
  }
  let release;
  const late = createContextLoader(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
    { timeout_ms: 5, max_in_flight: 1 },
    stop.signal
  );
  try {
    await assert.rejects(
      late.load(value, stop.signal, () => {
        selected++;
        return [];
      }),
      /IM_CONTEXT_LOADING_TIMEOUT/
    );
    assert.equal(late.inFlight, 1);
    await assert.rejects(late.load(value, stop.signal, select), /IM_CONTEXT_LOADING_BUSY/);
    release([business]);
    await waitFor(() => late.inFlight === 0);
    assert.equal(selected, 0, "late results must not reach selection");
  } finally {
    release?.([]);
    await late.close();
  }
});

for (const dynamic of [false, true])
  test(`Gateway buildContext ignores ${dynamic ? "dynamic" : "static"} reserved items before generating facts and rules`, async (t) => {
    t.mock.method(globalThis, "fetch", async (url) =>
      String(url).endsWith("/md")
        ? Response.json({ content: "CHANNEL-GROUP-RULE", version: 1 })
        : Response.json({ more: 0, messages: [] })
    );
    const before = structuredClone(config);
    const items = await build_im_contexts(
      config,
      {
        channelId: "group____topic",
        channelType: 5,
        messageId: "trigger",
        fromUid: "actor",
        payload: { type: 1, content: "task" }
      },
      randomUUID(),
      new AbortController().signal,
      {
        initialSession: true,
        ...(dynamic ? { configuredItems: config.context.items } : {})
      }
    );
    assert.doesNotMatch(JSON.stringify(items), /HOST-RESERVED-MATERIAL|custom-host-item/);
    assert.equal(items.find((item) => item.name === "message-trigger").payload.sender.uid, "actor");
    for (const name of ["group-rules", "topic-rules"])
      assert.equal(items.find((item) => item.name === name).payload.text, "CHANNEL-GROUP-RULE");
    assert.deepEqual(
      items.filter((item) => item.namespace !== "extra.im"),
      [business, instructions]
    );
    assert.deepEqual(config, before);
  });

test("WeCom transport ignores static and dynamic reserved items without dropping global instructions", async (t) => {
  let receive, message;
  t.mock.method(WecomConnection.prototype, "connect", async function () {
    receive = this.callbacks.onMessage;
  });
  t.mock.method(WecomConnection.prototype, "close", async () => {});
  const transport = new WecomTransport(config, async () => randomUUID(), {
    onMessage(value) {
      message = value;
    },
    onDisconnect() {}
  });
  await transport.start(new AbortController().signal);
  t.after(() => transport.close());
  receive({
    headers: { req_id: "request" },
    body: {
      aibotid: config.bot_id,
      msgid: "message",
      msgtype: "text",
      chattype: "single",
      from: { userid: "actor" },
      text: { content: "task" }
    }
  });
  for (const options of [undefined, { configuredItems: config.context.items }]) {
    const context = await message.buildContext(new AbortController().signal, options);
    assert.deepEqual(context.items, [business, instructions]);
  }
});

test("Gateway owns stable contents on refresh, omission, recovery and frozen retry", () => {
  const message = { messageId: "message", senderId: "actor", conversationId: "dm", text: "task" };
  const context = { schema, items: [...reserved.slice(0, 3), business, instructions] };
  const before = structuredClone(context);
  const session = {
    id: "session",
    generation: 1,
    providerSession: { sessionId: "provider", resumable: true }
  };
  const invoke = (input, msg, refresh) =>
    createImInvocation(
      config,
      msg,
      input,
      "scope",
      session,
      new AbortController().signal,
      "occurrence",
      refresh
    );
  const first = invoke(context, message, true);
  assert.equal(first.stableContextIncluded, true);
  assert.doesNotMatch(JSON.stringify(first.request.contexts), /HOST-RESERVED-MATERIAL/);
  const ordinary = invoke(context, message, false);
  assert.equal(ordinary.stableContextIncluded, false);
  assert.equal(
    ordinary.request.contexts.items.some((item) => item.namespace === "extra.im"),
    false
  );
  assert.deepEqual(
    ordinary.recoveryContexts.map((item) => item.name),
    reservedNames.slice(0, 3)
  );
  assert.doesNotMatch(JSON.stringify(ordinary.recoveryContexts), /HOST-RESERVED-MATERIAL/);
  const retry = invoke(first.request.contexts, { ...message, historyRetry: true }, false);
  assert.deepEqual(retry.request.contexts, first.request.contexts);
  assert.deepEqual(context, before);
});
