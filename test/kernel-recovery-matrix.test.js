import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { attachKernel } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { kernelFixture, kernelInput, frames } from "./kernel-fixture.js";
import { kernelRelay } from "./kernel-relay.js";

test("ACK and stream loss preserve one admission; old/new clients and sessions recover without Kernel restart", async (t) => {
  const fixture = await kernelFixture(t, {
    manifest: resolve("test/fixtures/invoke-adapters.json")
  });
  const startsFile = join(fixture.directory, "starts");
  let ackLost = false,
    streamLost = false;
  const relay = await kernelRelay(t, fixture, {
    response(value, connection) {
      if (connection.request.method === "agent_run.invoke" && !ackLost) {
        ackLost = true;
        connection.disconnect();
      } else if (value.method === "agent_run.event" && value.params.seq === 2 && !streamLost) {
        streamLost = true;
        connection.disconnect();
      }
    }
  });
  const original = await fixture.client.status();
  const input = kernelInput("recovery", { runMetadata: { startsFile } });
  const observed = [];
  for await (const frame of relay.client.invoke(input)) observed.push(frame);
  assert.equal(ackLost, true);
  assert.equal(streamLost, true);
  assert.equal(relay.count("agent_run.invoke"), 1);
  assert.equal(await readFile(startsFile, "utf8"), "start\n");
  assert.equal(observed.at(-1).type, "run.completed");

  const fresh = attachKernel({ endpoint: fixture.endpoint });
  t.after(() => fresh.close());
  for (const client of [relay.client, fresh]) {
    for (const agentSessionId of ["session-test", "new-session"]) {
      const next = await client.submit(kernelInput("fresh", { agentSessionId }));
      assert.equal((await frames(client, next.ref)).at(-1).control.state, "completed");
      assert.equal(next.ref.kernel_instance_id, original.kernel_instance_id);
    }
  }
  assert.equal((await fixture.client.status()).worker.generation, original.worker.generation);
});
