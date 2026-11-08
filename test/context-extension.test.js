import assert from "node:assert/strict";
import test from "node:test";
import {
  assertContextEnvelope,
  contextHash,
  mergeContext,
  resolveContextConfiguration
} from "../packages/octo-runtime-protocol/dist/index.js";

const empty = () => ({ schema: "octo.context-envelope/v3", items: [] });
const external = () => ({
  ...empty(),
  items: [
    {
      namespace: "eva.project",
      name: "current",
      payload: { type: { nested: true }, project_id: "p1" }
    }
  ]
});

test("unknown items survive merge and hash but do not enter model or execution controls", () => {
  const context = external();
  assert.doesNotThrow(() => assertContextEnvelope(context));
  assert.deepEqual(mergeContext(empty(), context), context);
  assert.notEqual(contextHash(context), contextHash(empty()));
  context.items[0].payload.project_id = "p2";
  assert.notEqual(contextHash(context), contextHash(external()));
});

test("unknown items cannot be persisted as defaults or made mandatory without support", () => {
  for (const layer of ["defaults", "mandatory"]) {
    const configuration = { defaults: empty(), mandatory: empty(), [layer]: external() };
    assert.throws(
      () => resolveContextConfiguration(configuration, empty()),
      /CONTEXT_CONFIGURATION_TYPE_FORBIDDEN/
    );
  }
});

test("known invalid payloads and unknown public shape errors are not ignored", () => {
  assert.throws(() =>
    assertContextEnvelope({
      ...empty(),
      items: [
        { namespace: "octo.security", name: "approval_policy", payload: { mode: "silently_allow" } }
      ]
    })
  );
  const context = external();
  context.items[0].payload = [];
  assert.throws(() => assertContextEnvelope(context), /CONTEXT_SCHEMA_INVALID/);
});
