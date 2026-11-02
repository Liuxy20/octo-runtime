import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { AcpClient } from "@mininglamp-oss/octo-runtime-acp-client";
import { resolveStreamLimitPolicy } from "@mininglamp-oss/octo-runtime-protocol";

function fixture(overrides) {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: 0,
    signalCode: null
  });
  return {
    child,
    client: new AcpClient({
      child,
      ...(overrides ? { streamLimits: resolveStreamLimitPolicy(overrides) } : {})
    }),
    send: (message) => child.stdout.write(JSON.stringify(message) + "\n")
  };
}
for (const limit of ["count", "bytes"]) {
  test(`ACP ${limit} overflow discards queued events, fails only that client and rejects later input`, async () => {
    const { child, client, send } = fixture(
      limit === "count"
        ? { adapterQueueMaxItems: 16 }
        : {
            rawMessageMaxBytes: 96 * 1024,
            adapterQueueItemMaxBytes: 128 * 1024,
            adapterQueueMaxBytes: 256 * 1024
          }
    );
    const stream = client.prompt("s", "input");
    const first = stream.next();
    const update = {
      method: "session/update",
      params: { sessionId: "s", update: { text: limit === "count" ? "x" : "x".repeat(64 * 1024) } }
    };
    send(update);
    await first;
    for (let i = 0; i < (limit === "count" ? 17 : 5); i++) send(update);
    const code = limit === "count" ? "STREAM_QUEUE_ITEMS_EXCEEDED" : "STREAM_QUEUE_BYTES_EXCEEDED";
    await assert.rejects(stream.next(), new RegExp(code));
    await assert.rejects(client.initialize(), new RegExp(code));
    assert.equal(child.stdout.listenerCount("data"), 0);
    await client.close();
    const sibling = fixture();
    const request = sibling.client.initialize();
    sibling.send({ id: 1, result: {} });
    assert.deepEqual(await request, {});
    await sibling.client.close();
  });
}

test("ACP bounds an unterminated line before JSON parsing", async () => {
  const { child, client } = fixture({ rawMessageMaxBytes: 256 * 1024 });
  const request = client.initialize();
  child.stdout.write("x".repeat(256 * 1024));
  child.stdout.write("x");
  await assert.rejects(request, (error) => {
    assert.match(error.message, /PROVIDER_MESSAGE_TOO_LARGE/);
    assert.equal(error.boundary, "acp.stdout");
    assert.equal(error.measuredBytes, 256 * 1024 + 1);
    assert.equal(error.limitBytes, 256 * 1024);
    return true;
  });
  assert.equal(child.stdout.destroyed, true);
  await client.close();
});

test("ACP accepts the observed 1.43 MB provider response under the default policy", async () => {
  const { client, send } = fixture();
  const request = client.initialize();
  send({ id: 1, result: { output: "x".repeat(1_430_765) } });
  assert.equal((await request).output.length, 1_430_765);
  await client.close();
});

test("ACP image prompt permits bounded large RPC echo while retaining event queue limits", async () => {
  const { client, send } = fixture();
  const stream = client.prompt("s", [{ type: "image", mimeType: "image/png", data: "fixture" }]);
  const next = stream.next();
  const rpc = client.request("probe", {});
  send({ id: 2, result: { echo: "x".repeat(300 * 1024) } });
  assert.equal((await rpc).echo.length, 300 * 1024);
  send({ id: 1, result: { stopReason: "end_turn" } });
  assert.equal((await next).value.type, "prompt_result");
  assert.equal((await stream.next()).done, true);
  await client.close();
});

test("ACP preserves accepted prompt completion when the process exits before the consumer resumes", async () => {
  const { client, send, child } = fixture();
  const stream = client.prompt("s", "input");
  const first = stream.next();
  send({ method: "session/update", params: { sessionId: "s", update: { text: "answer" } } });
  await first;
  send({ id: 1, result: { stopReason: "end_turn" } });
  await new Promise((resolve) => setImmediate(resolve));
  child.emit("exit", 0, null);
  assert.equal((await stream.next()).value.type, "prompt_result");
  assert.equal((await stream.next()).done, true);
  await client.close();
});
