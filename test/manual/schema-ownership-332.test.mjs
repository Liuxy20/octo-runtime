import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import Ajv from "ajv";
import {
  KERNEL_IPC_VERSION,
  RUN_PROTOCOL_ERRORS,
  assertInvokeInput
} from "../../packages/octo-runtime-protocol/dist/index.js";

// 仅显式手动执行；发行归档须先通过 pack-release 生成，不接入默认测试或 CI。
const root = resolve(import.meta.dirname, "../..");
const protocolRoot = join(root, "packages/octo-runtime-protocol");
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const schema = await json(join(protocolRoot, "schema/protocol.schema.json"));
const ipc = await json(join(protocolRoot, "schema/kernel-ipc.schema.json"));
const removed = [
  "ContextSelectionEntry",
  "ContextResourceEntry",
  "ContextContinuityPayload",
  "ChannelScope",
  "ChannelMessagePart",
  "ChannelMessageSender",
  "ChannelMessageFlags",
  "ChannelMessageFact",
  "ChannelContextAppend",
  "ContextSyncRequest",
  "ContextSyncResult",
  "ChannelContextDescriptor",
  "ContextCommitResult"
];

test("schema directory contains only two definitions; six current test assets remain", async () => {
  assert.deepEqual((await readdir(join(protocolRoot, "schema"))).sort(), [
    "kernel-ipc.schema.json",
    "protocol.schema.json"
  ]);
  assert.deepEqual((await readdir(join(protocolRoot, "test/fixtures"))).sort(), [
    "context-configuration-fixtures.json",
    "context-fixtures.json",
    "kernel-ipc-fixtures.json",
    "native-invoke-fixtures.json",
    "run-protocol-fixtures.json",
    "session-name-fixtures.json"
  ]);
});

test("retained Draft-07 definitions resolve without the removed legacy group", () => {
  const ajv = new Ajv({ strict: false });
  ajv.addSchema(schema);
  for (const name of Object.keys(schema.definitions))
    assert.equal(typeof ajv.compile({ $ref: `${schema.$id}#/definitions/${name}` }), "function");
  assert.equal(typeof ajv.compile(ipc), "function");
  for (const name of removed) assert.equal(Object.hasOwn(schema.definitions, name), false, name);
  assert.equal(Object.hasOwn(ipc, "x-octo-methods"), false);
  assert.equal(ipc.$id, `urn:mininglamp-oss:octo-runtime:kernel-ipc:v${KERNEL_IPC_VERSION}`);
  assert.equal(ipc.title, `Kernel IPC v${KERNEL_IPC_VERSION}`);
  assert.equal(KERNEL_IPC_VERSION, schema.definitions.KernelStatus.properties.ipc_version.const);
  assert.deepEqual(RUN_PROTOCOL_ERRORS, schema.definitions.RunProtocolErrorCode.enum);
});

test("former native invoke samples agree on standard structural checks and runtime outcomes", async () => {
  // 这些样本覆盖 timeout/providerSession 的标准结构规则，不声称普通 Ajv 执行 x-octo 语义。
  const ajv = new Ajv({ strict: false });
  ajv.addSchema(schema);
  const validate = ajv.compile({ $ref: `${schema.$id}#/definitions/InvokeInputWire` });
  const fixtures = await json(join(protocolRoot, "test/fixtures/native-invoke-fixtures.json"));
  for (const fixture of fixtures) {
    const original = structuredClone(fixture.value);
    assert.equal(validate(fixture.value), fixture.valid, fixture.name);
    if (fixture.valid) assert.doesNotThrow(() => assertInvokeInput(fixture.value), fixture.name);
    else assert.throws(() => assertInvokeInput(fixture.value), TypeError, fixture.name);
    assert.deepEqual(fixture.value, original);
  }
});

test("published manifests retain conformance imports and remove the behavior config export", async () => {
  const full = await json(join(root, "package.json"));
  const client = await json(join(root, "packages/octo-runtime-client/package.json"));
  assert.equal(
    full.exports["./executor-kernel/ipc-fixtures.json"],
    "./packages/octo-runtime-protocol/test/fixtures/kernel-ipc-fixtures.json"
  );
  assert.equal(
    client.exports["./protocol/ipc-fixtures.json"],
    "./fixtures/kernel-ipc-fixtures.json"
  );
  assert.equal(Object.hasOwn(client.exports, "./protocol/behavior.json"), false);
});

const version = process.env.OCTO_SCHEMA_TEST_VERSION ?? "0.0.332";
for (const suffix of ["", "-client"]) {
  test(`${suffix || "runtime"}: packed protocol assets match the explicit publication set`, async () => {
    const archive = join(root, `dist/release/mininglamp-oss-octo-runtime${suffix}-${version}.tgz`);
    const contents = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" })
      .trim()
      .split("\n");
    const assets = suffix
      ? ["package/"]
      : [
          "package/packages/octo-runtime-protocol/",
          "package/node_modules/@mininglamp-oss/octo-runtime-client/"
        ];
    for (const prefix of assets) {
      const isSource = prefix.endsWith("/octo-runtime-protocol/");
      const fixturePath = `${prefix}${isSource ? "test/" : ""}fixtures/kernel-ipc-fixtures.json`;
      assert.deepEqual(
        contents
          .filter((path) => path.startsWith(`${prefix}schema/`) && path.endsWith(".json"))
          .sort(),
        [`${prefix}schema/kernel-ipc.schema.json`, `${prefix}schema/protocol.schema.json`]
      );
      assert.deepEqual(
        contents.filter(
          (path) =>
            path.startsWith(prefix) &&
            !path.slice(prefix.length).startsWith("node_modules/") &&
            /(?:-fixtures|\.behavior)\.json$/.test(path)
        ),
        [fixturePath]
      );
      const fixture = execFileSync("tar", ["-xOf", archive, fixturePath]);
      assert.deepEqual(
        fixture,
        await readFile(join(protocolRoot, "test/fixtures/kernel-ipc-fixtures.json"))
      );
    }
  });
}
