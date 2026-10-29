import test from "node:test";
import assert from "node:assert/strict";
import { contextControlInstructions } from "../packages/octo-runtime-protocol/dist/index.js";
import { prepareInvokeInput } from "../packages/octo-runtime-executor-core/dist/invoke-input.js";
import { createContextLoader } from "../packages/octo-runtime-host-sdk/dist/index.js";
import { createImInvocation } from "../packages/octo-runtime-extra-channel-gateway/dist/execution/dispatcher.js";
import { MENTION_GUIDANCE } from "../packages/octo-runtime-extra-channel-gateway/dist/transport/mentions.js";
import { build_im_contexts } from "../packages/octo-runtime-extra-channel-gateway/dist/transport/contexts.js";
import { ImRuntime } from "../packages/octo-runtime-extra-channel-gateway/dist/index.js";
import { GatewayTransport } from "../packages/octo-runtime-extra-channel-gateway/dist/transport/channel.js";
import { waitFor } from "./runtime-fixture.js";

const schema = "octo.context-envelope/v3";
const config = {
  bot_id: "bot",
  api_url: "https://im-test.deepminer.com.cn/api",
  spaceId: "space",
  adapter: { adapter_type: "codex", workdir: process.cwd() }
};
const control = (...texts) => ({
  namespace: "octo.control",
  name: "instructions",
  payload: { entries: texts.map((text) => ({ text })) }
});
const signal = new AbortController().signal;
const invoke = (context, providerSession) =>
  createImInvocation(
    config,
    { messageId: "m", senderId: "owner", conversationId: "group", text: "task" },
    context,
    "scope",
    { id: "session", generation: 1, ...(providerSession ? { providerSession } : {}) },
    signal
  ).request;

test("Gateway supplies English stable instructions on fresh sessions, including empty host entries", () => {
  for (const items of [[], [control()]]) {
    const request = invoke({ schema, items });
    assert.equal(contextControlInstructions(request.contexts), MENTION_GUIDANCE);
    assert.equal(prepareInvokeInput(request).request.controlInstructions, MENTION_GUIDANCE);
    assert.equal(
      request.contexts.items.filter((item) => item.namespace === "octo.control").length,
      1
    );
  }
  assert.match(MENTION_GUIDANCE, /^\[OCTO_CHANNEL_MENTION_RULES_V1\]\n/);
  assert.match(MENTION_GUIDANCE, /preserve this entire block verbatim/);
  assert.match(MENTION_GUIDANCE, /task handoff to a bot/);
  assert.match(MENTION_GUIDANCE, /\n\[\/OCTO_CHANNEL_MENTION_RULES_V1\]$/);
  assert.match(MENTION_GUIDANCE, /^[\x00-\x7f]+$/);
});

test("Gateway appends defaults after effective host entries without deduplication or caller mutation", () => {
  const context = {
    schema,
    items: [
      { namespace: "extra.business", name: "first", payload: { text: "keep" } },
      control("persona", "persona", "  keep\nwhitespace  "),
      { namespace: "extra.business", name: "last", payload: {} }
    ]
  };
  const original = structuredClone(context);
  const resumed = { sessionId: "existing-provider", resumable: true };
  for (const providerSession of [undefined, resumed]) {
    const request = invoke(context, providerSession);
    const instructions = request.contexts.items.find((item) => item.namespace === "octo.control");
    assert.deepEqual(instructions.payload.entries, [
      ...original.items[1].payload.entries,
      ...(providerSession ? [] : [{ text: MENTION_GUIDANCE }])
    ]);
    assert.equal(
      contextControlInstructions(request.contexts),
      `persona\npersona\n  keep\nwhitespace  ${providerSession ? "" : `\n${MENTION_GUIDANCE}`}`
    );
    assert.equal(request.providerSession?.sessionId, providerSession?.sessionId);
    const business = request.contexts.items.filter((item) => item.namespace === "extra.business");
    assert.deepEqual(business, [original.items[0], original.items[2]]);
    instructions.payload.entries[1].text = "changed snapshot";
  }
  assert.deepEqual(context, original);
});

test("dynamic host instructions replace the host persona before channel defaults are appended once per turn", async () => {
  let current = "new persona";
  const hostConfig = { ...config, context: { schema, items: [control("old persona")] } };
  const loader = createContextLoader(() => [control(current)], undefined, signal);
  try {
    for (const text of ["new persona", "latest persona"]) {
      current = text;
      const items = await loader.load(hostConfig, signal);
      const request = invoke({ schema, items });
      assert.equal(contextControlInstructions(request.contexts), `${text}\n${MENTION_GUIDANCE}`);
      assert.deepEqual(items, [control(text)]);
    }
    assert.deepEqual(hostConfig.context.items, [control("old persona")]);
  } finally {
    await loader.close();
  }
});

test("required instructions and explicit host material are never silently dropped to fit the budget", () => {
  assert.throws(
    () => invoke({ schema, items: [control("x".repeat(64000))] }),
    /CONTEXT_BUDGET_EXCEEDED/
  );
  assert.throws(
    () =>
      invoke({
        schema,
        items: Array.from({ length: 32 }, (_, i) => ({
          namespace: "extra.business",
          name: `item-${i}`,
          payload: {}
        }))
      }),
    /CONTEXT_BUDGET_EXCEEDED/
  );
});

test("an existing provider session receives compact current trigger facts separately from rules", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => {
    assert.ok(!url.endsWith("/messages/sync"), "continuation must not fetch bootstrap history");
    return Response.json({}, { status: 404 });
  });
  const items = await build_im_contexts(
    config,
    {
      channelId: "group____topic",
      channelType: 5,
      messageId: "m",
      fromUid: "current-user"
    },
    "bf_fixture",
    signal,
    { initialSession: false }
  );
  assert.equal(
    items.some((item) => item.name === "mention-instructions"),
    false
  );
  const reminder = items.find((item) => item.name === "message-trigger");
  assert.equal(reminder.guidance.split("\n").length, 1);
  assert.equal(reminder.payload.sender.uid, "current-user");
  assert.equal(reminder.payload.conversation.id, "group____topic");
  assert.equal(reminder.payload.conversation.type, "group_topic");
});

test("application omits stable instructions on ordinary resumed turns and refreshes after reset", async (t) => {
  let receive;
  const optionsSeen = [],
    requests = [];
  t.mock.method(GatewayTransport.prototype, "start", async function () {
    receive = (message) => this.callbacks.onMessage(message);
  });
  t.mock.method(GatewayTransport.prototype, "close", async () => {});
  const runtime = new ImRuntime(config, {
    kernel: {
      async *invoke(input) {
        requests.push(input);
        yield {
          protocolVersion: 2,
          type: "session.update",
          payload: { providerSession: { sessionId: "provider", resumable: true } }
        };
        yield { protocolVersion: 2, type: "run.completed", payload: {} };
      },
      async cancelInvocation() {
        return { accepted: false };
      },
      async respondInteraction() {}
    }
  });
  await runtime.start();
  t.after(() => runtime.close());
  const send = (text, id) =>
    receive({
      messageId: id,
      senderId: "owner",
      conversationId: "owner",
      conversationKind: "direct",
      text,
      async buildContext(_signal, options) {
        optionsSeen.push(options);
        return { schema, items: [control("host persona")] };
      },
      async reply() {}
    });
  for (let i = 0; i < 2; i++) {
    send("task", `turn-${i}`);
    await waitFor(() => requests.length === i + 1 && runtime.status.sessions.length === 0);
  }
  assert.equal(optionsSeen[1].initialSession, false);
  assert.equal(requests[1].providerSession.sessionId, "provider");
  send("/reset", "reset");
  send("task", "after-reset");
  await waitFor(() => requests.length === 3 && runtime.status.sessions.length === 0);
  assert.equal(optionsSeen[2].initialSession, true);
  assert.equal(requests[2].providerSession, undefined);
  for (const index of [0, 2])
    assert.equal(
      contextControlInstructions(requests[index].contexts),
      `host persona\n${MENTION_GUIDANCE}`
    );
  assert.equal(contextControlInstructions(requests[1].contexts), "host persona");
  assert.equal(
    requests[1].contexts.items.some((item) => item.name === "artifact-delivery"),
    false
  );
});
