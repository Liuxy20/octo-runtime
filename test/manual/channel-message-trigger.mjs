import test, { after } from "node:test";
import assert from "node:assert/strict";
import { buildMessageTrigger } from "../../packages/octo-runtime-extra-channel-gateway/dist/transport/message-trigger.js";

const previousZone = process.env.TZ;
process.env.TZ = "Asia/Shanghai";
after(() => {
  if (previousZone === undefined) delete process.env.TZ;
  else process.env.TZ = previousZone;
});

// 专项手动验证，既有 CI 测试范围不变。
const config = { api_url: "https://fixture.invalid/api", bot_id: "receiver" };
const message = {
  channelId: "group____topic",
  channelType: 5,
  messageId: "1234567890123456789",
  fromUid: "sender",
  timestamp: 1793232000,
  payload: { from_name: "forged", content: "@forged bot", mention: { uids: ["receiver"] } }
};
const people = [
  { uid: "sender", name: "Alice", robot: 0 },
  { uid: "receiver", name: "Assistant", robot: 1 }
];
const run = (input = message, signal = new AbortController().signal) =>
  buildMessageTrigger(config, input, "bf_fixture", signal);

test("topic names, real actor identity, recipient and mentions are distinct", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const path = new URL(url).pathname;
    calls.push(path);
    assert.equal(options.headers.Authorization, "Bearer bf_fixture");
    if (path.endsWith("/users/batch")) {
      assert.deepEqual(JSON.parse(options.body), { uids: ["sender", "receiver"] });
      return Response.json({
        users: [...people, { uid: "not-requested", name: "Other", robot: 1 }]
      });
    }
    assert.ok(path.endsWith("/groups/group/threads/topic"));
    return Response.json({
      group_no: "group",
      group_name: "Engineering",
      short_id: "topic",
      name: "Release"
    });
  });
  const item = await run();
  assert.deepEqual(item.payload, {
    messageId: message.messageId,
    sentAt: "2026-10-29T08:00:00.000+08:00",
    conversation: {
      id: "group____topic",
      type: "group_topic",
      group: { id: "group", name: "Engineering" },
      topic: { id: "topic", name: "Release" }
    },
    sender: { uid: "sender", name: "Alice", type: "human" },
    recipient: { botId: "receiver", name: "Assistant" },
    mentions: { targets: [{ uid: "receiver", name: "Assistant", type: "bot" }] }
  });
  assert.equal(calls.length, 2);
  assert.equal(item.guidance.split("\n").length, 1);
  assert.ok(item.guidance.length < 160);
  assert.doesNotMatch(JSON.stringify(item), /forged|not-requested/);
});

test("group and direct scopes do not invent topics or guess identity from UID", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) =>
    new URL(url).pathname.endsWith("/users/batch")
      ? Response.json({ users: [{ uid: "sender_bot", name: "Named", robot: null }] })
      : Response.json({ group_no: "group", name: "Engineering" })
  );
  const group = await run({
    ...message,
    channelId: "group",
    channelType: 2,
    fromUid: "sender_bot"
  });
  assert.deepEqual(group.payload.sender, { uid: "sender_bot", name: "Named", type: "unknown" });
  assert.deepEqual(group.payload.conversation, {
    id: "group",
    type: "group",
    group: { id: "group", name: "Engineering" }
  });
  const direct = await run({ ...message, channelId: "sender", channelType: 1, payload: {} });
  assert.deepEqual(direct.payload.conversation, { id: "sender", type: "dm" });
  assert.deepEqual(direct.payload.mentions, { targets: [] });
});

test("names must match requested IDs; missing time is null and never processing time", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) =>
    new URL(url).pathname.endsWith("/users/batch")
      ? Response.json({ users: [{ uid: "another", name: "Wrong", robot: false }] })
      : Response.json({
          group_no: "another-group",
          short_id: "another-topic",
          group_name: "Wrong",
          name: "Wrong"
        })
  );
  for (const timestamp of [undefined, 0, -1, NaN, 1793232000000]) {
    const item = await run({ ...message, timestamp });
    assert.equal(item.payload.sentAt, null);
    assert.deepEqual(item.payload.sender, { uid: "sender", name: null, type: "unknown" });
    assert.equal(item.payload.conversation.group.name, null);
    assert.equal(item.payload.conversation.topic.name, null);
  }
});

test("only actual mention flags are normalized; all target UIDs survive bounded identity lookup", async (t) => {
  const uids = Array.from({ length: 205 }, (_, index) => `user-${index}`);
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (new URL(url).pathname.endsWith("/users/batch")) {
      const requested = JSON.parse(options.body).uids;
      assert.equal(requested.length, 200);
      return Response.json({ users: requested.map((uid) => ({ uid, name: uid, robot: true })) });
    }
    return Response.json({});
  });
  const item = await run({
    ...message,
    payload: {
      mention: {
        uids: [...uids, null, 42, uids[0]],
        ais: 1,
        all: true,
        humans: 2
      }
    }
  });
  assert.equal(item.payload.mentions.targets.length, 205);
  assert.equal(item.payload.mentions.targets[0].type, "bot");
  assert.equal(item.payload.mentions.targets[204].name, null);
  assert.equal(item.payload.mentions.allBots, true);
  assert.equal(item.payload.mentions.allMembers, true);
  assert.equal(item.payload.mentions.allHumans, undefined);
});

test("HTTP failures leave real IDs, preserve independent scope data, and never retry or fall back", async (t) => {
  let status = 404;
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    const path = new URL(url).pathname;
    calls.push(path);
    if (path.endsWith("/users/batch")) return Response.json({}, { status });
    return Response.json({ group_no: "group", short_id: "topic", name: "Release" });
  });
  for (status of [404, 403, 429, 500]) {
    calls.length = 0;
    const item = await run();
    assert.deepEqual(item.payload.sender, { uid: "sender", name: null, type: "unknown" });
    assert.equal(item.payload.conversation.topic.name, "Release");
    assert.deepEqual(calls.sort(), [
      "/api/v1/bot/groups/group/threads/topic",
      "/api/v1/bot/users/batch"
    ]);
  }
});

test("transport and malformed JSON failures are optional independently of identity resolution", async (t) => {
  let mode = "network";
  t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url).endsWith("/users/batch")) return Response.json({ users: people });
    if (mode === "network") throw new TypeError("network unavailable");
    return new Response("not JSON");
  });
  for (mode of ["network", "invalid-json"]) {
    const item = await run();
    assert.deepEqual(item.payload.sender, { uid: "sender", name: "Alice", type: "human" });
    assert.equal(item.payload.conversation.group.name, null);
    assert.equal(item.payload.conversation.topic.name, null);
  }
});

test("optional enrichment timeout degrades, while external cancellation propagates", async (t) => {
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  t.mock.method(AbortSignal, "timeout", (ms) => timeout(ms === 5000 ? 20 : ms));
  t.mock.method(
    globalThis,
    "fetch",
    async (_url, { signal }) =>
      new Promise((resolve, reject) => {
        if (signal.aborted) reject(signal.reason);
        else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      })
  );
  // AbortSignal.timeout 不维持事件循环；保留一个有界计时器等待可选查询超时。
  const keepAlive = setTimeout(() => {}, 1000);
  t.after(() => clearTimeout(keepAlive));
  assert.equal((await run()).payload.sender.name, null);
  const controller = new AbortController();
  const pending = run(message, controller.signal);
  controller.abort(new Error("cancelled by user"));
  await assert.rejects(pending, /cancelled by user/);
});
