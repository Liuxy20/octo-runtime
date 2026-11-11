import { withAgentEnvItems } from "../packages/octo-runtime-adapter-sdk/dist/index.js";
import { invokeClient } from "../test-support/invoke-client.js";
import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { kernelFixture } from "./kernel-fixture.js";
import net from "node:net";
import { once } from "node:events";
import {
  INVOKE_REQUEST_MAX_BYTES,
  resolveStreamLimitPolicy
} from "../packages/octo-runtime-protocol/dist/index.js";
import { readBoundedLines } from "../packages/octo-runtime-adapter-sdk/dist/index.js";
import { createScopedCodexAdapter as createCodexAdapter } from "../test-support/scoped-codex-adapter.mjs";
import { invokeRequest } from "./runtime-fixture.js";
import { fileURLToPath } from "node:url";
const input = () => ({
  inputs: [{ type: "text", text: "test" }],
  agentEnv: withAgentEnvItems(
    {
      ...{
        schema: "octo.context-envelope/v3",
        items: [{ namespace: "octo.execution", name: "adapter", payload: { type: "size-fixture" } }]
      }
    },
    [
      { namespace: "octo.execution", name: "workspace", payload: { path: process.cwd() } },
      { namespace: "octo.security", name: "approval_policy", payload: { mode: "full_access" } }
    ]
  ),
  protocol_mode: "canonical",
  invocationId: randomUUID(),
  runId: randomUUID(),
  sessionId: randomUUID()
});
async function fixture(t, invoke) {
  return kernelFixture(t, {
    adapters: [
      {
        metadata: {
          type: "size-fixture",

          protocolSupport: { protocol: "size-fixture", modes: ["canonical"], nativeMethods: [] }
        },
        invoke:
          invoke ??
          async function* () {
            yield { protocolVersion: 2, type: "run.completed", payload: {} };
          }
      }
    ]
  });
}
const collect = async (source) => {
  const events = [];
  for await (const e of source) events.push(e);
  return events;
};
test("Kernel RPC accepts a bounded request and rejects oversized input before execution", async (t) => {
  let calls = 0;
  const { client } = await fixture(t, async function* () {
    calls++;
    yield { protocolVersion: 2, type: "run.completed", payload: {} };
  });
  const large = input();
  large.runMetadata = { padding: "x".repeat(INVOKE_REQUEST_MAX_BYTES - 4096) };
  assert.equal((await collect(invokeClient(client, large))).at(-1).type, "run.completed");
  assert.equal(calls, 1);
  large.runMetadata.padding += "x".repeat(4096);
  assert.throws(() => invokeClient(client, large), /INVOKE_REQUEST_TOO_LARGE/);
  assert.equal(calls, 1);
  assert.equal((await collect(invokeClient(client, input()))).at(-1).type, "run.completed");
});
test("oversized raw line does not abort an active run or the next invocation", async (t) => {
  let started, finish;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const completed = new Promise((resolve) => {
    finish = resolve;
  });
  let calls = 0;
  const { client, endpoint } = await fixture(t, async function* () {
    if (++calls === 1) {
      started();
      await completed;
    }
    yield { protocolVersion: 2, type: "run.completed", payload: {} };
  });
  const active = collect(invokeClient(client, input()));
  await ready;
  const upstream = net.createConnection(endpoint);
  upstream.on("error", () => {});
  t.after(() => upstream.destroy());
  await once(upstream, "connect");
  const dropped = new Promise((resolve) => upstream.once("close", resolve));
  upstream.write(Buffer.alloc(INVOKE_REQUEST_MAX_BYTES, 120));
  upstream.write("overflow");
  upstream.write("\n");
  await dropped;
  finish();
  assert.equal((await active).at(-1).type, "run.completed");
  assert.equal((await collect(invokeClient(client, input()))).at(-1).type, "run.completed");
});
test("bounded receiver preserves split UTF-8 and recovers after discarded records", () => {
  const stream = new PassThrough(),
    lines = [];
  let overflow = 0;
  const stop = readBoundedLines(stream, 8, {
    onLine: (line) => lines.push(line),
    onTooLarge: () => overflow++,
    onError: (e) => {
      throw e;
    },
    onClose() {}
  });
  const utf8 = Buffer.from("汉字\n12345678\n");
  for (const byte of utf8) stream.write(Buffer.from([byte]));
  stream.write("123456789");
  stream.write(" discarded\nok\n");
  assert.deepEqual(lines, ["汉字", "12345678", "ok"]);
  assert.equal(overflow, 1);
  stop();
});
test("unterminated oversized record has a finite discard timeout", async () => {
  const stream = new PassThrough();
  let error;
  const closed = new Promise((resolve) =>
    readBoundedLines(stream, 8, {
      onLine() {},
      onTooLarge() {},
      onError: (e) => {
        error = e;
      },
      onClose: resolve,
      discardTimeoutMs: 20
    })
  );
  const keepAlive = setTimeout(() => {}, 1000);
  stream.write("x".repeat(9));
  try {
    await closed;
    assert.match(error.message, /RPC_OVERSIZED_RECORD_TIMEOUT/);
  } finally {
    clearTimeout(keepAlive);
  }
});
test("Codex canonical accepts bounded image echoes and excludes hydrated resume history", async () => {
  const bytes = randomBytes(2 * 1024 * 1024);
  Buffer.from("89504e470d0a1a0a", "hex").copy(bytes);
  const image = {
    type: "image",
    mimeType: "image/png",
    data: bytes.toString("base64"),
    byteSize: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex")
  };
  const adapter = createCodexAdapter({
    command: process.execPath,
    appServerArgs: [
      fileURLToPath(new URL("../test-support/fake-codex-image-echo.mjs", import.meta.url))
    ]
  });
  for (const count of [1, 2, 4]) {
    const images = Array.from({ length: count }, () => image);
    const parts = [{ type: "text", text: "images" }, ...images];
    const events = await collect(
      adapter.invoke(
        invokeRequest({ modelInputParts: parts, freshFallbackModelInputParts: parts }),
        { protocolMode: "canonical" }
      )
    );
    assert.equal(events.at(-1).type, "run.completed");
    assert.ok(Buffer.byteLength(JSON.stringify(events)) < 256 * 1024);
  }
  const resumed = await collect(
    adapter.invoke(invokeRequest({ providerSession: { sessionId: "image-thread" } }), {
      protocolMode: "canonical"
    })
  );
  assert.equal(resumed.at(-1).type, "run.completed");
  const invalid = await collect(
    adapter.invoke(
      invokeRequest({
        modelInputParts: [{ type: "text", text: "oversized-other-content" }, image]
      }),
      {
        protocolMode: "canonical",
        streamLimits: resolveStreamLimitPolicy({ rawMessageMaxBytes: 256 * 1024 })
      }
    )
  );
  assert.equal(invalid.at(-1).type, "run.failed");
  assert.match(invalid.at(-1).payload.message, /PROVIDER_MESSAGE_TOO_LARGE/);
});
