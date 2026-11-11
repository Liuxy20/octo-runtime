import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CONTEXT_TYPE_CATALOG,
  assertContextConfiguration,
  assertContextEnvelope,
  canonicalContext,
  contextTypeDefinition,
  resolveContextConfiguration
} from "../packages/octo-runtime-protocol/dist/index.js";

const schema = JSON.parse(
  readFileSync(
    new URL("../packages/octo-runtime-protocol/schema/protocol.schema.json", import.meta.url),
    "utf8"
  )
);
const fixtures = JSON.parse(
  readFileSync(
    new URL(
      "../packages/octo-runtime-protocol/test/fixtures/context-configuration-fixtures.json",
      import.meta.url
    ),
    "utf8"
  )
);
for (const fixture of fixtures) {
  test(`configuration contract: ${fixture.name}`, () => {
    const original = structuredClone(fixture);
    if (fixture.error) {
      assert.throws(
        () => resolveContextConfiguration(fixture.configuration, fixture.request),
        (error) => error.message.startsWith(fixture.error)
      );
    } else {
      assert.doesNotThrow(() => assertContextConfiguration(fixture.configuration));
      const result = resolveContextConfiguration(fixture.configuration, fixture.request);
      assert.equal(canonicalContext(result), canonicalContext(fixture.expected));
      const reordered = structuredClone(fixture);
      reordered.request.items.reverse();
      reordered.configuration.defaults.items.reverse();
      reordered.configuration.mandatory.items.reverse();
      assert.equal(
        canonicalContext(resolveContextConfiguration(reordered.configuration, reordered.request)),
        canonicalContext(result)
      );
    }
    assert.deepEqual(fixture, original);
  });
}

test("built-in helper definitions exist without registering private payloads", () => {
  assert.equal(schema.definitions.ContextItem.allOf, undefined);
  for (const item of CONTEXT_TYPE_CATALOG) {
    assert.ok(schema.definitions[item.schemaRef.split("/").at(-1)]);
    assert.ok(Object.isFrozen(item));
  }
  assert.throws(() => contextTypeDefinition("unknown", "selection"), /CONTEXT_TYPE_UNSUPPORTED/);
});

test("business material types are not registered public protocol entries", () => {
  assert.throws(() => contextTypeDefinition("octo.content", "inline"), /CONTEXT_TYPE_UNSUPPORTED/);
  assert.throws(
    () => contextTypeDefinition("octo.content", "references"),
    /CONTEXT_TYPE_UNSUPPORTED/
  );
});

test("configuration rejects unknown fields and default-layer trusted controls", () => {
  const empty = { schema: "octo.context-envelope/v3", items: [] };
  for (const invalid of [
    null,
    [],
    {},
    { defaults: empty, mandatory: empty, source: "admin" },
    {
      mandatory: empty,
      defaults: {
        ...empty,
        items: [{ namespace: "octo.control", name: "instructions", payload: { entries: [] } }]
      }
    }
  ]) {
    assert.throws(() => assertContextConfiguration(invalid));
  }
});

test("caller-owned private defaults do not require a public catalog entry", () => {
  const empty = { schema: "octo.context-envelope/v3", items: [] };
  const defaults = {
    ...empty,
    items: [{ namespace: "business.custom", name: "configuration", payload: { enabled: true } }]
  };
  assert.deepEqual(resolveContextConfiguration({ defaults, mandatory: empty }, empty), defaults);
});
