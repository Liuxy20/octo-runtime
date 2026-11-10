import { withAgentEnvItems } from "../packages/octo-runtime-adapter-sdk/dist/index.js";
import { createCodeBuddyAdapter } from "@mininglamp-oss/octo-runtime-adapter-codebuddy";
import assert from "node:assert/strict";
import test from "node:test";
import { codeBuddyModelFixture } from "./fixtures/codebuddy-model-fixture.js";
import { invokeRequest } from "./runtime-fixture.js";
async function collect(source) {
  return await Array.fromAsync(source);
}
const receipt = (events) =>
  events.find((e) => e.type === "session.update")?.payload.providerSession;
const request = (model, providerSession) =>
  invokeRequest({
    ...(providerSession ? { providerSession } : {}),
    agentEnv: withAgentEnvItems(
      undefined,
      model
        ? [{ namespace: "octo.execution", name: "model", payload: { selection: { id: model } } }]
        : []
    )
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
    command: process.execPath,
    env: process.env,
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
