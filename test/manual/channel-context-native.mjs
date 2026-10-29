import test from "node:test";
import assert from "node:assert/strict";
import { assertContextEnvelope } from "../../packages/octo-runtime-protocol/dist/index.js";
import { build, batch } from "../../native/tests/driver.mjs";

// 本地专项，显式运行，不加入默认 CI 集合。
for (const language of ["go", "python"]) {
  test(`${language} explicit Context text format validates and round-trips`, async () => {
    const item = {
      namespace: "extra.im",
      name: "group-rules",
      data_format: "text",
      guidance: "Octo IM Group's GROUP.md.",
      payload: { text: "# Rules\n\n原文 ]]>\n" }
    };
    const cases = [
      [item, true],
      [{ ...item, payload: { text: "NO RULES" } }, true],
      [{ ...item, data_format: "markdown" }, false],
      [{ ...item, payload: { text: "rules", version: 7 } }, false],
      [{ ...item, payload: { text: 7 } }, false],
      [{ ...item, namespace: "octo.content", name: "inline" }, false]
    ];
    const commands = cases.map(([item, valid]) => {
      const value = { schema: "octo.context-envelope/v3", items: [item] };
      if (valid) assert.doesNotThrow(() => assertContextEnvelope(value));
      else assert.throws(() => assertContextEnvelope(value));
      return { op: "codec", definition: "ContextEnvelope", value };
    });
    build(language);
    const results = await batch(language, commands);
    results.forEach((result, i) => {
      assert.equal(result.valid, cases[i][1], `case ${i}: ${JSON.stringify(result)}`);
      if (cases[i][1]) assert.deepEqual(result.value, commands[i].value);
    });
  });
}
