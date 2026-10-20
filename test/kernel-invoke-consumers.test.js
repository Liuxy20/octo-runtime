import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ImRuntime } from "../packages/octo-runtime-extra-channel-gateway/dist/index.js";
import { GatewayTransport } from "../packages/octo-runtime-extra-channel-gateway/dist/transport/channel.js";
import { kernelFixture } from "./kernel-fixture.js";
import { kernelRelay } from "./kernel-relay.js";
import { waitFor } from "./runtime-fixture.js";

test("Gateway consumes actual Kernel invoke results for delivery; ACK loss executes Provider once", async (t) => {
  const f = await kernelFixture(t);
  const relay = await kernelRelay(t, f, {
    response(_v, c) {
      if (c.request.method === "agent_run.invoke") {
        c.disconnect();
        return false;
      }
    }
  });
  let receive;
  const replies = [],
    presentations = [];
  t.mock.method(GatewayTransport.prototype, "start", async function () {
    receive = this.callbacks.onMessage;
  });
  t.mock.method(GatewayTransport.prototype, "close", async () => {});
  const runtime = new ImRuntime(
    {
      bot_id: "kernel-consumer",
      api_url: "https://im-test.deepminer.com.cn/api",
      adapter: { adapter_type: "test", workdir: process.cwd() }
    },
    { kernel: relay.client }
  );
  await runtime.start();
  t.after(() => runtime.close());
  receive({
    messageId: "turn",
    senderId: "user",
    conversationId: "chat",
    conversationKind: "direct",
    text: "hello",
    buildContext: async () => ({ schema: "octo.context-envelope/v3", items: [] }),
    reply: async (text) => replies.push(text),
    beginPresentation: () => ({
      update: (snapshot) => presentations.push(snapshot),
      finish: async () => {}
    })
  });
  await waitFor(() => replies.length === 1);
  assert.equal(relay.count("agent_run.invoke"), 1);
  assert.ok(presentations.some((p) => p.terminal === "completed"));
  assert.match(replies[0], /Handled: hello/);
  assert.deepEqual(relay.client.invocations.snapshot(), []);
  const source = await readFile(
    "packages/octo-runtime-extra-channel-gateway/src/execution/task.ts",
    "utf8"
  );
  assert.doesNotMatch(source, /\.submit\(|\.subscribe\(|agent_run\./);
});
