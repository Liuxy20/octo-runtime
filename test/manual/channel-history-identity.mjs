import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  MessageIdentityCache,
  resolveMessageIdentities
} from "../../packages/octo-runtime-extra-channel-gateway/dist/transport/message-identities.js";
import { historyMessages } from "../../packages/octo-runtime-extra-channel-gateway/dist/transport/history-messages.js";
import {
  historyContent,
  historySenderUids
} from "../../packages/octo-runtime-extra-channel-gateway/dist/transport/history-content.js";
import { modelHistoryContexts } from "../../packages/octo-runtime-extra-channel-gateway/dist/application/history-context.js";
import { build_im_contexts } from "../../packages/octo-runtime-extra-channel-gateway/dist/transport/contexts.js";
import { createImInvocation } from "../../packages/octo-runtime-extra-channel-gateway/dist/execution/dispatcher.js";
import { getChannelMessagePage } from "../../packages/octo-runtime-extra-channel-gateway/dist/transport/api/conversations.js";
import {
  commitHistoryGap,
  gapMetadata,
  planHistoryGap
} from "../../packages/octo-runtime-extra-channel-gateway/dist/application/context-gap.js";

// 新增专项只手动运行，不加入默认 CI。
const config = {
  api_url: "https://fixture.invalid/api",
  bot_id: "bot",
  spaceId: "space",
  adapter: { adapter_type: "codex", workdir: process.cwd() }
};
const signal = () => new AbortController().signal;
const previousZone = process.env.TZ;
process.env.TZ = "Asia/Shanghai";
after(() => {
  if (previousZone === undefined) delete process.env.TZ;
  else process.env.TZ = previousZone;
});

test("identity cache expires at ten minutes without extending on read and isolates Bot/Space/API", async (t) => {
  let now = 0,
    requests = 0;
  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    requests++;
    return Response.json({
      users: JSON.parse(options.body).uids.map((uid) => ({
        uid,
        name: `name-${requests}`,
        robot: 0
      }))
    });
  });
  const cache = new MessageIdentityCache();
  const lookup = (scope = config) =>
    resolveMessageIdentities(scope, ["alice"], "bf_fixture", signal(), cache);
  assert.equal((await lookup()).get("alice").name, "name-1");
  now = 599_999;
  const hit = (await lookup()).get("alice");
  assert.equal(hit.name, "name-1");
  hit.name = "mutated";
  assert.equal((await lookup()).get("alice").name, "name-1");
  assert.equal(requests, 1);
  now = 600_000;
  assert.equal((await lookup()).get("alice").name, "name-2");
  for (const scope of [
    { ...config, bot_id: "other" },
    { ...config, spaceId: "other" },
    { ...config, api_url: "https://other.invalid/api" }
  ])
    assert.ok((await lookup(scope)).get("alice").name !== "name-2");
  assert.equal(requests, 5);
});

test("failed and absent identities are not cached; cached identities survive a later API failure", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests++;
    return requests === 2
      ? Response.json({ users: [{ uid: "alice", name: "Alice", robot: 0 }] })
      : Response.json({}, { status: 503 });
  });
  const cache = new MessageIdentityCache();
  assert.equal(
    (await resolveMessageIdentities(config, ["alice"], "bf_fixture", signal(), cache)).size,
    0
  );
  assert.equal(
    (await resolveMessageIdentities(config, ["alice"], "bf_fixture", signal(), cache)).get("alice")
      .name,
    "Alice"
  );
  const result = await resolveMessageIdentities(
    config,
    ["alice", "missing"],
    "bf_fixture",
    signal(),
    cache
  );
  assert.equal(result.get("alice").name, "Alice");
  assert.equal(result.has("missing"), false);
  await resolveMessageIdentities(config, ["missing"], "bf_fixture", signal(), cache);
  assert.equal(requests, 4);
});

test("memory cache is bounded and does not retain unknown-only results", () => {
  const cache = new MessageIdentityCache();
  cache.set(config, { uid: "unknown", name: null, type: "unknown" });
  assert.equal(cache.get(config, "unknown"), undefined);
  for (let i = 0; i <= 2000; i++)
    cache.set(config, { uid: `uid-${i}`, name: `User ${i}`, type: "human" });
  assert.equal(cache.get(config, "uid-0"), undefined);
  assert.equal(cache.get(config, "uid-1").name, "User 1");
  assert.equal(cache.get(config, "uid-2000").name, "User 2000");
});

test("history retains consecutive speakers, multiline text and identity during JSON/Unicode truncation", () => {
  const identities = new Map([["alice", { uid: "alice", name: "Alice", type: "human" }]]);
  const result = historyMessages(
    [
      { type: 1, from_uid: "alice", content: "newest\nline two" },
      { type: 1, from_uid: "alice", content: "another turn" },
      {
        type: 1,
        from_uid: "bob",
        timestamp: 1793252213000,
        content: '\n"😀'.repeat(2000) + "TAIL"
      },
      { type: 1, from_uid: "older", content: "not selected" }
    ],
    identities
  );
  assert.equal(result.truncated, true);
  assert.ok(Array.from(JSON.stringify(result.messages)).length <= 8000);
  assert.equal(result.messages[0].uid, "bob");
  assert.equal(result.messages[0].username, null);
  assert.equal(result.messages[0].sentAt, "2026-10-29T13:36:53.000+08:00");
  assert.equal(result.messages[0].truncated, true);
  assert.ok(result.messages[0].content.text.endsWith("TAIL"));
  assert.deepEqual(result.messages.slice(1), [
    {
      uid: "alice",
      username: "Alice",
      sentAt: null,
      content: { type: "text", text: "another turn" }
    },
    {
      uid: "alice",
      username: "Alice",
      sentAt: null,
      content: { type: "text", text: "newest\nline two" }
    }
  ]);
});

test("history converts API seconds to system-zone ISO and never substitutes processing time", async (t) => {
  let timestamp;
  t.mock.method(Date, "now", () => 1900000000000);
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({
      more: 0,
      messages: [{ from_uid: "alice", timestamp, payload: { type: 1, content: "earlier" } }]
    })
  );
  for (timestamp of [1793252213, undefined, null, 0, -1, 1.5, "1793252213", 1793252213000]) {
    const page = await getChannelMessagePage({
      apiUrl: config.api_url,
      botToken: "bf_fixture",
      channelId: "group",
      channelType: 2,
      signal: signal()
    });
    const valid = timestamp === 1793252213;
    assert.equal(page.messages[0].timestamp, valid ? 1793252213000 : null);
    assert.equal(
      historyMessages(page.messages).messages[0].sentAt,
      valid ? "2026-10-29T13:36:53.000+08:00" : null
    );
  }
});

test("message times follow the system zone, including fractional offsets and historical DST", () => {
  const module = new URL(
    "../../packages/octo-runtime-extra-channel-gateway/dist/transport/message-time.js",
    import.meta.url
  ).href;
  for (const [zone, expected] of [
    ["UTC", ["2026-01-15T12:00:00.000+00:00", "2026-07-15T12:00:00.000+00:00"]],
    ["Asia/Shanghai", ["2026-01-15T20:00:00.000+08:00", "2026-07-15T20:00:00.000+08:00"]],
    ["Asia/Kathmandu", ["2026-01-15T17:45:00.000+05:45", "2026-07-15T17:45:00.000+05:45"]],
    ["America/New_York", ["2026-01-15T07:00:00.000-05:00", "2026-07-15T08:00:00.000-04:00"]]
  ]) {
    const result = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import {messageSentAt} from ${JSON.stringify(module)}; console.log(JSON.stringify([Date.UTC(2026,0,15,12),Date.UTC(2026,6,15,12)].map(t=>messageSentAt(t,"milliseconds"))));`
      ],
      { env: { ...process.env, TZ: zone }, encoding: "utf8" }
    );
    assert.deepEqual(JSON.parse(result), expected);
  }
});

test("model history exposes messages and coverage only, while local handoff evidence clears pending gaps", async (t) => {
  const cache = new MessageIdentityCache();
  let identityRequests = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (String(url).endsWith("/users/batch")) {
      identityRequests++;
      return Response.json({
        users: JSON.parse(options.body).uids.map((uid) => ({
          uid,
          name: uid.toUpperCase(),
          robot: uid === "bot" ? 1 : 0
        }))
      });
    }
    if (String(url).endsWith("/messages/sync"))
      return Response.json({
        more: 0,
        messages: [
          {
            from_uid: "alice",
            message_id: "2",
            message_seq: 2,
            payload: { type: 1, content: "second" }
          },
          {
            from_uid: "alice",
            message_id: "1",
            message_seq: 1,
            payload: { type: 1, content: "first\ncontinued" }
          }
        ]
      });
    if (String(url).endsWith("/md")) return Response.json({ content: "", version: 1 });
    return Response.json({ group_no: "group", name: "Group" });
  });
  let plan;
  const build = () =>
    build_im_contexts(
      config,
      {
        channelId: "group",
        channelType: 2,
        messageId: "3",
        messageSeq: 3,
        fromUid: "alice",
        timestamp: 1793232000,
        payload: { type: 1, content: "current", mention: { uids: ["bot"] } }
      },
      "bf_fixture",
      signal(),
      {
        initialSession: false,
        historyGap: planHistoryGap(3, undefined, "epoch"),
        identityCache: cache,
        onHistoryGapPrepared: (value) => {
          plan = value;
        }
      }
    );
  const items = await build();
  assert.equal(identityRequests, 1, "history reuses current sender's cached name");
  const prepared = createImInvocation(
    config,
    {
      messageId: "3",
      senderId: "alice",
      conversationId: "group",
      text: "current"
    },
    { schema: "octo.context-envelope/v3", items },
    "scope",
    { id: "session", generation: 1 },
    signal()
  );
  const history = prepared.request.contexts.items.find((item) => item.name === "history");
  assert.deepEqual(history.payload, {
    messages: [
      {
        uid: "alice",
        username: "ALICE",
        sentAt: null,
        content: { type: "text", text: "first\ncontinued" }
      },
      { uid: "alice", username: "ALICE", sentAt: null, content: { type: "text", text: "second" } }
    ]
  });
  const gap = prepared.request.contexts.items.find((item) => item.name === "history-gap");
  assert.equal(gap, undefined);
  assert.doesNotMatch(
    JSON.stringify([history, gap]),
    /automatic|upperMessageSeq|source|trigger|beforeSeq|positionSpan/
  );
  assert.equal(prepared.historyContext.payload.upperMessageSeq, 3);
  const next = commitHistoryGap(
    { ...gapMetadata("epoch"), pendingAfterSeq: null },
    3,
    plan,
    prepared.historyContext
  );
  assert.equal(next.pendingAfterSeq, undefined);
  await build();
  assert.equal(identityRequests, 1, "subsequent turns reuse the ten-minute identity cache");
  const explicit = { namespace: "extra.im", name: "history", payload: { text: "host material" } };
  assert.strictEqual(modelHistoryContexts([explicit])[0], explicit);
});

test("history availability is a short note on history, with no independent automatic gap context", () => {
  const messages = [
    { uid: "alice", username: "Alice", sentAt: null, content: { type: "text", text: "earlier" } }
  ];
  const history = {
    namespace: "extra.im",
    name: "history",
    payload: { automatic: true, messages, upperMessageSeq: 10 }
  };
  for (const [status, earlierOmitted, note] of [
    ["provided", false, undefined],
    ["provided", true, "Some earlier messages are not included."],
    ["partial", false, "Some earlier messages are not included."],
    ["unavailable", false, "Earlier messages could not be retrieved."],
    ["omitted", false, "Earlier messages are not included."],
    ["empty", false, undefined]
  ]) {
    const gap = {
      namespace: "extra.im",
      name: "history-gap",
      payload: { automatic: true, status, earlierOmitted, source: { channelId: "group" } }
    };
    for (const items of [
      [history, gap],
      [gap, history]
    ]) {
      const projected = modelHistoryContexts(items);
      assert.equal(projected.length, 1);
      assert.equal(projected[0].name, "history");
      assert.deepEqual(projected[0].payload, { messages, ...(note ? { note } : {}) });
      assert.doesNotMatch(
        JSON.stringify(projected),
        /history-gap|automatic|upperMessageSeq|source|earlierOmitted/
      );
      assert.deepEqual(
        modelHistoryContexts(projected),
        projected,
        "frozen projection stays unchanged"
      );
    }
    const withoutMessages = modelHistoryContexts([gap]);
    assert.deepEqual(
      withoutMessages.map((item) => item.payload),
      note ? [{ messages: [], note }] : []
    );
    const explicit = { namespace: "extra.im", name: "history", payload: { text: "host material" } };
    assert.deepEqual(modelHistoryContexts([explicit, gap]), [explicit]);
  }
});

test("text, replies, forwards, rich text and media share typed content without flattening or downloads", () => {
  const identities = new Map([
    ["alice", { uid: "alice", name: "Alice", type: "human" }],
    ["bob", { uid: "bob", name: "Bob", type: "human" }]
  ]);
  const payloads = [
    {
      type: 1,
      content: "reply",
      reply: {
        from_uid: "bob",
        from_name: "FORGED",
        timestamp: 1793252213,
        payload: { type: 2, url: "im/quoted.png" }
      }
    },
    {
      type: 11,
      users: [{ uid: "bob", name: "FORGED" }],
      msgs: [
        { from_uid: "bob", timestamp: 1793252212, payload: { type: 1, content: "first" } },
        { from_uid: "bob", payload: { type: 2, url: "im/forward.png" } }
      ]
    },
    {
      type: 14,
      plain: "lossy fallback",
      content: [
        { type: "text", text: "before" },
        { type: "image", url: "im/rich.png" },
        { type: "text", text: "after" }
      ]
    },
    { type: 8, name: "report.pdf", url: "im/report.pdf" },
    { type: 18, doc_id: "document", title: "Report", url: "/docs/document" }
  ];
  const result = historyMessages(
    payloads.map((payload) => ({
      from_uid: "alice",
      type: payload.type,
      content: payload.content ?? "",
      payload
    })),
    identities
  );
  assert.equal(result.truncated, false);
  const bodies = result.messages.map((entry) => entry.content).reverse();
  assert.deepEqual(bodies[0], {
    type: "reply",
    quote: {
      uid: "bob",
      username: "Bob",
      sentAt: "2026-10-29T13:36:53.000+08:00",
      content: { type: "image", url: "im/quoted.png", read: false }
    },
    content: { type: "text", text: "reply" }
  });
  assert.deepEqual(bodies[1], {
    type: "forward",
    messages: [
      {
        uid: "bob",
        username: "Bob",
        sentAt: "2026-10-29T13:36:52.000+08:00",
        content: { type: "text", text: "first" }
      },
      {
        uid: "bob",
        username: "Bob",
        sentAt: null,
        content: { type: "image", url: "im/forward.png", read: false }
      }
    ]
  });
  assert.deepEqual(bodies[2], {
    type: "rich-text",
    blocks: [
      { type: "text", text: "before" },
      { type: "image", url: "im/rich.png", read: false },
      { type: "text", text: "after" }
    ]
  });
  assert.equal(bodies[3].type, "file");
  assert.equal(bodies[4].type, "document");
  assert.deepEqual(historySenderUids(payloads), ["bob"]);
  assert.doesNotMatch(JSON.stringify(result), /FORGED|lossy fallback/);
});

test("oversized structured content is explicitly omitted and nesting stays bounded", () => {
  let payload = { type: 1, content: "deep" };
  for (let i = 0; i < 20; i++) payload = { type: 11, msgs: [{ from_uid: "bob", payload }] };
  const nested = historyContent(payload, new Map());
  assert.equal(nested.truncated, true);
  assert.match(JSON.stringify(nested), /nesting-limit/);
  const { messages, truncated } = historyMessages([
    {
      type: 2,
      from_uid: "alice",
      timestamp: 1793252213000,
      content: "",
      payload: { type: 2, url: "im/" + "x".repeat(8100) }
    }
  ]);
  assert.equal(truncated, true);
  assert.deepEqual(messages, [
    {
      uid: "alice",
      username: null,
      sentAt: "2026-10-29T13:36:53.000+08:00",
      content: { type: "omitted", reason: "history-budget" },
      truncated: true
    }
  ]);
  assert.ok(Array.from(JSON.stringify(messages)).length <= 8000);
});
