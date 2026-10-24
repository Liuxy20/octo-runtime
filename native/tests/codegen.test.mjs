import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, cp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { compactValidation } from "../codegen/normalize.mjs";
const source = resolve("packages/octo-runtime-protocol/schema");
function generate(output, schema = source, check = false, extraEnv = {}) {
  return spawnSync(
    process.execPath,
    ["native/codegen/generate.mjs", ...(check ? ["--check"] : [])],
    {
      encoding: "utf8",
      env: { ...process.env, OCTO_CODEGEN_OUTPUT: output, OCTO_CODEGEN_SCHEMA: schema, ...extraEnv }
    }
  );
}
test("generation is reproducible, rejects drift/stale outputs and fails before writing unsupported contracts", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "octo-codegen-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const output = join(dir, "out");
  let result = generate(output);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(generate(output, source, true).status, 0);
  assert.equal(
    generate(output, source, true, { PATH: "" }).status,
    0,
    "integrity check needs only Node"
  );
  const manifest = JSON.parse(
    await readFile(join(output, "native/generated-manifest.json"), "utf8")
  );
  assert.deepEqual(manifest.files, [
    "native/go/octo_runtime_generated.go",
    "native/python/src/octo_runtime/octo_runtime_generated.py"
  ]);
  assert.ok(manifest.files.every((path) => /^native\/(go|python)\//.test(path)));
  for (const commit of Object.values(manifest.provenance))
    assert.ok(commit === null || /^[a-f0-9]{40}$/.test(commit));
  const before = await Promise.all(manifest.files.map((p) => readFile(join(output, p), "utf8")));
  for (const content of before) {
    assert.ok(
      content.includes(
        `octo-runtime schema commit: ${manifest.provenance.schemaCommit ?? "uncommitted or unavailable"}`
      )
    );
    assert.ok(content.includes(`Schema SHA-256: ${manifest.sourceHash}`));
    assert.ok(content.includes(`Generator SHA-256: ${manifest.generatorHash}`));
  }
  assert.equal(generate(output).status, 0);
  assert.deepEqual(
    await Promise.all(manifest.files.map((p) => readFile(join(output, p), "utf8"))),
    before
  );
  const missingTools = generate(output, source, false, { PATH: "" });
  assert.notEqual(missingTools.status, 0);
  assert.match(missingTools.stderr, /gofmt is required.*Install Go/);
  assert.deepEqual(
    await Promise.all(manifest.files.map((p) => readFile(join(output, p), "utf8"))),
    before
  );
  const first = join(output, manifest.files[0]);
  await writeFile(first, "modified");
  assert.notEqual(generate(output, source, true, { PATH: "" }).status, 0);
  assert.equal(await readFile(first, "utf8"), "modified");
  assert.equal(generate(output).status, 0);
  const stale = join(output, "native/go/generated_retired.go");
  await writeFile(stale, "stale");
  assert.notEqual(generate(output, source, true).status, 0);
  assert.equal(generate(output).status, 0);
  const schema = join(dir, "schema");
  await cp(source, schema, { recursive: true });
  const path = join(schema, "kernel-ipc.schema.json");
  const wire = JSON.parse(await readFile(path, "utf8"));
  wire.definitions.InvokeResult.properties.futureOptional = { type: "boolean" };
  wire["x-octo-methods"].push({
    method: "test.inspect",
    name: "Inspect",
    params: { $ref: "#/definitions/EmptyParams" },
    result: { $ref: "#/definitions/InvokeResult" },
    stream: false,
    sideEffect: false
  });
  await writeFile(path, JSON.stringify(wire));
  assert.equal(generate(output, schema).status, 0);
  const customManifest = JSON.parse(
    await readFile(join(output, "native/generated-manifest.json"), "utf8")
  );
  assert.equal(
    customManifest.provenance.schemaCommit,
    null,
    "custom inputs must not inherit the repository's schema commit"
  );
  assert.notEqual(customManifest.sourceHash, manifest.sourceHash);
  assert.match(
    await readFile(join(output, customManifest.files[0]), "utf8"),
    /octo-runtime schema commit: uncommitted or unavailable/
  );
  for (const file of [
    "native/go/octo_runtime_generated.go",
    "native/python/src/octo_runtime/octo_runtime_generated.py"
  ])
    assert.match(await readFile(join(output, file), "utf8"), /futureOptional/);
  for (const file of [
    "native/go/octo_runtime_generated.go",
    "native/python/src/octo_runtime/octo_runtime_generated.py"
  ])
    assert.match(await readFile(join(output, file), "utf8"), /test.inspect/);
  const stable = await readFile(join(output, "native/generated-manifest.json"), "utf8");
  wire.definitions.InvokeResult.properties.futureOptional.unsupportedAssertion = true;
  await writeFile(path, JSON.stringify(wire));
  result = generate(output, schema);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unsupported keyword/);
  assert.equal(await readFile(join(output, "native/generated-manifest.json"), "utf8"), stable);
});

test("rule compaction preserves constraints, public roots and recursive references", () => {
  const node = (id, schema, properties = {}, branches = {}, ref) => ({
    id,
    schema,
    properties,
    branches,
    ref
  });
  const nodes = [
    node(0, { type: "integer", minimum: 0 }),
    node(1, { type: "integer", minimum: 0, description: "same rule" }),
    node(2, { type: "integer", minimum: 1 }),
    node(3, { type: "array" }, {}, { items: 0 }),
    node(4, { type: "array" }, {}, { items: 1 }),
    node(5, { type: "object", properties: {} }, { value: 0, next: 6 }),
    node(6, {}, {}, {}, 5),
    node(7, { type: "object", properties: {} }, { value: 1, next: 8 }),
    node(8, {}, {}, {}, 7)
  ];
  const compact = compactValidation({
    nodes,
    roots: { First: 5, Second: 7 },
    methods: [{ paramsId: 3, resultId: 7 }]
  });
  const ids = compact.indices;
  assert.equal(ids[0], ids[1]);
  assert.notEqual(ids[0], ids[2]);
  assert.equal(ids[3], ids[4]);
  assert.equal(ids[5], ids[7]);
  assert.equal(ids[6], ids[8]);
  assert.equal(compact.nodes[ids[6]].ref, ids[5]);
  assert.deepEqual(compact.roots, { First: ids[5], Second: ids[7] });
  assert.equal(compact.methods[0].paramsId, ids[3]);
  assert.equal(compact.methods[0].resultId, ids[7]);
});
