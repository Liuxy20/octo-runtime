// 手动专项：构建 Gateway 后 node --test test/manual/im-registration-url.test.mjs。
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import { ImRuntime } from "../../packages/octo-runtime-extra-channel-gateway/dist/application/im-channel.js";
import {
  validateImConfig,
  imBotIdentity
} from "../../packages/octo-runtime-extra-channel-gateway/dist/lifecycle/configuration.js";
import { getJson } from "../../packages/octo-runtime-extra-channel-gateway/dist/transport/api/client.js";

function handshake() {
  const string = (value) => {
    const bytes = Buffer.from(value);
    const length = Buffer.alloc(2);
    length.writeUInt16BE(bytes.length);
    return Buffer.concat([length, bytes]);
  };
  const key = generateKeyPairSync("x25519")
    .publicKey.export({ format: "der", type: "spki" })
    .subarray(-32)
    .toString("base64");
  const body = Buffer.concat([
    Buffer.alloc(8),
    Buffer.from([1]),
    string(key),
    string(randomUUID().replaceAll("-", "").slice(0, 16))
  ]);
  return Buffer.concat([Buffer.from([0x20, body.length]), body]);
}

for (const prefix of ["", "/api"]) {
  for (const slashes of [0, 1, 2, 3]) {
    test(`Gateway canonical routes: ${prefix || "root"}, ${slashes} trailing slashes`, async (t) => {
      const paths = [];
      const botId = randomUUID();
      let baseUrl;
      const http = createServer(async (req, res) => {
        for await (const _chunk of req) {
          // 消费请求体以正常复用连接；不记录凭据。
        }
        paths.push([req.method, req.url]);
        const route = req.url;
        const data =
          route === `${prefix}/v1/auth/verify-bot`
            ? { bot_uid: botId, space_id: "local-space" }
            : route === `${prefix}/v1/bot/register`
              ? {
                  robot_id: botId,
                  im_token: randomUUID(),
                  ws_url: baseUrl.replace("http:", "ws:")
                }
              : route === `${prefix}/v1/bot/user/info?uid=local-owner`
                ? { uid: "local-owner" }
                : undefined;
        // 按原始路径严格匹配，不能用服务端斜杠归并掩盖错误请求。
        res.writeHead(data ? 200 : 404, { "Content-Type": "application/json" });
        res.end(JSON.stringify(data ?? {}));
      });
      const ws = new WebSocketServer({ server: http });
      ws.on("connection", (peer) => peer.once("message", () => peer.send(handshake())));
      let runtime;
      t.after(async () => {
        try {
          await runtime?.close();
        } finally {
          for (const peer of ws.clients) peer.terminate();
          await new Promise((resolve) => ws.close(resolve));
          const closed = new Promise((resolve) => http.close(resolve));
          http.closeAllConnections();
          await closed;
        }
      });
      http.listen(0, "127.0.0.1");
      await once(http, "listening");
      baseUrl = `http://127.0.0.1:${http.address().port}`;
      const config = {
        bot_id: botId,
        api_url: `${baseUrl}${prefix}${"/".repeat(slashes)}`,
        bf_token: `bf_${randomUUID()}`,
        adapter: { adapter_type: "codex", workdir: process.cwd() },
        cards: false,
        typing: false
      };
      validateImConfig(config);
      assert.equal(
        imBotIdentity(config),
        imBotIdentity({ ...config, api_url: `${baseUrl}${prefix}` })
      );
      runtime = new ImRuntime(config, { kernel: {} });
      await runtime.start();
      assert.equal(runtime.status.error, null);
      assert.equal(runtime.status.state, "online");
      assert.equal(runtime.status.connected, true);
      const info = await getJson(
        config.api_url,
        config.bf_token,
        "/v1/bot/user/info?uid=local-owner"
      );
      assert.equal(info.uid, "local-owner");
      assert.deepEqual(paths, [
        ["POST", `${prefix}/v1/auth/verify-bot`],
        ["POST", `${prefix}/v1/bot/register`],
        ["GET", `${prefix}/v1/bot/user/info?uid=local-owner`]
      ]);
      await runtime.close();
      assert.equal(runtime.status.state, "stopped");
    });
  }
}
