import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { build_im_contexts } from "../packages/octo-runtime-extra-channel-gateway/dist/transport/contexts.js";
import {
  planHistoryGap,
  historyGapContext,
  compactHistoryGap
} from "../packages/octo-runtime-extra-channel-gateway/dist/application/context-gap.js";
import { renderModelContexts } from "../packages/octo-runtime-executor-core/dist/model-input.js";
const historyGuidance = "This data contains bounded earlier messages from the current channel.";
const gapGuidance =
  "This data describes the range, availability, and omissions of channel history for the current turn.";

for (const channelType of [1, 2, 5]) {
  test(`history guidance evaluated for channel type ${channelType} reaches the model with bounded material`, async (context) => {
    const calls = [];
    context.mock.method(globalThis, "fetch", async (url, options) => {
      if (!String(url).endsWith("/messages/sync")) return Response.json({}, { status: 404 });
      calls.push(JSON.parse(options.body));
      return Response.json({
        more: 0,
        messages: [
          {
            from_uid: "Alice",
            message_id: "pending",
            message_seq: 1,
            payload: { type: 1, content: "7+5?" }
          },
          {
            from_uid: "Bob",
            message_id: "correction",
            message_seq: 2,
            payload: { type: 1, content: "Correction: 7+6?" }
          },
          {
            from_uid: "Carol",
            message_id: "future",
            message_seq: 4,
            payload: { type: 1, content: "FUTURE_NOT_VISIBLE" }
          }
        ]
      });
    });
    const channelId = channelType === 5 ? "group____topic" : "group";
    const config = {
      api_url: "https://im-test.deepminer.com.cn/api",
      bot_id: "bot",
      spaceId: "synthetic",
      adapter: { adapter_type: "codex", workdir: process.cwd() }
    };
    const items = await build_im_contexts(
      config,
      {
        channelId,
        channelType,
        messageId: "trigger",
        messageSeq: 3,
        fromUid: "Carol",
        payload: { type: 1, content: "@bot" }
      },
      randomUUID(),
      new AbortController().signal,
      {
        initialSession: channelType === 1,
        historyGap: channelType === 1 ? undefined : planHistoryGap(3, undefined, "epoch")
      }
    );
    assert.deepEqual(calls, [
      {
        channel_id: channelId,
        channel_type: channelType,
        limit: 20,
        start_message_seq: 2,
        end_message_seq: 0,
        pull_mode: 0
      }
    ]);
    const history = items.find((item) => item.name === "history");
    assert.equal(history.guidance, historyGuidance);
    assert.deepEqual(history.payload.messages, [
      { uid: "Alice", username: null, sentAt: null, content: { type: "text", text: "7+5?" } },
      {
        uid: "Bob",
        username: null,
        sentAt: null,
        content: { type: "text", text: "Correction: 7+6?" }
      }
    ]);
    assert.deepEqual(history.payload.range, { beforeSeq: 3 });
    assert.equal(history.payload.truncated, false);
    const rendered = renderModelContexts({ schema: "octo.context-envelope/v3", items });
    assert.ok(rendered.includes(`<guidence>${historyGuidance}</guidence>`));
    assert.doesNotMatch(rendered, /FUTURE_NOT_VISIBLE/);
    const gap = items.find((item) => item.name === "history-gap");
    if (channelType === 1) assert.equal(gap, undefined);
    else {
      assert.equal(gap.guidance, gapGuidance);
      const compact = compactHistoryGap(gap);
      assert.ok(compact);
      assert.equal(compact.guidance, gapGuidance);
      for (const key of [
        "source",
        "status",
        "range",
        "trigger",
        "materialProvided",
        "earlierOmitted"
      ])
        assert.deepEqual(compact.payload[key], gap.payload[key]);
      assert.ok(Buffer.byteLength(JSON.stringify(compact)) <= 1024);
    }
  });
}

test("compact history guidance preserves failure facts within its existing byte budget", () => {
  const source = {
    service: "https://im-test.deepminer.com.cn/api",
    spaceId: "space",
    botId: "bot",
    channelId: "group____topic",
    channelType: 5
  };
  for (const retrieval of ["provided", "partial", "unavailable", "omitted", "empty"]) {
    const full = historyGapContext(source, "trigger", {
      mode: "bootstrap",
      beforeSeq: 10,
      retrieval,
      earlierOmitted: true,
      reason: "unknown-baseline",
      messageLimit: 20
    });
    const compact = compactHistoryGap(full);
    assert.ok(compact);
    assert.equal(compact.payload.status, retrieval);
    assert.equal(compact.payload.materialProvided, ["provided", "partial"].includes(retrieval));
    assert.equal(compact.payload.earlierOmitted, true);
    assert.ok(Buffer.byteLength(JSON.stringify(full)) <= 4096);
    assert.ok(Buffer.byteLength(JSON.stringify(compact)) <= 1024);
    assert.ok(Buffer.byteLength(JSON.stringify(compact)) < Buffer.byteLength(JSON.stringify(full)));
  }
});
