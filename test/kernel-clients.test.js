import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { attachKernel } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { isHostTerminal } from "@mininglamp-oss/octo-runtime-protocol";
import { kernelFixture, kernelInput, frames } from "./kernel-fixture.js";

test("independent clients observe one accepted source and terminal without owning its lifetime", async (t) => {
  const { client, endpoint } = await kernelFixture(t);
  const { ref } = await client.submit(kernelInput());
  client.close();
  const reader = attachKernel({ endpoint });
  t.after(() => reader.close());
  const events = await frames(reader, ref);
  assert.ok(events.length > 2);
  assert.equal(events.filter(isHostTerminal).length, 1);
  const info = await reader.get(ref, ref.kernel_instance_id);
  assert.equal(info.latest_seq, events.at(-1).seq);
  assert.deepEqual(await frames(reader, ref, info.latest_seq), []);
  assert.equal(events.at(-1).control.state, "completed");
});
test("every control and subscription validates full identity and Kernel generation", async (t) => {
  const { client } = await kernelFixture(t);
  const { ref } = await client.submit(kernelInput());
  await frames(client, ref);
  for (const field of [
    "invocation_id",
    "agent_session_id",
    "stream_id",
    "protocol_mode",
    "session_generation"
  ]) {
    const invalid = {
      ...ref,
      [field]:
        field === "session_generation"
          ? ref[field] + 1
          : field === "protocol_mode"
            ? ref.protocol_mode === "native"
              ? "canonical"
              : "native"
            : "wrong"
    };
    await assert.rejects(client.cancel(invalid), /RUN_IDENTITY_MISMATCH/);
    await assert.rejects(frames(client, invalid), /RUN_IDENTITY_MISMATCH/);
  }
  await assert.rejects(
    client.cancel({ ...ref, kernel_instance_id: "old" }),
    /KERNEL_INSTANCE_CHANGED/
  );
  await assert.rejects(frames(client, ref, -1), /STREAM_CURSOR_INVALID/);
});

test("lost invoke ACK is recovered by original identity without a second invoke", async (t) => {
  const { endpoint, directory, client } = await kernelFixture(t);
  const relay =
    process.platform === "win32"
      ? `\\\\.\\pipe\\octo-test-${randomUUID()}`
      : join(directory, "p.sock");
  let invocations = 0;
  const connections = new Set();
  const server = net.createServer((downstream) => {
    const upstream = net.createConnection(endpoint);
    connections.add(downstream);
    connections.add(upstream);
    downstream.once("close", () => {
      connections.delete(downstream);
      upstream.destroy();
    });
    upstream.once("close", () => connections.delete(upstream));
    downstream.on("error", () => {});
    upstream.on("error", () => downstream.destroy());
    let pending = "",
      drop = false;
    downstream.on("data", (chunk) => {
      pending += chunk;
      if (pending.includes("\n")) {
        const request = JSON.parse(pending);
        drop = request.method === "agent_run.invoke";
        if (drop) invocations++;
      }
      upstream.write(chunk);
    });
    upstream.on("data", (chunk) => {
      if (drop) {
        downstream.destroy();
        upstream.destroy();
      } else downstream.write(chunk);
    });
    upstream.once("end", () => downstream.end());
  });
  await new Promise((resolve) => server.listen(relay, resolve));
  t.after(async () => {
    for (const socket of connections) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  });
  const submitter = attachKernel({ endpoint: relay });
  t.after(() => submitter.close());
  const { ref } = await submitter.submit(kernelInput());
  assert.equal(invocations, 1);
  const events = await frames(client, ref);
  assert.equal(events.filter(isHostTerminal).length, 1);
  assert.equal(events.at(-1).control.state, "completed");
});
test("malformed peers affect only their connections", async (t) => {
  const { endpoint, client } = await kernelFixture(t);
  for (const line of ["{bad\n", "[]\n", '{"jsonrpc":"2.0","id":1,"method":"status"}\n']) {
    await new Promise((resolve) => {
      const socket = net.createConnection(endpoint);
      socket.on("error", () => {});
      socket.on("data", () => {});
      socket.once("connect", () => socket.end(line));
      socket.once("close", resolve);
    });
  }
  assert.equal((await client.status()).execution_ready, true);
});
