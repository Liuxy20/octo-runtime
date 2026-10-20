import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
const Ajv = createRequire(new URL("../package.json", import.meta.url))("ajv");
import { kernelFixture, kernelInput, frames } from "./kernel-fixture.js";
const read = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
test("shared Kernel schemas validate real receipts, snapshots, status and strict request fixtures", async (t) => {
  const ajv = new Ajv({ strict: false });
  const protocol = await read("../packages/octo-runtime-protocol/schema/protocol.schema.json");
  const wire = await read("../packages/octo-runtime-protocol/schema/kernel-ipc.schema.json");
  ajv.addSchema(protocol);
  const validateRequest = ajv.compile(wire);
  const { client, endpoint } = await kernelFixture(t);
  const fixtures = await read("../packages/octo-runtime-protocol/schema/kernel-ipc-fixtures.json");
  for (const fixture of fixtures.cases) {
    assert.equal(validateRequest(fixture.request), fixture.valid, fixture.name);
    const response = await new Promise((resolve, reject) => {
      const socket = net.createConnection(endpoint);
      let text = "";
      socket.once("error", reject);
      socket.once("connect", () => socket.write(JSON.stringify(fixture.request) + "\n"));
      socket.on("data", (chunk) => {
        text += chunk;
        if (text.includes("\n")) {
          socket.destroy();
          resolve(JSON.parse(text));
        }
      });
    });
    if (fixture.error_code)
      assert.equal(response.error.data.code, fixture.error_code, fixture.name);
    else if (fixture.result_definition)
      assert.equal(
        ajv.validate(
          { $ref: `${protocol.$id}#/definitions/${fixture.result_definition}` },
          response.result
        ),
        true
      );
  }
  const { ref } = await client.submit(kernelInput());
  await frames(client, ref);
  for (const [definition, value] of [
    ["KernelRunRef", ref],
    ["KernelRunSnapshot", await client.get(ref)],
    ["KernelStatus", await client.status()]
  ]) {
    const validate = ajv.compile({ $ref: `${protocol.$id}#/definitions/${definition}` });
    assert.equal(validate(value), true, JSON.stringify(validate.errors));
  }
  assert.equal(
    validateRequest({
      jsonrpc: "2.0",
      id: "one",
      method: "agent_run.subscribe",
      params: { ref, after_seq: 0 }
    }),
    true
  );
  for (const invalid of [
    [],
    { jsonrpc: "2.0", id: 1, method: "status", params: {} },
    {
      jsonrpc: "2.0",
      id: "one",
      method: "agent_run.subscribe",
      params: { ref: { run_id: "one" }, after_seq: 0 }
    }
  ])
    assert.equal(validateRequest(invalid), false);
});
