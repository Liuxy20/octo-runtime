import { invokeClient } from "../test-support/invoke-client.js";
import { testAdapter as invokeAdapter } from "./fixtures/invoke-adapter.js";
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getEventListeners } from "node:events";
import { createHash } from "node:crypto";
import net from "node:net";
import { attachKernel } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { resolve, join } from "node:path";
import { isHostTerminal } from "@mininglamp-oss/octo-runtime-protocol";
import { kernelFixture, kernelInput, frames } from "./kernel-fixture.js";
import { kernelRelay } from "./kernel-relay.js";
import { waitFor } from "./runtime-fixture.js";

export const collect = async (source, values = []) => {
  for await (const value of source) values.push(value);
  return values;
};
const fixture = (t) => kernelFixture(t, { adapters: [invokeAdapter] });

test("native Kernel close waits for the Adapter probe's actual completion", async (t) => {
  let entered = false,
    finished = false,
    release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const adapter = {
    ...invokeAdapter,
    async probe() {
      assert.equal(this, adapter);
      entered = true;
      await gate;
      finished = true;
      return { available: true, command: "fixture" };
    }
  };
  const f = await kernelFixture(t, { adapters: [adapter] });
  const listing = f.client.list().catch(() => undefined);
  await waitFor(() => entered);
  let closed = false;
  const closing = f.server.close().then((result) => {
    closed = true;
    return result;
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(closed, false, "socket closure must not stand in for probe completion");
  } finally {
    release();
  }
  assert.equal((await closing).complete, true);
  assert.equal(finished, true);
  await listing;
});

test("native Kernel probe display timeout does not erase unfinished cleanup", async (t) => {
  let finished = false,
    release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const adapter = {
    ...invokeAdapter,
    async probe() {
      await gate;
      finished = true;
      return { available: true, command: "fixture" };
    }
  };
  const f = await kernelFixture(t, { adapters: [adapter], expectedCleanupComplete: false });
  try {
    const listing = await f.client.list();
    assert.equal(listing[0].unavailableReason, "probe_timeout");
    assert.equal(finished, false);
    assert.equal((await f.server.close()).complete, false);
    assert.equal(finished, false);
  } finally {
    release();
    await gate;
  }
});

for (const mode of ["native", "canonical"])
  test(`${mode} interaction controls route by invocation ID and reject other clients`, async (t) => {
    const f = await fixture(t),
      input = { ...kernelInput("interaction"), protocol_mode: mode };
    const response =
      mode === "native"
        ? { requestId: 42, payload: { id: 42, result: "approved" } }
        : { interactionId: "approval", outcome: "accepted" };
    const method = mode === "native" ? "respondNativeInteraction" : "respondInteraction";
    const stranger = attachKernel({ endpoint: f.endpoint });
    t.after(() => stranger.close());
    const values = [];
    for await (const value of invokeClient(f.client, input)) {
      values.push(value);
      if (
        mode === "native"
          ? value.kind === "native" && value.messageKind === "request"
          : value.type === "interaction.requested"
      ) {
        await assert.rejects(
          stranger[method](input.invocationId, response),
          /INVOCATION_NOT_TRACKED/
        );
        await f.client[method](input.invocationId, response);
        await assert.rejects(f.client[method](input.invocationId, response));
      }
    }
    assert.equal(
      mode === "native" ? values.at(-1).control.state : values.at(-1).type,
      mode === "native" ? "completed" : "run.completed",
      JSON.stringify(values)
    );
    await assert.rejects(f.client[method](input.invocationId, response), /INVOCATION_NOT_TRACKED/);
  });

test("explicit invocation cancellation shares one intent and does not claim a terminal", async (t) => {
  const f = await fixture(t),
    relay = await kernelRelay(t, f);
  const input = { ...kernelInput("wait-for-cancel"), protocol_mode: "native" };
  const iterator = invokeClient(relay.client, input);
  await iterator.next();
  const [first, second] = await Promise.all([
    relay.client.interrupt(input.invocationId),
    relay.client.interrupt(input.invocationId)
  ]);
  assert.equal(first.accepted, true);
  assert.deepEqual(first, second);
  assert.equal(relay.count("agent_run.cancel"), 1);
  const values = await collect(iterator);
  assert.equal(values.at(-1).control.state, "cancelled");
});

for (const code of [
  "STREAM_GAP",
  "STREAM_EXPIRED",
  "STREAM_CURSOR_INVALID",
  "KERNEL_INSTANCE_CHANGED",
  "RUN_IDENTITY_MISMATCH"
])
  test(`invoke propagates ${code} without re-execution`, async (t) => {
    const f = await fixture(t);
    const relay = await kernelRelay(t, f, {
      request(request) {
        if (request.method === "agent_run.subscribe")
          return {
            ...request,
            params: {
              ...request.params,
              ...(code === "STREAM_CURSOR_INVALID" ? { after_seq: -1 } : {})
            }
          };
      },
      response(value, c) {
        if (c.request.method === "agent_run.subscribe" && value.id)
          return {
            jsonrpc: "2.0",
            id: value.id,
            error: { code: -32000, data: { code } }
          };
      }
    });
    await assert.rejects(collect(invokeClient(relay.client, kernelInput())), new RegExp(code));
    assert.equal(relay.count("agent_run.invoke"), 1);
    assert.equal(relay.client.invocations.snapshot().length, 1);
  });

test("stop while status is pending prevents an invocation write after drain deadline", async (t) => {
  const f = await fixture(t);
  let release, reached;
  const barrier = new Promise((resolve) => {
    reached = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const relay = await kernelRelay(t, f, {
    async response(_v, c) {
      if (c.request.method === "status") {
        reached();
        await gate;
      }
    }
  });
  const running = collect(invokeClient(relay.client, kernelInput()));
  const rejected = assert.rejects(running, /INVOCATION_INTERRUPTED_BEFORE_SUBMISSION/);
  await barrier;
  const result = await relay.client.invocations.drain({
    deadline: Date.now() + 50,
    reason: "owner"
  });
  assert.equal(result.complete, true);
  release();
  await rejected;
  assert.equal(relay.count("agent_run.invoke"), 0);
  assert.deepEqual(relay.client.invocations.snapshot(), []);
});

test("owner drain resolves accepted identity while its invoke ACK is still pending", async (t) => {
  const f = await fixture(t);
  let reached, release;
  const barrier = new Promise((resolve) => {
    reached = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const relay = await kernelRelay(t, f, {
    async response(_v, c) {
      if (c.request.method === "agent_run.invoke") {
        reached();
        await gate;
      }
    }
  });
  const iterator = invokeClient(relay.client, kernelInput("wait-for-cancel"));
  const first = iterator.next();
  await barrier;
  const result = await relay.client.invocations.drain({
    deadline: Date.now() + 1000,
    reason: "owner"
  });
  assert.equal(result.complete, true);
  assert.equal(relay.count("agent_run.invoke"), 1);
  assert.equal(relay.count("agent_run.cancel"), 1);
  release();
  const values = [(await first).value, ...(await collect(iterator))];
  assert.ok(values.some((v) => v.type === "run.cancelled"));
  assert.deepEqual(relay.client.invocations.snapshot(), []);
});

test("invoke is lazy, rejects local limits and pre-abort without IO", async (t) => {
  const f = await fixture(t),
    relay = await kernelRelay(t, f);
  const unused = invokeClient(relay.client, kernelInput());
  await unused.return();
  const controller = new AbortController(),
    reason = new Error("before next");
  controller.abort(reason);
  await assert.rejects(
    invokeClient(relay.client, kernelInput(), { signal: controller.signal }).next(),
    /INVOCATION_INTERRUPTED_BEFORE_SUBMISSION/
  );
  await assert.rejects(
    relay.client.submit(kernelInput(), { streamLimits: {} }),
    /KERNEL_STREAM_LIMITS_UNSUPPORTED/
  );
  assert.equal(relay.requests.length, 0);
  assert.deepEqual(relay.client.invocations.snapshot(), []);
});

for (const mode of ["native", "canonical"])
  test(`${mode} invoke uses real IPC, preserves source data and completes once without Extra`, async (t) => {
    const { client } = await fixture(t);
    const input = { ...kernelInput(), protocol_mode: mode };
    const before = structuredClone(input);
    const values = await collect(invokeClient(client, input));
    assert.deepEqual(input, before);
    if (mode === "native") {
      assert.deepEqual(
        values.map((v) => v.seq),
        values.map((_, i) => i + 1)
      );
      assert.equal(values.filter(isHostTerminal).length, 1);
      assert.deepEqual(values.find((v) => v.kind === "native").payload.exact, {
        future: [1, "retained"]
      });
      assert.equal(values.at(-1).control.state, "completed");
    } else assert.equal(values.filter((v) => v.type === "run.completed").length, 1);
    assert.deepEqual(client.invocations.snapshot(), []);
  });

test("native invoke forwards ordered multimodal input and isolated local environment", async (t) => {
  const { client } = await fixture(t);
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const input = {
    ...kernelInput(),
    protocol_mode: "native",
    inputs: [
      { type: "text", text: "first" },
      {
        type: "image",
        mimeType: "image/png",
        data: bytes.toString("base64"),
        byteSize: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex")
      },
      { type: "text", text: "last" }
    ]
  };
  const outputs = await Promise.all(
    ["one", "two"].map(async (value) => {
      const values = await collect(
        invokeClient(client, {
          ...input,
          invocationId: value,
          runId: value,
          agentEnv: {
            ...input.agentEnv,
            items: [
              ...input.agentEnv.items,
              {
                namespace: "octo.execution",
                name: "envs",
                payload: { env_variables: [{ key: "INVOKE_TEST", value }] }
              }
            ]
          }
        })
      );
      return values.find((v) => v.kind === "native").payload;
    })
  );
  assert.deepEqual(
    outputs.map((o) => o.inputs),
    [input.inputs, input.inputs]
  );
  assert.deepEqual(
    outputs.map(
      (o) => o.agentEnv.items.find((item) => item.name === "envs").payload.env_variables[0].value
    ),
    ["one", "two"]
  );
});

for (const recovery of [false, true])
  test(`abort after invoke write keeps admission identity and tail (recover ACK=${recovery})`, async (t) => {
    const f = await fixture(t),
      controller = new AbortController(),
      reason = new Error("caller stop");
    const relay = await kernelRelay(t, f, {
      response(value, connection) {
        if (connection.request.method === "agent_run.invoke") {
          controller.abort(reason);
          if (recovery) {
            connection.disconnect();
            return false;
          }
        }
      }
    });
    const input = kernelInput("wait-for-cancel"),
      values = [];
    await collect(invokeClient(relay.client, input, { signal: controller.signal }), values);
    assert.ok(values.some((v) => v.type === "run.cancelled"));
    assert.equal(relay.count("agent_run.invoke"), 1);
    assert.equal(relay.count("agent_run.cancel"), 1);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    assert.deepEqual(relay.client.invocations.snapshot(), []);
  });

test("abort at status response does not write invoke and preserves reason", async (t) => {
  const f = await fixture(t),
    controller = new AbortController(),
    reason = new Error("status barrier");
  const relay = await kernelRelay(t, f, {
    response(_value, c) {
      if (c.request.method === "status") controller.abort(reason);
    }
  });
  await assert.rejects(
    invokeClient(relay.client, kernelInput(), { signal: controller.signal }).next(),
    /INVOCATION_INTERRUPTED_BEFORE_SUBMISSION/
  );
  assert.equal(relay.count("agent_run.invoke"), 0);
  assert.deepEqual(relay.client.invocations.snapshot(), []);
});

test("abort after the invoke socket connects still prevents its first write", async (t) => {
  const f = await fixture(t),
    controller = new AbortController(),
    reason = new Error("write barrier");
  const connect = net.createConnection;
  let connections = 0,
    writes = 0;
  t.mock.method(net, "createConnection", function (...args) {
    const socket = Reflect.apply(connect, net, args);
    if (args[0] === f.endpoint) {
      const write = socket.write;
      socket.write = function (...params) {
        if (String(params[0]).includes('"method":"agent_run.invoke"')) writes++;
        return Reflect.apply(write, this, params);
      };
      if (++connections === 2) socket.once("connect", () => controller.abort(reason));
    }
    return socket;
  });
  await assert.rejects(
    invokeClient(f.client, kernelInput(), { signal: controller.signal }).next(),
    /INVOCATION_INTERRUPTED_BEFORE_SUBMISSION/
  );
  assert.equal(writes, 0);
  assert.deepEqual(f.client.invocations.snapshot(), []);
});

test("ACK loss and subscription repair retain one Provider start and contiguous source sequence", async (t) => {
  const f = await fixture(t),
    startsFile = join(f.directory, "starts");
  let cut = false;
  const relay = await kernelRelay(t, f, {
    response(value, c) {
      if (c.request.method === "agent_run.invoke") {
        c.disconnect();
        return false;
      }
      if (value.method === "agent_run.event" && value.params.seq === 2 && !cut) {
        cut = true;
        c.disconnect();
        return false;
      }
    }
  });
  const input = {
    ...kernelInput("repair", { runMetadata: { startsFile } }),
    protocol_mode: "native"
  };
  const values = await collect(invokeClient(relay.client, input));
  assert.equal(relay.count("agent_run.invoke"), 1);
  assert.equal((await readFile(startsFile, "utf8")).trim(), "start");
  assert.deepEqual(
    values.map((v) => v.seq),
    values.map((_, i) => i + 1)
  );
  assert.equal(values.at(-1).control.state, "completed");
  assert.ok(
    relay.requests.some((r) => r.method === "agent_run.subscribe" && r.params.after_seq === 1)
  );
});

test("unrecoverable admission remains tracked and wins over caller abort", async (t) => {
  const f = await fixture(t),
    controller = new AbortController();
  let unreachable = true;
  const relay = await kernelRelay(t, f, {
    response(_v, c) {
      if (unreachable && ["agent_run.invoke", "agent_run.get"].includes(c.request.method)) {
        controller.abort();
        c.disconnect();
        return false;
      }
    }
  });
  const input = kernelInput();
  await assert.rejects(
    collect(invokeClient(relay.client, input, { signal: controller.signal })),
    /ACCEPTANCE_UNKNOWN/
  );
  assert.equal(relay.count("agent_run.invoke"), 1);
  assert.equal(relay.client.invocations.snapshot()[0].key.invocation_id, input.invocationId);
  const result = await relay.client.invocations.drain({
    deadline: Date.now() + 100,
    reason: "stop"
  });
  assert.equal(result.complete, false);
  assert.equal(result.unresolved.length, 1);
  unreachable = false;
  const snapshot = result.unresolved[0];
  assert.equal((await relay.client.get(snapshot.key)).terminal.control.state, "completed");
  assert.deepEqual(relay.client.invocations.snapshot(), []);
});

test("lost cancel ACK remains OPERATION_OUTCOME_UNKNOWN despite caller abort and terminal tail", async (t) => {
  const f = await fixture(t),
    controller = new AbortController();
  const relay = await kernelRelay(t, f, {
    response(_v, c) {
      if (c.request.method === "agent_run.invoke") controller.abort();
      if (c.request.method === "agent_run.cancel") {
        c.disconnect();
        return false;
      }
    }
  });
  const values = [];
  await assert.rejects(
    collect(
      invokeClient(relay.client, kernelInput("wait-for-cancel"), { signal: controller.signal }),
      values
    ),
    /OPERATION_OUTCOME_UNKNOWN/
  );
  assert.ok(values.some((v) => v.type === "run.cancelled"));
  assert.equal(relay.count("agent_run.cancel"), 1);
});

test("respond ACK loss survives concurrent caller abort without replaying the answer", async (t) => {
  const f = await fixture(t),
    controller = new AbortController();
  const relay = await kernelRelay(t, f, {
    response(_value, c) {
      if (c.request.method === "agent_run.respond") {
        controller.abort();
        c.disconnect();
        return false;
      }
    }
  });
  const input = kernelInput("interaction");
  const consume = async () => {
    for await (const event of invokeClient(relay.client, input, { signal: controller.signal })) {
      if (event.type === "interaction.requested")
        await relay.client.respondInteraction(input.invocationId, {
          interactionId: "approval",
          outcome: "answered"
        });
    }
  };
  await assert.rejects(consume(), /OPERATION_OUTCOME_UNKNOWN/);
  assert.equal(relay.count("agent_run.respond"), 1);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("real evicted replay reports STREAM_GAP without running the Provider again", async (t) => {
  const f = await fixture(t),
    startsFile = join(f.directory, "overflow-starts");
  const relay = await kernelRelay(t, f, {
    async response(value, c) {
      if (c.request.method === "agent_run.invoke") {
        const ref = {
          ...value.result.receipt,
          kernel_instance_id: value.result.kernel_instance_id
        };
        await waitFor(async () => Boolean((await f.client.get(ref)).terminal));
      }
    }
  });
  await assert.rejects(
    collect(
      invokeClient(relay.client, {
        ...kernelInput("overflow", { runMetadata: { startsFile } }),
        protocol_mode: "native"
      })
    ),
    /STREAM_GAP/
  );
  assert.equal(relay.count("agent_run.invoke"), 1);
  assert.equal((await readFile(startsFile, "utf8")).trim(), "start");
});

for (const close of ["iterator", "client"])
  test(`${close} close leaves accepted Run executing and observable from another client`, async (t) => {
    const f = await fixture(t),
      relay = await kernelRelay(t, f);
    const iterator = invokeClient(relay.client, {
      ...kernelInput("wait-for-cancel"),
      protocol_mode: "native"
    });
    await iterator.next();
    const ref = relay.client.invocations.snapshot()[0].ref;
    if (close === "iterator") await iterator.return();
    else {
      relay.client.close();
      await assert.rejects(iterator.next(), /CLIENT_CLOSED/);
    }
    assert.equal(relay.count("agent_run.cancel"), 0);
    assert.equal((await f.client.get(ref)).terminal, undefined);
    await f.client.cancel(ref);
    assert.equal((await frames(f.client, ref)).at(-1).control.state, "cancelled");
  });
