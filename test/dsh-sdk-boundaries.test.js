import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { PassThrough } from "node:stream";
import { pathToFileURL } from "node:url";

const adapterRequire = createRequire(
  new URL("../packages/octo-runtime-adapter-dsh/package.json", import.meta.url)
);
const require = createRequire(adapterRequire.resolve("@deepseek-ai/dsh-sdk-client/package.json"));
const { JsonRpcLineTransport } = await import(
  pathToFileURL(require.resolve("@deepseek-ai/dsh-sdk-protocol"))
);
const { HarnessClient } = await import(
  pathToFileURL(require.resolve("@deepseek-ai/dsh-sdk-client"))
);

test("official Protocol preserves fragmented UTF-8, CRLF and several lines per chunk", (t) => {
  const input = new PassThrough();
  const output = new PassThrough();
  const transport = new JsonRpcLineTransport(input, output);
  transport.start();
  t.after(() => {
    transport.close();
    input.destroy();
    output.destroy();
  });
  const frame =
    JSON.stringify({ jsonrpc: "2.0", method: "fixture", params: { text: "界" } }) + "\r";
  const bytes = Buffer.from(frame + "\n");
  const received = [];
  transport.onNotification((method, params) => received.push({ method, params }));
  const split = bytes.indexOf(Buffer.from("界")) + 1;
  input.write(bytes.subarray(0, split));
  input.write(Buffer.concat([bytes.subarray(split), bytes, bytes]));
  assert.equal(received.length, 3);
  assert.ok(received.every((value) => value.params.text === "界"));
});

test("official subscription close rejects a pending read immediately", async () => {
  const client = new HarnessClient();
  const subscription = client.subscribe(() => false);
  const pending = subscription.next();
  subscription.close();
  await assert.rejects(pending, { name: "TransportClosedError" });
  await client.close();
});

test("official false-filter subscription processes all notifications and keeps next pending until close", async () => {
  const client = new HarnessClient({
    dshBin: new URL("./fixtures/dsh-runtime.mjs", import.meta.url).pathname,
    initializeTimeoutMs: 2000,
    requestTimeoutMs: 2000,
    shutdownTimeoutMs: 500,
    env: { ...process.env, OCTO_DSH_FIXTURE: "child" }
  });
  let received = 0;
  let settled = false;
  const subscription = client.subscribe(() => {
    received++;
    return false;
  });
  const pending = subscription.next().then(
    () => {
      settled = true;
      return undefined;
    },
    (error) => {
      settled = true;
      return error;
    }
  );
  try {
    await client.initialize({ cwd: process.cwd(), provider: "fixture", model: "fixture" });
    await client.prompt("subscription-review", [{ type: "text", text: "hello" }]);
    await client.request("session/wait", { sessionId: "subscription-review" }, 2000);
    assert.equal(received, 15);
    assert.equal(settled, false);
    assert.equal(subscription.tryNext(), undefined);
  } finally {
    try {
      await client.close();
    } finally {
      subscription.close();
    }
  }
  assert.equal((await pending).name, "TransportClosedError");
});
