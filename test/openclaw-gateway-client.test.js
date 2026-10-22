import assert from "node:assert/strict";
import { once, getEventListeners } from "node:events";
import test from "node:test";
import { WebSocketServer } from "ws";
import {
  OpenClawGatewayClient,
  OpenClawGatewayRpcError,
  createOpenClawDeviceIdentity
} from "../packages/octo-runtime-adapter-openclaw/dist/gateway.js";
import { createOpenClawAdapter } from "../packages/octo-runtime-adapter-openclaw/dist/index.js";
import { invokeRequest } from "./runtime-fixture.js";

const intermediate = ["accepted", "queued", "in_flight", "pending", "running"];
const hello = {
  type: "hello-ok",
  protocol: 4,
  server: { version: "2026.7.1" },
  features: {
    methods: [
      "agents.list",
      "sessions.create",
      "sessions.patch",
      "sessions.messages.subscribe",
      "agent",
      "agent.wait",
      "sessions.abort"
    ],
    events: ["agent"]
  }
};
function adapterRequest(signal) {
  return invokeRequest({
    signal,
    approvalMode: "full_access",
    agentConfig: {
      providerAgentId: "main",
      providerOptions: {
        OPENCLAW_GATEWAY_URL: "ws://localhost:1",
        OPENCLAW_GATEWAY_TOKEN: "fixture",
        OPENCLAW_GATEWAY_DEVICE_ID: "d",
        OPENCLAW_GATEWAY_PUBLIC_KEY: "p",
        OPENCLAW_GATEWAY_PRIVATE_KEY: "k"
      }
    }
  });
}
function sessionReply(frame, reply) {
  if (frame.method === "connect") return reply(hello);
  if (frame.method === "agents.list") return reply({ agents: [{ id: "main" }] });
  if (frame.method === "sessions.create") return reply({ key: frame.params.key });
  if (frame.method === "sessions.patch")
    return reply({ ok: true, key: frame.params.key, entry: frame.params });
  return reply({});
}

async function fixture(t, respond) {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(server, "listening");
  t.after(() => {
    for (const socket of server.clients) socket.terminate();
    return new Promise((resolve) => server.close(resolve));
  });
  server.on("connection", (socket) => {
    socket.send(
      JSON.stringify({
        type: "event",
        event: "connect.challenge",
        payload: { nonce: "fixture", ts: Date.now() }
      })
    );
    socket.on("message", (data) => {
      const frame = JSON.parse(data.toString());
      const reply = (payload, error) =>
        socket.send(
          JSON.stringify({
            type: "res",
            id: frame.id,
            ok: !error,
            ...(error ? { error } : { payload })
          })
        );
      respond(frame, reply, socket);
    });
  });
  const client = new OpenClawGatewayClient({
    url: `ws://127.0.0.1:${server.address().port}`,
    token: "fixture",
    device: createOpenClawDeviceIdentity(),
    connectTimeoutMs: 500
  });
  t.after(() => client.close());
  return client;
}

test(
  "Gateway client retains all intermediate acknowledgements until an actual final response",
  { timeout: 2000 },
  async (t) => {
    let final;
    const client = await fixture(t, (frame, reply) => {
      if (frame.method === "connect")
        return reply({ type: "hello-ok", protocol: 4, server: { version: "2026.7.1" } });
      for (const status of intermediate) reply({ status, runId: "native-run" });
      reply({ status: "error", pendingError: true, runId: "native-run" });
      final = () => reply({ status: "ok", result: { payloads: [{ text: "done" }] } });
    });
    assert.equal((await client.connect()).server.version, "2026.7.1");
    const accepted = [];
    let done = false;
    const response = client
      .request(
        "agent",
        {},
        { expectFinal: true, onAccepted: (value) => accepted.push(value.status) }
      )
      .then((value) => {
        done = true;
        return value;
      });
    while (accepted.length < intermediate.length + 1)
      await new Promise((resolve) => setImmediate(resolve));
    assert.equal(done, false);
    final();
    assert.equal((await response).status, "ok");
    assert.deepEqual(accepted, [...intermediate, "error"]);
  }
);

for (const status of ["pending", "running"])
  test(
    `adapter preserves final-only answer and usage after ${status}`,
    { timeout: 3000 },
    async (t) => {
      const methods = [];
      const client = await fixture(t, (frame, reply) => {
        methods.push(frame.method);
        if (frame.method === "agent") {
          reply({ status, runId: frame.params.idempotencyKey });
          setImmediate(() =>
            reply({
              status: "ok",
              result: {
                payloads: [{ text: "final answer retained" }],
                meta: { agentMeta: { usage: { input: 17, output: 23 } } }
              }
            })
          );
        } else if (frame.method === "agent.wait") reply({ status: "ok", endedAt: 1 });
        else sessionReply(frame, reply);
      });
      const events = [];
      for await (const event of createOpenClawAdapter({ clientFactory: () => client }).invoke(
        adapterRequest()
      ))
        events.push(event);
      assert.equal(events.at(-1).type, "run.completed");
      assert.ok(
        events.some(
          (event) =>
            event.type === "message.update" && event.payload.text === "final answer retained"
        )
      );
      assert.ok(
        events.some(
          (event) =>
            event.type === "usage.update" &&
            event.payload.inputTokens === 17 &&
            event.payload.outputTokens === 23
        )
      );
      assert.equal(methods.filter((method) => method === "agent").length, 1);
      assert.equal(methods.includes("agent.wait"), false);
    }
  );

for (const stopReason of ["aborted", "rpc"])
  test(
    `confirmed ${stopReason} cancellation survives closing an older wait`,
    { timeout: 3000 },
    async (t) => {
      const controller = new AbortController();
      const methods = [];
      let waits = 0;
      let closed;
      const client = await fixture(t, (frame, reply, socket) => {
        methods.push(frame.method);
        if (frame.method === "agent") {
          const runId = frame.params.idempotencyKey;
          reply({ status: "accepted", runId });
          for (const [seq, phase] of [
            [1, "start"],
            [2, "error"]
          ])
            socket.send(
              JSON.stringify({
                type: "event",
                event: "agent",
                payload: { runId, seq, stream: "lifecycle", data: { phase, stopReason } }
              })
            );
          closed = once(socket, "close");
        } else if (frame.method === "agent.wait") {
          if (++waits === 1) {
            // Hold the lifecycle wait; only the cancellation task may complete and close it.
            controller.abort("cancel during lifecycle reconciliation");
          } else reply({ status: "error", endedAt: 1, stopReason });
        } else sessionReply(frame, reply);
      });
      const events = [];
      for await (const event of createOpenClawAdapter({ clientFactory: () => client }).invoke(
        adapterRequest(controller.signal)
      ))
        events.push(event);
      assert.equal(events.at(-1).type, "run.cancelled");
      assert.equal(events.filter((event) => event.type.startsWith("run.")).length, 1);
      assert.equal(events.filter((event) => event.type === "model_step.finished").length, 1);
      assert.equal(methods.filter((method) => method === "agent").length, 1);
      assert.equal(methods.filter((method) => method === "sessions.abort").length, 1);
      assert.equal(waits, 2);
      assert.equal((await closed)[0], 1000);
    }
  );

test(
  "Gateway RPC errors retain method and native code without retaining arbitrary details",
  { timeout: 2000 },
  async (t) => {
    const client = await fixture(t, (frame, reply) =>
      frame.method === "connect"
        ? reply({ type: "hello-ok", protocol: 4 })
        : reply(undefined, {
            code: "INVALID_REQUEST",
            message: "invalid sessions.create params",
            details: { secret: "do-not-retain" }
          })
    );
    await client.connect();
    await assert.rejects(client.request("sessions.create", {}), (error) => {
      assert.ok(error instanceof OpenClawGatewayRpcError);
      assert.equal(error.method, "sessions.create");
      assert.equal(error.code, "INVALID_REQUEST");
      assert.doesNotMatch(JSON.stringify(error), /do-not-retain/);
      return true;
    });
  }
);

test(
  "invalid hello rejects promptly instead of leaving an unhandled callback rejection",
  { timeout: 2000 },
  async (t) => {
    const client = await fixture(t, (_frame, reply) => reply({ type: "invalid" }));
    await assert.rejects(client.connect(), /invalid hello response/);
  }
);

test(
  "already aborted RPCs settle without sending, and timeout releases the signal listener",
  { timeout: 2000 },
  async (t) => {
    const methods = [];
    const client = await fixture(t, (frame, reply) => {
      methods.push(frame.method);
      if (frame.method === "connect") reply({ type: "hello-ok", protocol: 4 });
    });
    await client.connect();
    await assert.rejects(client.request("agent", {}, { signal: AbortSignal.abort() }), /aborted/);
    assert.deepEqual(methods, ["connect"]);
    const controller = new AbortController();
    await assert.rejects(
      client.request("agent.wait", {}, { timeoutMs: 10, signal: controller.signal }),
      /timed out/
    );
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  }
);
