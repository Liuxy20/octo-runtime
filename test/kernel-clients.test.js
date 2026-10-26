import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { attachKernel } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { isHostTerminal } from "@mininglamp-oss/octo-runtime-protocol";
import { kernelFixture, kernelInput, frames } from "./kernel-fixture.js";
import { kernelRelay } from "./kernel-relay.js";

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
  const fixture = await kernelFixture(t);
  const relay = await kernelRelay(t, fixture, {
    response(_value, connection) {
      if (connection.request.method === "agent_run.invoke") {
        connection.disconnect();
        return false;
      }
    }
  });
  const { ref } = await relay.client.submit(kernelInput());
  assert.equal(relay.count("agent_run.invoke"), 1);
  const events = await frames(fixture.client, ref);
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
