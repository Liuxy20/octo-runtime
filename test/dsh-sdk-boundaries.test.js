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

function endpoint(t, maxLineBytes, onError) {
  const input = new PassThrough();
  const output = new PassThrough();
  const transport = new JsonRpcLineTransport(input, output, { maxLineBytes, onError });
  transport.start();
  t.after(() => {
    transport.close();
    input.destroy();
    output.destroy();
  });
  return { input, output, transport };
}

test("official Protocol accepts an exact byte budget with split UTF-8, CRLF and several lines per chunk", (t) => {
  const frame =
    JSON.stringify({ jsonrpc: "2.0", method: "fixture", params: { text: "界" } }) + "\r";
  const bytes = Buffer.from(frame + "\n");
  const { input, transport } = endpoint(t, Buffer.byteLength(frame));
  const received = [];
  transport.onNotification((method, params) => received.push({ method, params }));
  const split = bytes.indexOf(Buffer.from("界")) + 1;
  input.write(bytes.subarray(0, split));
  input.write(Buffer.concat([bytes.subarray(split), bytes, bytes]));
  assert.equal(received.length, 3);
  assert.ok(received.every((value) => value.params.text === "界"));
});

test("official Protocol rejects a partial line before parsing and rejects pending and future requests", async (t) => {
  const failures = [];
  const { input, transport } = endpoint(t, 32, (error) => failures.push(error));
  const pending = transport.request("initialize", {});
  input.write(Buffer.alloc(32, 120));
  assert.equal(failures.length, 0);
  input.write(Buffer.from("x"));
  await assert.rejects(pending, { code: "PROVIDER_MESSAGE_TOO_LARGE" });
  await assert.rejects(transport.request("shutdown", {}), { code: "PROVIDER_MESSAGE_TOO_LARGE" });
  assert.equal(failures.length, 1);
  assert.equal(input.listenerCount("data"), 0);
});

test("official Protocol enforces response limits and stops later notifications in the same chunk", async (t) => {
  const { input, output, transport } = endpoint(t, 128);
  let received = 0;
  transport.onNotification(() => received++);
  const pending = transport.request("initialize", {});
  const { id } = JSON.parse(output.read().toString());
  input.write(
    JSON.stringify({ jsonrpc: "2.0", id, result: { padding: "x".repeat(129) } }) +
      "\n" +
      JSON.stringify({ method: "fixture" }) +
      "\n"
  );
  await assert.rejects(pending, { code: "PROVIDER_MESSAGE_TOO_LARGE" });
  assert.equal(received, 0);
});

test("official Protocol rejects oversized input before invoking JSON.parse", (t) => {
  const failures = [];
  const { input } = endpoint(t, 32, (error) => failures.push(error));
  const original = JSON.parse;
  let parses = 0;
  JSON.parse = (...args) => {
    parses++;
    return original(...args);
  };
  try {
    input.write(Buffer.from(JSON.stringify({ padding: "x".repeat(33) }) + "\n"));
  } finally {
    JSON.parse = original;
  }
  assert.equal(parses, 0);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].code, "PROVIDER_MESSAGE_TOO_LARGE");
});

test("official Protocol budgets raw bytes rather than reserialized numeric values", (t) => {
  const failures = [];
  const { input, transport } = endpoint(t, 1024, (error) => failures.push(error));
  const frame =
    '{"jsonrpc":"2.0","method":"fixture.metric","params":{"values":[' +
    Array(100).fill("1e20").join(",") +
    "]}}\r";
  let notification;
  transport.onNotification((method, params) => {
    notification = { method, params };
  });
  input.write(frame + "\n");
  assert.equal(Buffer.byteLength(frame), 566);
  assert.equal(Buffer.byteLength(JSON.stringify(notification)), 2249);
  assert.equal(failures.length, 0);
});

for (const mode of ["stderr-line", "stderr-partial"])
  test(`official Client bounds retained ${mode} diagnostics after unexpected process exit`, async () => {
    const client = new HarnessClient({
      dshBin: new URL("./fixtures/dsh-runtime.mjs", import.meta.url).pathname,
      rawMessageMaxBytes: 1024,
      initializeTimeoutMs: 2000,
      env: { ...process.env, OCTO_DSH_FIXTURE: mode }
    });
    try {
      await assert.rejects(
        client.initialize({ cwd: process.cwd(), provider: "fixture", model: "fixture" }),
        (error) =>
          error.name === "TransportClosedError" && Buffer.byteLength(error.message) < 70 * 1024
      );
    } finally {
      await client.close();
    }
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
