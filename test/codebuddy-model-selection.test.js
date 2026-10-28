import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import test from "node:test";
import { ImRuntime } from "@mininglamp-oss/octo-runtime-extra-channel-gateway";
import { createCodeBuddyAdapter } from "@mininglamp-oss/octo-runtime-adapter-codebuddy";
import { MemoryImSessionStore } from "../packages/octo-runtime-extra-channel-gateway/dist/application/session-store.js";
import { GatewayTransport } from "../packages/octo-runtime-extra-channel-gateway/dist/transport/channel.js";
import { codeBuddyModelFixture } from "./fixtures/codebuddy-model-fixture.js";
import { invokeRequest, waitFor } from "./runtime-fixture.js";
import { kernelFixture } from "./kernel-fixture.js";

async function collect(source) {
  return await Array.fromAsync(source);
}
const receipt = (events) =>
  events.find((e) => e.type === "session.update")?.payload.providerSession;
const request = (model, providerSession) =>
  invokeRequest({
    agentConfig: model ? { model } : {},
    ...(providerSession ? { providerSession } : {})
  });

for (const catalog of ["config", "models"]) {
  test(`CodeBuddy fresh selection and resumed switching use native ${catalog} setter`, async () => {
    const { adapter, state } = codeBuddyModelFixture({
      catalog,
      configId: "native-model",
      grouped: true
    });
    const first = await collect(adapter.invoke(request("model-b")));
    assert.equal(receipt(first).model, "model-b");
    const second = await collect(adapter.invoke(request("model-a", receipt(first))));
    assert.equal(receipt(second).sessionId, receipt(first).sessionId);
    assert.equal(receipt(second).model, "model-a");
    assert.deepEqual(state.promptModels, ["model-b", "model-a"]);
    const setters = state.calls.filter((v) => v.method.startsWith("session/set_"));
    assert.equal(setters.length, 2);
    assert.deepEqual(
      setters[0],
      catalog === "config"
        ? {
            method: "session/set_config_option",
            params: {
              sessionId: receipt(first).sessionId,
              configId: "native-model",
              value: "model-b"
            }
          }
        : {
            method: "session/set_model",
            params: { sessionId: receipt(first).sessionId, modelId: "model-b" }
          }
    );
    assert.equal(state.closes, 2);
    assert.equal(state.calls[0].params.model, undefined);
  });
}

for (const catalog of ["config", "empty", "missing"]) {
  test(`CodeBuddy rejects unknown IDs before setter and prompt (${catalog})`, async () => {
    const { adapter, state } = codeBuddyModelFixture({ catalog });
    await assert.rejects(
      collect(adapter.invoke(request("unknown-model"))),
      /MODEL_NOT_FOUND.*unknown-model/
    );
    assert.deepEqual(state.promptModels, []);
    assert.equal(
      state.calls.some((c) => c.method.startsWith("session/set_")),
      false
    );
    assert.equal(state.closes, 1);
  });
}

for (const selectionResult of [
  {},
  { model: "model-a" },
  { configOptions: [{ id: "model", currentValue: "" }] }
]) {
  test(`CodeBuddy never prompts after missing or wrong selection confirmation (${JSON.stringify(selectionResult)})`, async () => {
    const { adapter, state } = codeBuddyModelFixture({ selectionResult });
    await assert.rejects(
      collect(adapter.invoke(request("model-b"))),
      /did not confirm model model-b/
    );
    assert.deepEqual(state.promptModels, []);
    assert.equal(state.closes, 1);
  });
}

test("CodeBuddy native rejection and invalid resumed selection do not poison the next valid turn", async () => {
  const { adapter, state } = codeBuddyModelFixture();
  const first = receipt(await collect(adapter.invoke(request("model-a"))));
  for (const [model, reason] of [
    ["unknown-model", /MODEL_NOT_FOUND/],
    ["denied", /Native selection rejected/]
  ]) {
    await assert.rejects(collect(adapter.invoke(request(model, first))), reason);
  }
  const next = await collect(adapter.invoke(request("model-b", first)));
  assert.equal(receipt(next).model, "model-b");
  assert.deepEqual(state.promptModels, ["model-a", "model-b"]);
  assert.equal(state.closes, 4);
});

test("CodeBuddy omitted and empty model keep native default; confirmed current selection needs no setter", async () => {
  const { adapter, state } = codeBuddyModelFixture();
  for (const model of [undefined, "", "model-a"]) {
    const events = await collect(adapter.invoke(request(model)));
    assert.equal(receipt(events).model, "model-a");
  }
  assert.deepEqual(state.promptModels, ["model-a", "model-a", "model-a"]);
  assert.equal(
    state.calls.some((c) => c.method.startsWith("session/set_")),
    false
  );
  assert.equal(state.closes, 3);
});

test("CodeBuddy rejects an advertised config option without a usable id", async () => {
  const { adapter, state } = codeBuddyModelFixture({ configId: "" });
  await assert.rejects(
    collect(adapter.invoke(request("model-b"))),
    /model config option has no id/
  );
  assert.deepEqual(state.promptModels, []);
  assert.equal(state.closes, 1);
});

test("CodeBuddy cancellation while selecting a model closes transport without prompting", async () => {
  const controller = new AbortController();
  const ready = Promise.withResolvers();
  let prompts = 0,
    closes = 0;
  const adapter = createCodeBuddyAdapter({
    acpClientFactory: ({ signal }) => {
      let nextId = 0,
        closed = false;
      return {
        initialize: async () => ({}),
        reserveRequestId: () => ++nextId,
        request: async (method) => {
          if (method === "session/new")
            return {
              sessionId: "cancel-session",
              configOptions: [
                { id: "model", currentValue: "model-a", options: [{ value: "model-b" }] }
              ]
            };
          ready.resolve();
          return await new Promise((_, reject) =>
            signal.addEventListener("abort", () => reject(signal.reason), { once: true })
          );
        },
        async *prompt() {
          prompts++;
        },
        close: async () => {
          if (!closed) closes++;
          closed = true;
        }
      };
    }
  });
  const running = collect(adapter.invoke({ ...request("model-b"), signal: controller.signal }));
  const rejected = assert.rejects(running, /cancel during selection/);
  await ready.promise;
  controller.abort(new Error("cancel during selection"));
  await rejected;
  assert.equal(prompts, 0);
  assert.equal(closes, 1);
});

test(
  "Gateway -> real Kernel worker -> CodeBuddy model selection -> delivered result",
  { timeout: 30000 },
  async (t) => {
    const fixture = await kernelFixture(t, {
      workerEntrypoint: resolve("test/fixtures/codebuddy-model-worker.mjs")
    });
    let onMessage;
    t.mock.method(GatewayTransport.prototype, "start", async function () {
      onMessage = this.callbacks.onMessage;
    });
    t.mock.method(GatewayTransport.prototype, "close", async () => {});
    const backend = new MemoryImSessionStore();
    t.after(() => backend.close());
    const traces = [],
      replies = [];
    const subscribe = fixture.client.subscribe.bind(fixture.client);
    t.mock.method(fixture.client, "subscribe", async function* (...args) {
      for await (const frame of subscribe(...args)) {
        if (frame.kind === "control") traces.at(-1).host.push(frame.control);
        yield frame;
      }
    });
    const kernel = {
      async *invoke(input, environment) {
        const trace = { input, events: [], host: [] };
        traces.push(trace);
        // 使用产品的 KernelClient.invoke；上方仅旁观原订阅以核对 Host 终态。
        for await (const event of fixture.client.invoke(input, environment)) {
          trace.events.push(event);
          yield event;
        }
      },
      cancelInvocation: (...args) => fixture.client.cancelInvocation(...args),
      respondInteraction: (...args) => fixture.client.respondInteraction(...args)
    };
    let runtime;
    t.after(async () => {
      if (runtime) await runtime.close();
    });
    const audit = async () =>
      (await readFile(join(fixture.directory, "codebuddy-model-audit.ndjson"), "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
    async function turn(model, expected, content) {
      if (runtime) await runtime.close();
      runtime = new ImRuntime(
        {
          bot_id: "codebuddy-test",
          api_url: "https://im-test.deepminer.com.cn/api",
          cards: false,
          typing: false,
          adapter: { adapter_type: "codebuddy", model, workdir: fixture.directory },
          approval_mode: "full_access"
        },
        {
          kernel,
          // 后端属于测试宿主，重载 Gateway 后仍保留同一 binding。
          sessions: backend
        }
      );
      await runtime.start();
      const count = replies.length;
      onMessage({
        messageId: `message-${traces.length}`,
        senderId: "sender",
        conversationId: "chat",
        conversationKind: "direct",
        text: "hello",
        buildContext: async () => ({ schema: "octo.context-envelope/v3", items: [] }),
        reply: async (text) => {
          replies.push(text);
        }
      });
      await waitFor(() => replies.length > count && runtime.status.sessions.length === 0, 10000);
      const trace = traces.at(-1);
      assert.equal(trace.host.at(-1).state, expected);
      assert.deepEqual(
        trace.events
          .filter((e) => /^run\.(completed|failed|cancelled)$/.test(e.type))
          .map((e) => e.type),
        [`run.${expected}`]
      );
      assert.match(replies.at(-1), content);
      return trace;
    }
    await turn("unknown-fresh", "failed", /unknown-fresh/);
    const first = await turn("model-b", "completed", /Provider used model-b/);
    const second = await turn("model-a", "completed", /Provider used model-a/);
    assert.equal(receipt(second.events).sessionId, receipt(first.events).sessionId);
    assert.equal(second.input.providerSession.sessionId, receipt(first.events).sessionId);
    await turn("unknown-resumed", "failed", /unknown-resumed/);
    await turn("denied", "failed", /Native selection rejected/);
    await turn("subscription", "failed", /企业订阅已到期/);
    const recovered = await turn("model-b", "completed", /Provider used model-b/);
    assert.equal(receipt(recovered.events).sessionId, receipt(first.events).sessionId);
    const records = await audit();
    assert.deepEqual(
      records.filter((v) => v.method === "session/prompt").map((v) => v.model),
      ["model-b", "model-a", "subscription", "model-b"]
    );
    assert.equal(records.filter((v) => v.method === "close").length, 7);
  }
);
