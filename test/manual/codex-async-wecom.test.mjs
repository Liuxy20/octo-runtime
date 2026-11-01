// 专项显式运行，不加入默认 CI；本地 WebSocket 不代表真实企微平台验收。
import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocketServer } from "ws";
import { ImRuntime } from "../../packages/octo-runtime-extra-channel-wecom/dist/index.js";

async function until(predicate) {
  for (let i = 0; i < 300; i++) {
    if (predicate()) return;
    await delay(10);
  }
  assert.fail("local WeCom fixture timed out");
}

for (const sync of [false, true])
  test(`WeCom ignores async controls, keeps text and synchronous responses: sync=${sync}`, async (t) => {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await once(server, "listening");
    const frames = [],
      responses = [];
    let socket, release;
    const answered = new Promise((resolve) => {
      release = resolve;
    });
    server.on("connection", (ws) => {
      socket = ws;
      ws.on("message", (data) => {
        const frame = JSON.parse(data.toString());
        frames.push(frame);
        ws.send(JSON.stringify({ headers: frame.headers, errcode: 0, errmsg: "ok" }));
      });
    });
    let cancellations = 0;
    const runtime = new ImRuntime(
      {
        enabled: true,
        bot_id: "async-wecom",
        app_secret: randomUUID(),
        ws_url: `ws://127.0.0.1:${server.address().port}`,
        adapter: { adapter_type: "codex", workdir: process.cwd() }
      },
      {
        kernel: {
          async cancelInvocation() {
            cancellations++;
            return { accepted: true };
          },
          async respondInteraction(...args) {
            responses.push(args);
            release();
          },
          async *invoke() {
            yield { type: "run.started", payload: {} };
            if (sync)
              yield {
                type: "interaction.requested",
                payload: {
                  interactionId: "sync",
                  kind: "question",
                  executionInstanceId: "invoke",
                  expiresAt: new Date(Date.now() + 60000).toISOString(),
                  request: { question: "Synchronous question" }
                }
              };
            for (const expiresAt of [undefined, new Date(Date.now() + 60000).toISOString()]) {
              yield {
                type: "interaction.requested",
                payload: {
                  interactionId: "codex:async:fixture",
                  kind: "question",
                  delivery: "async",
                  executionInstanceId: "invoke",
                  ...(expiresAt ? { expiresAt } : {}),
                  request: {
                    schema: "octo.question-request/v1",
                    messageId: "native-message",
                    questions: [
                      {
                        id: "q:0",
                        title: "Optional color?",
                        options: null,
                        allowCustom: true,
                        isSecret: true
                      }
                    ]
                  }
                }
              };
            }
            yield {
              type: "interaction.resolved",
              payload: {
                interactionId: "codex:async:fixture",
                status: "invalidated",
                reasonCode: "run_terminal"
              }
            };
            if (sync) {
              await answered;
              yield {
                type: "interaction.resolved",
                payload: {
                  interactionId: "sync",
                  status: "resolved",
                  outcome: "answered"
                }
              };
            }
            yield {
              type: "message.update",
              payload: {
                messageId: "native-message",
                channel: "final",
                role: "assistant",
                delivery: "async",
                text: "Optional color?",
                questions: [{ title: "Optional color?", options: null }]
              }
            };
            yield { type: "run.completed", payload: {} };
          }
        }
      }
    );
    t.after(async () => {
      release();
      await runtime.close();
      for (const client of server.clients) client.terminate();
      await new Promise((resolve) => server.close(resolve));
    });
    await runtime.start();
    const send = (id, text) =>
      socket.send(
        JSON.stringify({
          cmd: "aibot_msg_callback",
          headers: { req_id: id },
          body: {
            msgid: id,
            aibotid: "async-wecom",
            chattype: "single",
            from: { userid: "owner" },
            msgtype: "text",
            text: { content: text }
          }
        })
      );
    send("start", "test");
    if (sync) {
      await until(() => JSON.stringify(frames).includes("/respond sync"));
      send("response", "/respond sync Blue");
    }
    await until(() =>
      frames.some(
        (frame) =>
          frame.headers?.req_id === "start" &&
          frame.body?.stream?.finish &&
          frame.body.stream.content.includes("Optional color?")
      )
    );
    assert.doesNotMatch(JSON.stringify(frames), /\/respond codex:async|等待你的确认/);
    assert.equal(cancellations, 0, "ignored async secret input cannot cancel the run");
    assert.equal(responses.length, sync ? 1 : 0);
    if (sync) assert.ok(JSON.stringify(responses).includes("Blue"));
  });
