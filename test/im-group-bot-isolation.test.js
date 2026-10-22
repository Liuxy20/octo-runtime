// 真实 Gateway 准入与 ImRuntime 调度共用；仅替换网络边界和 Provider。
import test from "node:test";
import assert from "node:assert/strict";
import { ImRuntime } from "../packages/octo-runtime-extra-channel-gateway/dist/index.js";
import { WukongConnection } from "../packages/octo-runtime-extra-channel-gateway/dist/transport/wukong.js";
import { waitFor } from "./runtime-fixture.js";

for (const fromUid of ["non-owner-user", "non-owner-bot"]) {
  for (const [channelType, channelId] of [
    [2, "group"],
    [5, "group____topic"]
  ]) {
    test(`${fromUid} can mention one of five bots; stop and reset stay within channel ${channelType}`, async (t) => {
      const botIds = ["bot-A", "bot-B", "bot-C", "bot-D", "bot-E"];
      const wires = new Map(),
        calls = new Map(),
        pending = new Map();
      const diagnostics = [],
        cancellations = [],
        replies = [],
        runtimes = [];
      t.mock.method(globalThis, "fetch", async (url, options) => {
        const token = url.endsWith("/auth/verify-bot")
          ? JSON.parse(options.body).bot_token
          : new Headers(options.headers).get("Authorization").slice("Bearer ".length);
        const botId = token.slice("bf_".length);
        if (url.endsWith("/auth/verify-bot"))
          return Response.json({ bot_uid: botId, space_id: "space" });
        if (url.endsWith("/bot/register"))
          return Response.json({
            robot_id: botId,
            owner_uid: "registered-owner",
            owner_channel_id: "registered-owner",
            ws_url: "wss://im-test.deepminer.com.cn/ws",
            im_token: "fixture"
          });
        if (url.endsWith("/md")) return new Response(null, { status: 404 });
        if (url.endsWith("/readReceipt")) return Response.json({});
        throw new Error(`unexpected fixture request: ${url}`);
      });
      t.mock.method(WukongConnection.prototype, "connect", async function (registration) {
        wires.set(registration.robot_id, this);
      });
      t.mock.getter(WukongConnection.prototype, "connected", () => true);
      t.mock.method(WukongConnection.prototype, "close", async () => {});
      t.mock.method(WukongConnection.prototype, "sendText", async function (id, type, text) {
        replies.push({ botId: [...wires].find(([, wire]) => wire === this)[0], id, type, text });
        return `reply-${replies.length}`;
      });
      t.after(async () => {
        const results = await Promise.allSettled(runtimes.map((runtime) => runtime.close()));
        assert.deepEqual(
          results.filter((result) => result.status === "rejected"),
          []
        );
      });
      for (const botId of botIds) {
        calls.set(botId, []);
        const runtime = new ImRuntime(
          {
            bot_id: botId,
            api_url: "https://im-test.deepminer.com.cn/api",
            bf_token: `bf_${botId}`,
            cards: false,
            typing: false,
            adapter: { adapter_type: "codex", workdir: process.cwd() }
          },
          {
            onDiagnostic: (code) => diagnostics.push(code),
            kernel: {
              async *invoke(input) {
                calls.get(botId).push(input);
                if (calls.get(botId).length === 1) {
                  await new Promise((resolve) =>
                    pending.set(input.invocationId, { botId, resolve })
                  );
                  yield { protocolVersion: 2, type: "run.cancelled", payload: {} };
                } else yield { protocolVersion: 2, type: "run.completed", payload: {} };
              },
              async cancelInvocation(id) {
                const entry = pending.get(id);
                assert.equal(entry?.botId, botId);
                cancellations.push(botId);
                pending.delete(id);
                entry.resolve();
                return { accepted: true };
              },
              async respondInteraction() {}
            }
          }
        );
        runtimes.push(runtime);
        await runtime.start();
        assert.equal(runtime.status.connected, true);
      }
      let sequence = 0;
      const send = (content, uids) => {
        const incoming = {
          messageId: `message-${++sequence}`,
          channelId,
          channelType,
          fromUid,
          payload: { type: 1, content, space_id: "space", mention: { uids } }
        };
        for (const wire of wires.values()) wire.onMessage(incoming);
      };
      // 显式点名五个 Bot 建立五个独立在途任务，随后只点名 B。
      send("long task", botIds);
      await waitFor(() => {
        assert.deepEqual(
          diagnostics.filter((code) => code !== "IM_CARD_UNAVAILABLE"),
          []
        );
        return pending.size === 5;
      });
      const originals = runtimes.map((runtime) => structuredClone(runtime.status.sessions));
      send("/reset", ["bot-B"]);
      await waitFor(() =>
        replies.some((reply) => reply.botId === "bot-B" && reply.text === "会话已经重置")
      );
      assert.deepEqual(cancellations, [], "reset must not cancel an active Run");
      assert.equal(runtimes[1].status.sessions[0].generation, 2);
      for (const index of [0, 2, 3, 4])
        assert.deepEqual(runtimes[index].status.sessions, originals[index]);
      send("/stop", ["bot-B"]);
      await waitFor(() => runtimes[1].status.sessions.length === 0);
      assert.deepEqual(cancellations, ["bot-B"]);
      assert.equal(pending.size, 4);
      send("after reset", ["bot-B"]);
      await waitFor(
        () => calls.get("bot-B").length === 2 && runtimes[1].status.sessions.length === 0
      );
      const [before, after] = calls.get("bot-B");
      assert.notEqual(after.sessionId, before.sessionId);
      assert.equal(after.sessionGeneration, 2);
      for (const index of [0, 2, 3, 4]) {
        assert.equal(calls.get(botIds[index]).length, 1);
        assert.deepEqual(runtimes[index].status.sessions, originals[index]);
      }
      assert.ok(replies.every((reply) => reply.botId === "bot-B"));
      assert.ok(replies.every((reply) => reply.id === channelId && reply.type === channelType));
    });
  }
}
