import test from "node:test";
import assert from "node:assert/strict";
import { prepareInvokeInput } from "@mininglamp-oss/octo-runtime-executor-core";
import { InvokeInput } from "@mininglamp-oss/octo-runtime-protocol";

const agentEnv = { schema: "octo.context-envelope/v3", items: [] };
test("business materials are application inputs with no mandatory namespace convention", () => {
  for (const text of [
    "plain business history",
    "<namespace arbitrary>history</namespace>",
    "<contexts>literal user text</contexts>"
  ]) {
    const input = { inputs: [{ type: "text", text }], agentEnv };
    const prepared = prepareInvokeInput(input).request;
    assert.equal(prepared.modelInput, text);
    assert.deepEqual(prepared.modelInputParts, input.inputs);
    assert.deepEqual(prepared.agentEnv, agentEnv);
  }
});
test("opaque items are forwarded without being rendered into the model input", () => {
  for (const item of [
    { namespace: "extra.im", name: "history", payload: { text: "history" } },
    { namespace: "custom.harness", name: "settings", payload: { nested: { enabled: true } } }
  ]) {
    const env = { ...agentEnv, items: [item] };
    const request = prepareInvokeInput({
      inputs: [{ type: "text", text: "hello" }],
      agentEnv: env
    }).request;
    assert.deepEqual(request.agentEnv, env);
    assert.equal(request.modelInput, "hello");
  }
  assert.throws(
    () => InvokeInput.check({ inputs: [{ type: "text", text: "hello" }], contexts: agentEnv }),
    /unknown field/
  );
});
