import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate as settle } from "node:timers/promises";
import { readFile } from "node:fs/promises";
import { prepareFinalMention } from "../packages/octo-runtime-extra-channel-gateway/dist/transport/mentions.js";
import { GatewayTransport } from "../packages/octo-runtime-extra-channel-gateway/dist/transport/channel.js";
import { WukongConnection } from "../packages/octo-runtime-extra-channel-gateway/dist/transport/wukong.js";
import { ImRuntime } from "../packages/octo-runtime-extra-channel-gateway/dist/index.js";
import { acceptsImMessage } from "../packages/octo-runtime-extra-channel-gateway/dist/transport/normalize.js";

const members = [
  { uid: "u", name: "李白", robot: 0 },
  { uid: "bot", name: "机器人", robot: 1 }
];

test("only final Markdown text markers convert; examples, escapes and quotes remain verbatim", async () => {
  const examples = [
    "`@[u:李白]`",
    "`` @[u:李白] ``",
    "```md\n@[u:李白]\n```",
    "~~~text\n@[u:李白]\n~~~",
    "    @[u:李白]",
    "> @[u:李白]",
    "\\@[u:李白]",
    "<pre>@[u:李白]</pre>"
  ];
  for (const text of examples) {
    assert.deepEqual(
      await prepareFinalMention(text, () => {
        throw new Error("must not query");
      }),
      { text }
    );
  }
  let queries = 0;
  const text =
    "😀已完成，@[u:旧昵称] 与 @[u:李白]；@[bot:机器人]、@[missing:陌生人]。\n\n```\n@[u:李白]\n```";
  const result = await prepareFinalMention(text, async () => {
    queries++;
    return members;
  });
  assert.equal(queries, 1);
  assert.deepEqual(result.mention.uids, ["u", "bot"]);
  assert.equal(result.mention.entities.length, 3);
  assert.equal(result.mention.entities[0].offset, "😀已完成，".length);
  for (const entity of result.mention.entities)
    assert.equal(
      result.text.slice(entity.offset, entity.offset + entity.length),
      entity.uid === "u" ? "@李白" : "@机器人"
    );
  assert.ok(result.text.includes("@机器人、@陌生人"));
  assert.ok(result.text.endsWith("```\n@[u:李白]\n```"));
  assert.deepEqual(
    await prepareFinalMention("普通 @李白", async () => {
      throw new Error();
    }),
    { text: "普通 @李白" }
  );
});

test("identity lookup failure and unconfirmed member identity never block the final body or create broadcasts", async () => {
  for (const read of [
    async () => {
      throw new Error("403");
    },
    async () => [{ uid: "u", name: "李白" }],
    async () => [{ uid: "u", name: "李白", robot: 2 }],
    async () => [{ uid: "u", name: "李白", robot: "1" }],
    async () => null,
    async () => [null],
    async () => members.filter((m) => m.robot)
  ]) {
    assert.deepEqual(await prepareFinalMention("已完成 @[u:李白] @[missing:张三]", read), {
      text: "已完成 @李白 @张三"
    });
  }
  const text = "@[-1:全部] @[-2:真人] @[-3:所有AI] @[all:所有人]";
  const result = await prepareFinalMention(text, async () => [
    ...members,
    ...["-1", "-2", "-3", "all"].map((uid) => ({ uid, name: "broadcast", robot: 1 }))
  ]);
  assert.deepEqual(result, { text: "@全部 @真人 @所有AI @所有人" });
});

test("boolean human and bot flags are valid and mixed Unicode entity offsets remain exact", async () => {
  const result = await prepareFinalMention("😀 @[h:stale] 和 @[b:stale] @[b:again]", async () => [
    { uid: "h", name: "人😀", robot: false },
    { uid: "b", name: "Bot🤖", robot: true }
  ]);
  assert.deepEqual(result.mention.uids, ["h", "b"]);
  assert.deepEqual(result.mention.entities, [
    { uid: "h", offset: 3, length: 4 },
    { uid: "b", offset: 10, length: 6 },
    { uid: "b", offset: 17, length: 6 }
  ]);
  assert.equal(result.text, "😀 @人😀 和 @Bot🤖 @Bot🤖");
});

test("per-turn trigger example separates the actor from stable mention rules", async () => {
  const example = JSON.parse(
    await readFile(
      new URL(
        "../.octospec/tasks/234-context-lifecycle/turn-context.example.json",
        import.meta.url
      ),
      "utf8"
    )
  );
  assert.equal(example.items[0].name, "message-trigger");
  assert.equal(example.items[0].guidance.split("\n").length, 1);
  assert.equal(example.items[0].payload.sender.uid, "sender-uid");
  assert.deepEqual(
    example.items[0].payload.mentions.targets.map((target) => target.uid),
    ["bot-uid"]
  );
  assert.equal(
    example.items.some((item) => item.name === "mention-instructions"),
    false
  );
});

test("transport resolves topic members once and sends mention with final text on the original connection", async (t) => {
  let receive,
    queries = 0;
  const sends = [],
    admitted = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    if (url.endsWith("/auth/verify-bot"))
      return Response.json({ bot_uid: "sender-bot", space_id: "s" });
    if (url.endsWith("/bot/register"))
      return Response.json({
        robot_id: "sender-bot",
        owner_uid: "owner",
        owner_channel_id: "owner",
        ws_url: "wss://im-test.deepminer.com.cn/ws",
        im_token: "fixture"
      });
    if (url.endsWith("/groups/group/members")) {
      queries++;
      return Response.json({ members });
    }
    throw new Error("unexpected request");
  });
  t.mock.method(WukongConnection.prototype, "connect", async function () {
    receive = this.onMessage;
  });
  t.mock.getter(WukongConnection.prototype, "connected", () => true);
  t.mock.method(WukongConnection.prototype, "close", async () => {});
  t.mock.method(WukongConnection.prototype, "sendText", async function (...args) {
    sends.push(args);
    return "message";
  });
  const transport = new GatewayTransport(
    {
      bot_id: "sender-bot",
      api_url: "https://im-test.deepminer.com.cn/api",
      group_ids: ["group"],
      allowed_sender_ids: ["owner", "sender-bot"],
      adapter: { adapter_type: "codex" }
    },
    async () => "bf_fixture",
    { onMessage: (m) => admitted.push(m), onDisconnect() {} }
  );
  await transport.start(new AbortController().signal);
  t.after(() => transport.close());
  const message = {
    messageId: "m",
    fromUid: "owner",
    channelId: "group____topic",
    channelType: 5,
    messageSeq: 10,
    payload: { type: 1, content: "task", mention: { ais: 1 } }
  };
  receive(message);
  assert.equal(admitted.length, 1);
  await admitted[0].reply("@[u:李白]", "progress");
  assert.equal(queries, 0);
  await admitted[0].replyFinal("完成 @[u:李白]，@[bot:机器人] 请继续", "final:run");
  await admitted[0].replyFinal("完成 @[u:李白]，@[bot:机器人] 请继续", "final:run");
  assert.equal(queries, 1);
  assert.equal(sends[1][0], "group____topic");
  assert.equal(sends[1][1], 5);
  assert.equal(sends[1][2], "完成 @李白，@机器人 请继续");
  assert.deepEqual(sends[1][5], {
    uids: ["u", "bot"],
    entities: [
      { uid: "u", offset: 3, length: 3 },
      { uid: "bot", offset: 7, length: 4 }
    ]
  });
  assert.equal(sends[0][5], undefined);
  const handoff = {
    ...message,
    messageId: "handoff",
    fromUid: "sender-bot",
    payload: { type: 1, content: sends[1][2], mention: sends[1][5] }
  };
  const recipient = {
    bot_id: "bot",
    spaceId: "s",
    group_ids: ["group"]
  };
  assert.equal(acceptsImMessage(recipient, handoff), true);
  assert.equal(acceptsImMessage({ ...recipient, allowed_sender_ids: ["owner"] }, handoff), false);
  receive({
    ...handoff,
    messageId: "self-mention",
    payload: { ...handoff.payload, mention: { uids: ["sender-bot"], ais: 1 } }
  });
  assert.equal(admitted.length, 1, "self-mentions must not reach AgentRun admission");
  receive({
    ...message,
    messageId: "ignored",
    payload: { type: 1, content: "```\n@bot @[bot:机器人]\n```" }
  });
  assert.equal(admitted.length, 1);
});

test("application uses final mention conversion only for successful final replies, not progress or failures", async (t) => {
  let receive,
    fail = false;
  t.mock.method(GatewayTransport.prototype, "start", async function () {
    receive = (m) => this.callbacks.onMessage(m);
  });
  t.mock.method(GatewayTransport.prototype, "close", async () => {});
  const normal = [],
    final = [];
  const runtime = new ImRuntime(
    {
      bot_id: "bot",
      api_url: "https://im-test.deepminer.com.cn/api",
      adapter: { adapter_type: "codex", workdir: process.cwd() }
    },
    {
      kernel: {
        async *invoke() {
          yield {
            protocolVersion: 2,
            type: "message.delta",
            payload: { channel: "analysis", text: "@[u:李白]" }
          };
          yield {
            protocolVersion: 2,
            type: "message.delta",
            payload: { channel: "final", text: "完成 @[u:李白]" }
          };
          yield fail
            ? {
                protocolVersion: 2,
                type: "run.failed",
                payload: { message: "@[u:李白] fixture failure" }
              }
            : { protocolVersion: 2, type: "run.completed", payload: {} };
        },
        async cancelInvocation() {
          return { accepted: false };
        },
        async respondInteraction() {}
      }
    }
  );
  await runtime.start();
  t.after(() => runtime.close());
  const message = {
    messageId: "m",
    text: "task",
    senderId: "owner",
    conversationId: "g",
    conversationKind: "group",
    async buildContext() {
      return { schema: "octo.context-envelope/v3", items: [] };
    },
    async reply(text) {
      normal.push(text);
    },
    async replyFinal(text) {
      final.push(text);
    }
  };
  receive(message);
  for (let i = 0; i < 40 && runtime.status.sessions.length; i++) await settle();
  assert.deepEqual(final, ["完成 @[u:李白]"]);
  assert.deepEqual(normal, []);
  fail = true;
  receive({ ...message, messageId: "failed" });
  for (let i = 0; i < 40 && runtime.status.sessions.length; i++) await settle();
  assert.deepEqual(final, ["完成 @[u:李白]"]);
  assert.equal(normal.length, 1, "failed terminal uses the ordinary reply path");
});
