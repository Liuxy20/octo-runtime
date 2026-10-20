import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate as settle } from "node:timers/promises";
import {
  ImRuntime,
  build_im_contexts
} from "../packages/octo-runtime-extra-channel-gateway/dist/index.js";
import { GatewayTransport } from "../packages/octo-runtime-extra-channel-gateway/dist/transport/channel.js";
import { MemoryImSessionStore } from "../packages/octo-runtime-extra-channel-gateway/dist/application/session-store.js";
import { prepareInvokeInput } from "../packages/octo-runtime-executor-core/dist/invoke-input.js";
import { withModelContexts } from "../packages/octo-runtime-executor-core/dist/model-input.js";
import { providerInputParts } from "../packages/octo-runtime-protocol/dist/index.js";
import { imagePart } from "../packages/octo-runtime-extra-channel-gateway/dist/transport/image-input.js";

const config = {
  bot_id: "rules-bot",
  api_url: "https://im-test.deepminer.com.cn/api",
  spaceId: "rules-space",
  adapter: { adapter_type: "codex", workdir: process.cwd() }
};
const rules = (request) =>
  request.contexts.items.filter((item) => /^(group|topic)-rules$/.test(item.name));

async function fixture(context, behavior, legacyStore = false) {
  let callbacks;
  let sequence = 0;
  let fetches = 0;
  let fail = false;
  const documents = new Map([
    ["group", { content: "GROUP-RULE-1", version: 1 }],
    ["topic", { content: "TOPIC-RULE-1", version: 1 }],
    ["other", { content: "OTHER-RULE-1", version: 1 }]
  ]);
  const requests = [];
  const controls = [];
  const store = new MemoryImSessionStore();
  if (legacyStore) {
    store.patchRules = undefined;
    store.invalidateRules = undefined;
  }
  context.mock.method(GatewayTransport.prototype, "start", async function () {
    callbacks = this.callbacks;
  });
  context.mock.method(GatewayTransport.prototype, "close", async () => {});
  context.mock.method(globalThis, "fetch", async (url) => {
    if (!String(url).endsWith("/md")) return Response.json({ more: 0, messages: [] });
    fetches++;
    if (fail) return Response.json({}, { status: 503 });
    const parts = new URL(url).pathname.split("/");
    const document = documents.get(parts.at(-2));
    return document ? Response.json(document) : Response.json({}, { status: 404 });
  });
  const runtime = new ImRuntime(config, {
    sessions: store,
    kernel: {
      async *invoke(request) {
        requests.push(request);
        yield {
          protocolVersion: 2,
          type: "session.update",
          payload: { providerSession: { sessionId: "provider", resumable: true } }
        };
        if (behavior) yield* behavior(request, requests.length);
        else yield { protocolVersion: 2, type: "run.completed", payload: {} };
      },
      async cancelInvocation() {
        return { accepted: true };
      }
    }
  });
  context.after(() => runtime.close());
  await runtime.start();
  const send = (text = "summary", conversationId = "group____topic", overrides = {}) => {
    const messageId = String(++sequence);
    callbacks.onMessage({
      messageId,
      senderId: "owner",
      conversationId,
      conversationKind: conversationId.includes("____") ? "thread" : "group",
      text,
      position: { messageSeq: sequence },
      async reply() {},
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
              channelId: conversationId,
              channelType: conversationId.includes("____") ? 5 : 2,
              messageId,
              fromUid: "owner",
              payload: { type: 1, content: text }
            },
            "bf_fixture",
            signal,
            options
          )
        };
      },
      ...overrides
    });
  };
  const idle = async () => {
    for (let attempt = 0; runtime.status.workingTasks && attempt < 1000; attempt++) await settle();
    assert.equal(runtime.status.workingTasks, 0);
  };
  return {
    runtime,
    send,
    idle,
    requests,
    controls,
    documents,
    change: (shortId) =>
      callbacks.onRulesChanged({ groupNo: "group", ...(shortId ? { shortId } : {}) }),
    fail: (value) => {
      fail = value;
    },
    fetches: () => fetches
  };
}

test("rules are supplied once per provider session and authoritative versions repair missed notifications", async (context) => {
  const current = await fixture(context);
  current.send();
  await current.idle();
  assert.equal(rules(current.requests[0]).length, 2);
  current.send();
  await current.idle();
  assert.equal(rules(current.requests[1]).length, 0);
  assert.match(current.requests[1].freshFallbackModelInput, /GROUP-RULE-1/);
  assert.match(current.requests[1].freshFallbackModelInput, /summary/);
  current.documents.set("group", { content: "GROUP-RULE-2", version: 2 });
  current.send();
  await current.idle();
  assert.equal(rules(current.requests[2])[0].payload.version, 2);
  current.send();
  await current.idle();
  assert.equal(rules(current.requests[3]).length, 0);
  current.change();
  current.change();
  assert.equal(current.runtime.status.workingTasks, 0);
  assert.equal(current.requests.length, 4);
  current.send();
  await current.idle();
  assert.equal(rules(current.requests[4]).length, 2);
  assert.equal(current.fetches(), 10);
});

test("group invalidation reaches existing topics while topic invalidation stays local", async (context) => {
  const current = await fixture(context);
  for (const id of ["group", "group____topic", "group____other"]) {
    current.send("summary", id);
    await current.idle();
  }
  current.change("topic");
  for (const id of ["group____other", "group____topic"]) {
    current.send("summary", id);
    await current.idle();
  }
  assert.equal(rules(current.requests[3]).length, 0);
  assert.equal(rules(current.requests[4]).length, 2);
  current.change();
  for (const id of ["group", "group____topic", "group____other"]) {
    current.send("summary", id);
    await current.idle();
  }
  assert.deepEqual(
    current.requests.slice(5).map((request) => rules(request).length),
    [1, 2, 2]
  );
});

test("updates arriving during execution survive success and queued turns read the new rules", async (context) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const current = await fixture(context, async function* (_request, count) {
    if (count === 2) await gate;
    yield { protocolVersion: 2, type: "run.completed", payload: {} };
  });
  current.send();
  await current.idle();
  current.send();
  while (current.requests.length < 2) await settle();
  current.send();
  current.documents.set("group", { content: "GROUP-RULE-3", version: 3 });
  current.change();
  release();
  await current.idle();
  assert.equal(rules(current.requests[1]).length, 0);
  assert.equal(rules(current.requests[2])[0].payload.version, 3);
  current.send();
  await current.idle();
  assert.equal(rules(current.requests[3]).length, 0);
});

test("failed execution and preparation require rules again; frozen retry retains recovery inputs", async (context) => {
  const current = await fixture(context, async function* (_request, count) {
    yield { protocolVersion: 2, type: count === 2 ? "run.failed" : "run.completed", payload: {} };
  });
  current.send();
  await current.idle();
  current.send();
  await current.idle();
  const before = current.fetches();
  assert.equal(current.controls[1].retry("owner", "rules-retry"), true);
  await current.idle();
  assert.equal(current.fetches(), before);
  assert.deepEqual(
    current.requests[2].freshFallbackModelInputParts,
    current.requests[1].freshFallbackModelInputParts
  );
  current.send();
  await current.idle();
  assert.equal(rules(current.requests[3]).length, 2);
  current.fail(true);
  current.send();
  await current.idle();
  assert.equal(current.requests.length, 4);
  current.fail(false);
  current.send();
  await current.idle();
  assert.equal(rules(current.requests[4]).length, 2);
});

test("empty, deletion, recreation and reset/new each refresh the provider context", async (context) => {
  const current = await fixture(context);
  current.send();
  await current.idle();
  current.documents.set("group", { content: "", version: 2 });
  current.send();
  await current.idle();
  assert.equal(rules(current.requests.at(-1))[0].payload.status, "empty");
  current.documents.delete("group");
  current.send();
  await current.idle();
  assert.equal(rules(current.requests.at(-1))[0].payload.status, "not_found");
  current.documents.set("group", { content: "RECREATED", version: 4 });
  current.send();
  await current.idle();
  assert.equal(rules(current.requests.at(-1))[0].payload.version, 4);
  for (const command of ["/reset", "/new"]) {
    const previous = current.requests.at(-1).sessionId;
    const count = current.requests.length;
    current.send(command);
    await current.idle();
    assert.equal(current.requests.length, count);
    current.send();
    await current.idle();
    assert.notEqual(current.requests.at(-1).sessionId, previous);
    assert.equal(rules(current.requests.at(-1)).length, 2);
  }
});

test("same-turn fresh recovery carries rules and image bytes through the existing Core contract", async (context) => {
  const current = await fixture(context);
  current.send();
  await current.idle();
  const image = imagePart(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jq1sAAAAASUVORK5CYII=",
      "base64"
    ),
    "image/png"
  );
  current.send("inspect", "group____topic", { buildInputs: async () => [image] });
  await current.idle();
  const request = withModelContexts(prepareInvokeInput(current.requests[1]).request);
  const normal = providerInputParts(request);
  const recovery = providerInputParts(request, true);
  assert.equal(
    normal.some((part) => part.type === "text" && part.text.includes("GROUP-RULE-1")),
    false
  );
  assert.equal(
    recovery.filter((part) => part.type === "text" && part.text.includes("GROUP-RULE-1")).length,
    1
  );
  assert.deepEqual(recovery.slice(-1), current.requests[1].inputs);
  assert.deepEqual(
    recovery.filter((part) => part.type === "image"),
    [image]
  );
});

test("legacy stores always receive complete rules", async (context) => {
  const current = await fixture(context, undefined, true);
  for (let turn = 0; turn < 2; turn++) {
    current.send();
    await current.idle();
  }
  assert.deepEqual(
    current.requests.map((request) => rules(request).length),
    [2, 2]
  );
});

test("successful fresh fallback confirms the actual new provider session", async (context) => {
  const current = await fixture(context, async function* (_request, count) {
    if (count >= 2)
      yield {
        protocolVersion: 2,
        type: "session.update",
        payload: { providerSession: { sessionId: "fresh-provider", resumable: true } }
      };
    yield { protocolVersion: 2, type: "run.completed", payload: {} };
  });
  for (let turn = 0; turn < 3; turn++) {
    current.send();
    await current.idle();
  }
  assert.match(current.requests[1].freshFallbackModelInput, /GROUP-RULE-1/);
  assert.equal(current.requests[2].providerSession.sessionId, "fresh-provider");
  assert.equal(rules(current.requests[2]).length, 0);
});

test("reset during an in-flight turn prevents its completion from restoring the old rules state", async (context) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const current = await fixture(context, async function* (_request, count) {
    if (count === 1) await gate;
    yield { protocolVersion: 2, type: "run.completed", payload: {} };
  });
  current.send();
  while (!current.requests.length) await settle();
  current.change();
  current.send("/new");
  current.send();
  release();
  await current.idle();
  assert.notEqual(current.requests[1].sessionId, current.requests[0].sessionId);
  assert.equal(rules(current.requests[1]).length, 2);
});
