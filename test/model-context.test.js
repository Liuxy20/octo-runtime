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
    assert.deepEqual(prepared.context, agentEnv);
  }
});
test("old business Context cannot enter the execution environment", () => {
  for (const item of [
    { namespace: "extra.im", name: "history", payload: { text: "history" } },
    {
      namespace: "octo.content",
      name: "inline",
      payload: { entries: [{ text: "business material" }] }
    }
  ])
    assert.throws(
      () =>
        InvokeInput.check({
          inputs: [{ type: "text", text: "hello" }],
          agentEnv: { ...agentEnv, items: [item] }
        }),
      /business context/
    );
  assert.throws(
    () => InvokeInput.check({ inputs: [{ type: "text", text: "hello" }], contexts: agentEnv }),
    /unified JSON contract/
  );
});
