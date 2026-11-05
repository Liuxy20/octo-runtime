import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { attachKernel, KernelError, RuntimeHomeError } from "@mininglamp-oss/octo-runtime-client";
import * as protocol from "@mininglamp-oss/octo-runtime-client/protocol";
import schema from "@mininglamp-oss/octo-runtime-client/protocol/schema.json" with { type: "json" };
import ipcSchema from "@mininglamp-oss/octo-runtime-client/protocol/ipc-schema.json" with { type: "json" };
import fixtures from "@mininglamp-oss/octo-runtime-client/protocol/ipc-fixtures.json" with { type: "json" };
import behavior from "@mininglamp-oss/octo-runtime-client/protocol/behavior.json" with { type: "json" };

const [endpoint, inputPath] = process.argv.slice(2);
const input = {
  ...JSON.parse(await readFile(inputPath, "utf8")),
  runId: randomUUID(),
  invocationId: randomUUID()
};
assert.ok(schema && ipcSchema && fixtures && behavior);
const invalidEndpoint = `token=${randomUUID()}`;
let pathDiagnostic;
assert.throws(
  () => attachKernel({ endpoint: invalidEndpoint }),
  (error) => {
    assert.ok(error instanceof RuntimeHomeError);
    assert.equal(error.code, "IPC_ENDPOINT_INVALID");
    const diagnostic = error.diagnostic;
    assert.equal(diagnostic.rootCode, error.code);
    assert.equal(diagnostic.path, diagnostic.context.path);
    assert.equal(diagnostic.action, diagnostic.actions.join(" "));
    assert.equal(Object.hasOwn(JSON.parse(JSON.stringify(diagnostic)), "path"), false);
    assert.ok(!JSON.stringify(diagnostic).includes(invalidEndpoint));
    pathDiagnostic = diagnostic;
    return true;
  }
);
const client = attachKernel({ endpoint });
try {
  assert.equal((await client.status()).ipc_version, 1);
  assert.ok((await client.list()).length > 0);
  const events = await Array.fromAsync(client.invoke(input));
  assert.equal(events.at(-1).type, "run.completed");
} finally {
  client.close();
}
await assert.rejects(client.status(), KernelError);

if (process.argv.includes("--paired")) {
  const full = await import("@mininglamp-oss/octo-runtime/executor-kernel");
  const fullProtocol = await import("@mininglamp-oss/octo-runtime/protocol");
  const runtimeEntry = import.meta.resolve("@mininglamp-oss/octo-runtime/executor-kernel");
  const internalClient = await import(
    new URL("../../node_modules/@mininglamp-oss/octo-runtime-client/dist/index.js", runtimeEntry)
  );
  assert.equal(full.attachKernel, internalClient.attachKernel);
  assert.equal(full.KernelError, internalClient.KernelError);
  assert.equal(full.RuntimeHomeError, internalClient.RuntimeHomeError);
  assert.equal(pathDiagnostic.actions[0], full.STARTUP_CATALOG.IPC_ENDPOINT_INVALID.action);
  assert.throws(() => full.attachKernel({ endpoint: "relative-endpoint" }), full.RuntimeHomeError);
  const internalProtocol = await import(
    new URL("../../node_modules/@mininglamp-oss/octo-runtime-protocol/dist/index.js", runtimeEntry)
  );
  assert.equal(fullProtocol.assertInvokeInput, internalProtocol.assertInvokeInput);
  assert.notEqual(full.KernelError, KernelError);
  for (const value of [input, {}, { ...input, protocol_mode: "unknown" }]) {
    const outcome = (validate) => {
      try {
        validate(value);
        return "valid";
      } catch (error) {
        return error.message;
      }
    };
    assert.equal(outcome(protocol.assertInvokeInput), outcome(fullProtocol.assertInvokeInput));
  }
  const { testAdapter } = await import("./adapter.mjs");
  const home = new URL("./native-home/", import.meta.url);
  await mkdir(home);
  const { fileURLToPath } = await import("node:url");
  const { componentEndpoint } = await import("@mininglamp-oss/octo-runtime/host");
  const nativeEndpoint = componentEndpoint(fileURLToPath(home));
  const service = full.createKernelService({
    home: fileURLToPath(home),
    endpoint: nativeEndpoint,
    adapters: [testAdapter]
  });
  let attached;
  try {
    await service.initialize();
    assert.equal((await service.status()).pid, process.pid);
    assert.equal((await service.client.status()).pid, process.pid);
    const runInput = { ...input, runId: "native-run", invocationId: "native-invocation" };
    assert.equal(
      (await Array.fromAsync(service.client.invoke(runInput))).at(-1).type,
      "run.completed"
    );
    attached = attachKernel({ endpoint: nativeEndpoint });
    assert.equal((await attached.status()).pid, process.pid);
    attached.close();
    assert.equal((await service.client.status()).execution_ready, true);
  } finally {
    attached?.close();
    assert.equal((await service.close()).complete, true);
  }
}
console.log("client consumer passed");
