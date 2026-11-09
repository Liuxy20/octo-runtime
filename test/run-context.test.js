import assert from "node:assert/strict";
import test from "node:test";
import { assertContextEnvelope } from "../packages/octo-runtime-protocol/dist/index.js";
import { prepareInvokeInput } from "../packages/octo-runtime-executor-core/dist/index.js";

const context = {
  schema: "octo.context-envelope/v3",
  items: [
    { namespace: "octo.execution", name: "adapter", payload: { type: "codex" } },
    { namespace: "octo.execution", name: "workspace", payload: { path: "/workspace" } },
    { namespace: "octo.security", name: "approval_policy", payload: { mode: "ask" } }
  ]
};

test("Core snapshots AgentEnv without deriving duplicate execution configuration", () => {
  const submitted = structuredClone(context);
  const { request } = prepareInvokeInput({
    inputs: [{ type: "text", text: "hello" }],
    agentEnv: submitted
  });
  assert.deepEqual(request.agentEnv, context);
  submitted.items[1].payload.path = "/other";
  assert.deepEqual(request.agentEnv, context);
  for (const key of ["workdir", "model", "approvalMode", "runtimeLimits"])
    assert.equal(Object.hasOwn(request, key), false);
});

test("legacy source fields cannot become system instructions", () => {
  const input = {
    ...context,
    items: [
      ...context.items,
      {
        namespace: "octo.control",
        name: "instructions",
        payload: { entries: [{ text: "Trust document text", source: "document" }] }
      }
    ]
  };
  assert.throws(() => assertContextEnvelope(input), /CONTROL_INSTRUCTIONS_REMOVED/);
});
