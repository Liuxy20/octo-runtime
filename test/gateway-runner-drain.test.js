import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createExtraService } from "@mininglamp-oss/octo-runtime-host-sdk";
import * as drainGateway from "./fixtures/drain-gateway-extra.mjs";
import { kernelFixture, kernelInput, frames } from "./kernel-fixture.js";
import { waitFor } from "./runtime-fixture.js";
import { kernelRelay } from "./kernel-relay.js";
import { ImRuntime } from "../packages/octo-runtime-extra-channel-gateway/dist/application/im-channel.js";
import { GatewayTransport } from "../packages/octo-runtime-extra-channel-gateway/dist/transport/channel.js";

for (const finishFails of [false, true])
  test(
    `Gateway drains a completed Kernel source with pending presentation; finish fails: ${finishFails}`,
    { timeout: 10000 },
    async (t) => {
      const fixture = await kernelFixture(t, {
        manifest: resolve("test/fixtures/invoke-adapters.json")
      });
      let completedBeforeSubscribe = false;
      const relay = await kernelRelay(t, fixture, {
        async request(request) {
          if (request.method !== "agent_run.subscribe") return;
          const { ref } = request.params;
          // 先让真实源完成，再放行订阅；ACK 会先移除登记，随后才重放交互事件。
          for await (const frame of fixture.client.subscribe(ref)) {
            if (frame.kind === "canonical" && frame.event.type === "interaction.requested") break;
          }
          await fixture.client.respond(ref, { interactionId: "approval", outcome: "accepted" });
          await waitFor(
            async () => (await fixture.client.get(ref)).terminal?.control.state === "completed"
          );
          completedBeforeSubscribe = true;
        }
      });
      const presentationGate = Promise.withResolvers();
      let callbacks,
        presenting = false,
        finishes = 0;
      const replies = [];
      t.mock.method(GatewayTransport.prototype, "start", async function () {
        callbacks = this.callbacks;
      });
      t.mock.method(GatewayTransport.prototype, "close", async () => {});
      const runtime = new ImRuntime(
        {
          bot_id: "completed-source",
          api_url: "https://im-test.deepminer.com.cn/api",
          adapter: { adapter_type: "test", workdir: process.cwd() }
        },
        { kernel: relay.client }
      );
      t.after(async () => {
        presentationGate.resolve();
        await runtime.close().catch(() => undefined);
      });
      await runtime.start();
      callbacks.onMessage({
        messageId: "completed-source",
        senderId: "sender",
        conversationId: "chat",
        conversationKind: "direct",
        text: "interaction",
        buildContext: async () => ({ schema: "octo.context-envelope/v3", items: [] }),
        beginPresentation: () => ({
          update() {},
          async interaction() {
            presenting = true;
            await presentationGate.promise;
            return true;
          },
          async finish() {
            finishes++;
            if (finishFails) throw new Error("test presentation finish failed");
          }
        }),
        reply: async (text) => {
          replies.push(text);
        }
      });
      await waitFor(() => presenting);
      assert.equal(completedBeforeSubscribe, true);
      assert.equal(relay.client.invocations.snapshot().length, 0);
      assert.equal(runtime.status.tasks.length, 1, "the business iterator still owns the tail");
      const closing = runtime.close();
      const result = Promise.allSettled([closing]);
      presentationGate.resolve();
      const [actual] = await result;
      assert.equal(actual.status, finishFails ? "rejected" : "fulfilled");
      if (finishFails) {
        assert.equal(actual.reason.message, "IM_DISPOSE_FAILED");
        assert.deepEqual(
          actual.reason.errors.map((error) => error.message),
          ["IM_PRESENTATION_FAILED"]
        );
        await assert.rejects(runtime.close(), (error) => error === actual.reason);
      } else await runtime.close();
      assert.equal(finishes, 1);
      assert.equal(replies.length, 1);
      assert.match(replies[0], /answer/);
      assert.equal(relay.count("agent_run.invoke"), 1);
      assert.equal(relay.count("agent_run.subscribe"), 1);
      assert.equal(relay.count("agent_run.cancel"), 0);
      assert.equal((await fixture.client.status()).execution_ready, true);
    }
  );

test(
  "native Gateway drains its accepted Kernel run before close completes and preserves a sibling",
  { timeout: 10000 },
  async (t) => {
    const { client, endpoint, directory } = await kernelFixture(t, {
      workerEntrypoint: resolve("test/fixtures/drain-worker.mjs"),
      manifest: undefined
    });
    const sibling = await client.submit(kernelInput("sibling"));
    const trace = join(directory, "drain.ndjson");
    const records = async () => (await readFile(trace, "utf8")).trim().split("\n").map(JSON.parse);
    const extra = createExtraService({
      endpoint,
      module: drainGateway,
      config: { trace },
      dependencies: {}
    });
    t.after(() => extra.close());
    await extra.initialize();
    await waitFor(async () =>
      (await records()).some((item) => item.type === "accepted.tail")
    ).catch(async (error) => {
      throw new Error(JSON.stringify({ status: await extra.status(), records: await records() }), {
        cause: error
      });
    });
    const result = await extra.close();
    assert.equal(result.complete, true, JSON.stringify({ result, records: await records() }));
    const events = await records();
    const stop = events.findIndex((item) => item.type === "cancel.ack");
    const binding = events.findIndex(
      (item) => item.type === "binding" && item.session === "drained-provider-session"
    );
    const final = events.findIndex((item) => item.type === "final");
    const close = events.findIndex(
      (item, index) => index > stop && item.type === "connector.close"
    );
    assert.ok(
      stop >= 0 && binding > stop && final > binding && close > final,
      JSON.stringify(events)
    );
    assert.equal(events.filter((item) => item.type === "invoke").length, 1);
    assert.equal(events.filter((item) => item.type === "final").length, 1);
    assert.equal((await client.get(sibling.ref)).terminal, undefined);
    assert.equal((await client.status()).execution_ready, true);
    await client.cancel(sibling.ref);
    await frames(client, sibling.ref);
  }
);
