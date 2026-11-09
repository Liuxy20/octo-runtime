import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv from "ajv";
import * as protocol from "../../packages/octo-runtime-protocol/dist/index.js";

// Run explicitly after building; this suite is outside the default test/CI glob.
const schema = JSON.parse(
  await readFile(
    new URL("../../packages/octo-runtime-protocol/schema/protocol.schema.json", import.meta.url),
    "utf8"
  )
);
const ajv = new Ajv({ strict: false });
ajv.addSchema(schema);
const validator = (name) => ajv.compile({ $ref: `${schema.$id}#/definitions/${name}` });
const empty = () => ({ schema: protocol.CONTEXT_SCHEMA, items: [] });
const input = () => ({ inputs: [{ type: "text", text: "Application prompt" }], agentEnv: empty() });
const request = () => ({
  protocolVersion: 2,
  invocationId: "invocation-334",
  runId: "run-334",
  agentSessionId: "session-334",
  agentSource: "provisioned",
  context: empty(),
  approvalMode: "ask",
  modelInput: "Application prompt",
  prompt: "Application prompt",
  workdir: "/tmp",
  agentConfig: {}
});
const removedItem = (payload) => ({
  namespace: "octo.control",
  name: "instructions",
  payload
});
const removed = /CONTROL_INSTRUCTIONS_REMOVED:.*inputs\.parts/;

test("removed fields reject presence at all boundaries, including undefined", () => {
  const boundaries = [
    ["InvokeInputWire", input, protocol.assertInvokeInput],
    ["AgentEnv", empty, protocol.assertAgentEnv],
    ["InvokeRequestWire", request, protocol.assertInvokeRequest],
    ["InvokeInputWire", input, protocol.InvokeInput.check]
  ];
  for (const [name, create, check] of boundaries) {
    const validate = validator(name);
    assert.equal(validate(create()), true, `${name}: valid replacement`);
    assert.doesNotThrow(() => check(create()));
    for (const value of ["", null, undefined, "Legacy application prompt"]) {
      const candidate = { ...create(), controlInstructions: value };
      assert.throws(() => check(candidate), removed, `${name}: ${String(value)}`);
      // Undefined is a JavaScript-only presence case; JSON wire values use standard Schema.
      if (value !== undefined) assert.equal(validate(candidate), false, name);
    }
  }
  for (const value of ["", null, undefined, "Legacy application prompt"]) {
    const candidate = input();
    candidate.agentEnv.controlInstructions = value;
    assert.throws(() => protocol.assertInvokeInput(candidate), removed);
    if (value !== undefined) assert.equal(validator("InvokeInputWire")(candidate), false);
  }
});

test("the exact removed item rejects in Context, configuration, environment and request", () => {
  for (const payload of [{ entries: [] }, { entries: [{ text: "Legacy prompt" }] }, {}, null]) {
    const context = { ...empty(), items: [removedItem(payload)] };
    for (const [name, candidate, check] of [
      ["ContextEnvelope", context, protocol.assertContextEnvelope],
      ["AgentEnv", context, protocol.assertAgentEnv],
      ["InvokeInputWire", { ...input(), agentEnv: context }, protocol.assertInvokeInput],
      ["InvokeRequestWire", { ...request(), context }, protocol.assertInvokeRequest],
      [
        "ContextConfiguration",
        { defaults: context, mandatory: empty() },
        protocol.assertContextConfiguration
      ],
      [
        "ContextConfiguration",
        { defaults: empty(), mandatory: context },
        protocol.assertContextConfiguration
      ]
    ]) {
      assert.equal(validator(name)(candidate), false, `${name}: ${JSON.stringify(payload)}`);
      assert.throws(() => check(candidate), removed, name);
    }
    assert.throws(
      () =>
        protocol.resolveContextConfiguration({ defaults: empty(), mandatory: empty() }, context),
      removed
    );
  }
});

test("other generic context names retain their existing extension behavior", () => {
  for (const [namespace, name] of [
    ["octo.control", "custom"],
    ["extra.application", "instructions"]
  ]) {
    const context = { ...empty(), items: [{ namespace, name, payload: { text: "extension" } }] };
    assert.equal(validator("ContextEnvelope")(context), true);
    assert.doesNotThrow(() => protocol.assertContextEnvelope(context));
  }
});

test("removed helpers and schema types are absent from the protocol surface", () => {
  for (const name of ["contextControlInstructions", "initialControlInstructions"])
    assert.equal(Object.hasOwn(protocol, name), false, name);
  for (const name of ["ContextInstructionEntry", "ContextInstructionsPayload"])
    assert.equal(Object.hasOwn(schema.definitions, name), false, name);
  assert.equal(
    protocol.CONTEXT_TYPE_CATALOG.some(
      (entry) => entry.namespace === "octo.control" && entry.name === "instructions"
    ),
    false
  );
});
