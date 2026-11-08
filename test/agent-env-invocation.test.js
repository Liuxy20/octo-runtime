import test from "node:test";
import assert from "node:assert/strict";
import { attachKernel, isInvocationNotSubmitted } from "@mininglamp-oss/octo-runtime-client";
import { kernelFixture, kernelInput } from "./kernel-fixture.js";
import { testAdapter } from "./fixtures/invoke-adapter.js";
const env = { schema: "octo.context-envelope/v3", items: [] };
const inputs = [{ type: "text", text: "hello" }];

test("flat invoke identifies and freezes a run before IO; interrupt before next prevents submission", async () => {
  const client = attachKernel({ endpoint: "/tmp/octo-not-listening-agent-env.sock" });
  try {
    const run = client.invoke(inputs, "business-session", undefined, env);
    assert.ok(run.invocationId && run.runId);
    assert.equal(run.sessionId, "business-session");
    assert.equal(client.invocations.snapshot().length, 1);
    assert.deepEqual(await client.interrupt(run.invocationId), { accepted: true });
    await assert.rejects(run.next(), isInvocationNotSubmitted);
    assert.deepEqual(client.invocations.snapshot(), []);
    assert.equal("cancelInvocation" in client, false);
    assert.throws(() => client.invoke({ inputs, contexts: env }), /requires inputs/);
  } finally {
    client.close();
  }
});

test("throw/return before first next release all client admission capacity", async () => {
  const client = attachKernel({ endpoint: "/tmp/octo-not-listening-agent-env.sock" });
  try {
    for (let i = 0; i < 140; i++) {
      const run = client.invoke(inputs, undefined, undefined, env);
      if (i % 2) await run.return();
      else {
        const error = new Error("application stopped observing");
        await assert.rejects(run.throw(error), (e) => e === error);
      }
    }
    assert.deepEqual(client.invocations.snapshot(), []);
  } finally {
    client.close();
  }
});

test("late next/return from an interrupted handle cannot unregister a new invocation reusing its ID", async () => {
  const client = attachKernel({ endpoint: "/tmp/octo-not-listening-agent-env.sock" });
  try {
    const first = client.invoke(
      { parts: inputs, invocationId: "same", runId: "first" },
      "s",
      undefined,
      env
    );
    await client.interrupt(first.invocationId);
    const next = client.invoke(
      { parts: inputs, invocationId: "same", runId: "second" },
      "s",
      undefined,
      env
    );
    await assert.rejects(first.next(), isInvocationNotSubmitted);
    await first.return();
    assert.equal(client.invocations.snapshot()[0].key.run_id, "second");
    await client.interrupt(next.invocationId);
    await assert.rejects(next.next(), isInvocationNotSubmitted);
  } finally {
    client.close();
  }
});

test("client snapshot preserves inputs and reusable agentEnv without business rendering", async (t) => {
  const { client } = await kernelFixture(t, { adapters: [testAdapter] });
  const input = kernelInput("plain application history");
  const parts = structuredClone(input.inputs),
    agentEnv = structuredClone(input.agentEnv);
  const run = client.invoke(parts, "s", undefined, agentEnv);
  parts[0].text = "mutated";
  agentEnv.items.length = 0;
  const frames = await Array.fromAsync(run);
  const output = frames.find((f) => f.kind === "native").payload;
  assert.deepEqual(output.inputs, input.inputs);
  assert.deepEqual(output.agentEnv.items, input.agentEnv.items);
  assert.equal(frames.at(-1).control.state, "completed");
});
