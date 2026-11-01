import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import Ajv from "ajv";
import {
  assertQuestionResponse,
  assertInvokeInput
} from "../../packages/octo-runtime-protocol/dist/index.js";
import { build, batch } from "../../native/tests/driver.mjs";

const schema = JSON.parse(
  await readFile(
    new URL("../../packages/octo-runtime-protocol/schema/protocol.schema.json", import.meta.url),
    "utf8"
  )
);
const ajv = new Ajv({ strict: false });
const validate = ajv.compile({
  $ref: "#/definitions/QuestionResponse",
  definitions: schema.definitions
});
const cases = [
  ...["Red", "custom 中文", "😀".repeat(4096), "\u0085"].map((text) => ({ text, valid: true })),
  ...["", " \t\n", "\u00a0\ufeff", "😀".repeat(4097), "\ud800", "\udfff"].map((text) => ({
    text,
    valid: false
  }))
].map((c) => ({
  ...c,
  value: { schema: "octo.question-response/v1", answers: [{ questionId: "q:0", text: c.text }] }
}));
for (const language of ["go", "python"])
  test(`async question response strings agree in TS/schema/${language}`, async () => {
    for (const c of cases) {
      let valid = true;
      try {
        assertQuestionResponse(c.value);
      } catch {
        valid = false;
      }
      assert.equal(valid, c.valid);
      if (!/[\ud800-\udfff]/u.test(c.text)) assert.equal(validate(c.value), c.valid);
    }
    build(language);
    const results = await batch(
      language,
      cases.map((c) => ({ op: "codec", definition: "QuestionResponse", value: c.value }))
    );
    for (const [i, result] of results.entries())
      assert.equal(result.valid ?? false, cases[i].valid, JSON.stringify({ i, result }));
  });

for (const language of ["go", "python"])
  test(`requireResume boolean and async optional expiry agree in TS/schema/${language}`, async () => {
    const inputs = [true, false, "true", 1, null].map((requireResume) => ({
      inputs: [{ type: "text", text: "supplement" }],
      contexts: { schema: "octo.context-envelope/v3", items: [] },
      providerSession: { sessionId: "fixture", requireResume }
    }));
    build(language);
    const results = await batch(
      language,
      inputs.map((value) => ({ op: "codec", definition: "InvokeInputWire", value }))
    );
    for (let i = 0; i < inputs.length; i++) {
      let valid = true;
      try {
        assertInvokeInput(inputs[i]);
      } catch {
        valid = false;
      }
      assert.equal(valid, i < 2);
      assert.equal(results[i].valid ?? false, valid);
    }
    const question = {
      interactionId: "fixture",
      executionInstanceId: "fixture",
      kind: "question",
      request: {
        schema: "octo.question-request/v1",
        messageId: "fixture",
        questions: [{ id: "q:0", title: "Color?", options: null, allowCustom: true }]
      }
    };
    const checks = await batch(language, [
      {
        op: "codec",
        definition: "InteractionRequestedPayload",
        value: { ...question, delivery: "async" }
      },
      { op: "codec", definition: "InteractionRequestedPayload", value: question }
    ]);
    assert.equal(checks[0].valid, true);
    assert.equal(checks[1].valid ?? false, false);
  });
