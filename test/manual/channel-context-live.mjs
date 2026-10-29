import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { build_im_contexts } from "../../packages/octo-runtime-extra-channel-gateway/dist/transport/contexts.js";
import { createImInvocation } from "../../packages/octo-runtime-extra-channel-gateway/dist/execution/dispatcher.js";
import { getChannelMessagePage } from "../../packages/octo-runtime-extra-channel-gateway/dist/transport/api/conversations.js";
import { getJson } from "../../packages/octo-runtime-extra-channel-gateway/dist/transport/api/client.js";
import { buildMessageTrigger } from "../../packages/octo-runtime-extra-channel-gateway/dist/transport/message-trigger.js";

// 只读测试环境 API；凭据仅从操作者指定文件读取，不打印消息正文或凭据。
const [accountPath, keyPath] = process.argv.slice(2);
assert.ok(
  accountPath && keyPath,
  "usage: node test/manual/channel-context-live.mjs <account.md> <user-key.json>"
);
const account = await readFile(accountPath, "utf8");
const key = JSON.parse(await readFile(keyPath, "utf8"));
const origin = new URL(key.server_url).origin;
assert.equal(origin, "https://im-test.deepminer.com.cn");
const credentials = [...account.matchAll(/Bot ID: (\S+)\s+Bot Token: (bf_\w+)/g)].map((match) => ({
  id: match[1],
  token: match[2]
}));
assert.ok(credentials.length >= 2);
function cli(token, args) {
  const output = execFileSync("octo-cli", [...args, "--timeout", "15s", "--no-retry"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      OCTO_TOKEN: token,
      OCTO_BOT_TOKEN: token,
      OCTO_API_BASE_URL: origin,
      OCTO_CREDENTIAL_MODE: ""
    }
  });
  const result = JSON.parse(output);
  assert.equal(result.ok, true);
  return result.data;
}
const { id: botId, token } = credentials[0];
const actor = cli(token, ["bot", "user-info", "--uid", credentials[1].id]);
assert.equal(actor.uid, credentials[1].id);
const groups = cli(token, ["group", "list"]);
assert.ok(Array.isArray(groups) && groups.length > 0);
const group = groups[0];
const scope = group.space_id ?? key.space_id;
const page = await getChannelMessagePage({
  apiUrl: `${origin}/api`,
  botToken: token,
  channelId: group.group_no,
  channelType: 2,
  limit: 1,
  startMessageSeq: 0,
  endMessageSeq: 0,
  pullMode: 0,
  signal: AbortSignal.timeout(15000),
  retryOn429: false
});
const latest = Math.max(0, ...page.messages.map((message) => message.message_seq));
const messageId = randomUUID();
const config = {
  bot_id: botId,
  api_url: `${origin}/api`,
  spaceId: scope,
  adapter: { adapter_type: "codex", workdir: process.cwd() }
};
const items = await build_im_contexts(
  config,
  {
    channelId: group.group_no,
    channelType: 2,
    messageId,
    messageSeq: latest + 1,
    fromUid: actor.uid,
    timestamp: Math.floor(page.messages[0]?.timestamp / 1000),
    payload: { type: 1, content: "context verification", mention: { uids: [botId] } }
  },
  token,
  AbortSignal.timeout(15000),
  { initialSession: true }
);
const trigger = items.find((item) => item.name === "message-trigger");
assert.equal(trigger.payload.sender.uid, actor.uid);
assert.equal(trigger.payload.sender.name, actor.name);
assert.equal(trigger.payload.sender.type, "bot");
assert.equal(trigger.payload.recipient.botId, botId);
assert.ok(trigger.payload.recipient.name);
assert.deepEqual(
  trigger.payload.mentions.targets.map((target) => target.uid),
  [botId]
);
assert.equal(trigger.payload.mentions.targets[0].type, "bot");
assert.equal(trigger.payload.conversation.type, "group");
assert.equal(trigger.payload.conversation.id, group.group_no);
assert.equal(trigger.payload.conversation.group.id, group.group_no);
assert.equal(trigger.payload.conversation.group.name, group.name);
if (page.messages[0]?.timestamp) {
  assert.match(trigger.payload.sentAt, /[+-]\d{2}:\d{2}$/);
  assert.equal(Date.parse(trigger.payload.sentAt), page.messages[0].timestamp);
} else assert.equal(trigger.payload.sentAt, null);
assert.equal(trigger.guidance.split("\n").length, 1);
assert.ok(items.some((item) => item.name === "group-rules"));
let humanIdentity = false;
let topicIdentity = false;
for (const candidate of groups.slice(0, 5)) {
  const prefix = `/v1/bot/groups/${encodeURIComponent(candidate.group_no)}`;
  const [members, topics] = await Promise.all([
    getJson(config.api_url, token, `${prefix}/members`, AbortSignal.timeout(15000), {
      retryOn429: false
    }),
    getJson(config.api_url, token, `${prefix}/threads`, AbortSignal.timeout(15000), {
      retryOn429: false
    })
  ]);
  const human = members.find((member) => member.robot === 0 || member.robot === false);
  const topic = topics?.[0];
  if (human && !humanIdentity) {
    const actual = await buildMessageTrigger(
      config,
      {
        channelId: candidate.group_no,
        channelType: 2,
        messageId,
        fromUid: human.uid,
        timestamp: 1793232000,
        payload: {}
      },
      token,
      AbortSignal.timeout(15000)
    );
    assert.deepEqual(actual.payload.sender, { uid: human.uid, name: human.name, type: "human" });
    humanIdentity = true;
  }
  if (topic && !topicIdentity) {
    const actual = await buildMessageTrigger(
      config,
      {
        channelId: topic.channel_id,
        channelType: 5,
        messageId,
        fromUid: actor.uid,
        timestamp: 1793232000,
        payload: {}
      },
      token,
      AbortSignal.timeout(15000)
    );
    assert.equal(actual.payload.conversation.type, "group_topic");
    assert.equal(actual.payload.conversation.id, `${candidate.group_no}____${topic.short_id}`);
    assert.equal(actual.payload.conversation.group.id, candidate.group_no);
    assert.equal(actual.payload.conversation.group.name, candidate.name);
    assert.deepEqual(actual.payload.conversation.topic, { id: topic.short_id, name: topic.name });
    topicIdentity = true;
  }
  if (humanIdentity && topicIdentity) break;
}
const session = { id: randomUUID(), generation: 1 };
const message = {
  messageId,
  senderId: actor.uid,
  conversationId: group.group_no,
  text: "context verification"
};
const context = { schema: "octo.context-envelope/v3", items };
const first = createImInvocation(
  config,
  message,
  context,
  "live-read-only",
  session,
  AbortSignal.timeout(15000),
  messageId,
  true
);
const resumed = createImInvocation(
  config,
  message,
  context,
  "live-read-only",
  { ...session, providerSession: { sessionId: "carrier-verification", resumable: true } },
  AbortSignal.timeout(15000),
  messageId,
  false
);
assert.ok(first.request.contexts.items.some((item) => item.name === "artifact-delivery"));
assert.equal(
  resumed.request.contexts.items.some((item) => item.name === "artifact-delivery"),
  false
);
assert.ok(resumed.request.contexts.items.some((item) => item.name === "message-trigger"));
cli(key.api_key, ["message", "search", "--keyword", "orbtex", "--page-size", "1"]);
console.log(
  JSON.stringify(
    {
      environment: origin,
      verifiedActor: true,
      verifiedBotIdentity: true,
      verifiedHumanIdentity: humanIdentity,
      verifiedTopicIdentity: topicIdentity,
      groupDiscovery: true,
      groupRuleRead: true,
      historyApiRead: true,
      userKeySearch: true,
      firstTurnStableRules: true,
      ordinaryTurnOmission: true,
      currentActorPreserved: true,
      messagesSent: 0,
      modelRunsStarted: 0
    },
    null,
    2
  )
);
