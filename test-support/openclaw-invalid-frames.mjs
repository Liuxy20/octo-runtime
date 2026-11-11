import { withAgentEnvItems } from "../packages/octo-runtime-adapter-sdk/dist/index.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { WebSocketServer } from "ws";
import {
  OpenClawGatewayClient,
  createOpenClawDeviceIdentity
} from "../packages/octo-runtime-adapter-openclaw/dist/gateway.js";
import { invokeRequest } from "../test/runtime-fixture.js";
export const hello = {
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
export const finalResult = (text = "done") => ({
  status: "ok",
  result: { payloads: [{ text }] }
});
export function sessionReply(frame, reply) {
  if (frame.method === "agents.list") return reply({ agents: [{ id: "main" }] });
  if (frame.method === "sessions.create") return reply({ key: frame.params.key });
  if (frame.method === "sessions.patch")
    return reply({ ok: true, key: frame.params.key, entry: frame.params });
  return reply({});
}
/** 专项独占的真实 socket；一个 after 顺序关闭所有 client 与 server，不依赖 hook 注册顺序。 */
export async function gatewayFixture(
  t,
  respond = sessionReply,
  { beforeChallenge = [], challenge = true, beforeHello = [], onConnection } = {}
) {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  const clients = [];
  const sockets = [];
  const requests = [];
  t.after(async () => {
    const errors = [];
    for (const client of clients) {
      try {
        await client.close();
      } catch (error) {
        errors.push(error);
      }
    }
    for (const socket of server.clients) socket.terminate();
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    if (errors.length) throw new AggregateError(errors, "Gateway fixture cleanup failed");
  });
  await once(server, "listening");
  server.on("connection", (socket) => {
    sockets.push(socket);
    for (const text of beforeChallenge) socket.send(text);
    onConnection?.(socket);
    if (challenge)
      socket.send(
        JSON.stringify({
          type: "event",
          event: "connect.challenge",
          payload: { nonce: randomUUID(), ts: Date.now() }
        })
      );
    socket.on("message", (data) => {
      const frame = JSON.parse(data.toString());
      requests.push(frame);
      const reply = (payload, error) =>
        socket.send(
          JSON.stringify({
            type: "res",
            id: frame.id,
            ok: !error,
            ...(error ? { error } : { payload }),
            extension: true
          })
        );
      if (frame.method === "connect") {
        for (const text of beforeHello) socket.send(text);
        reply(hello);
      } else respond(frame, reply, socket);
    });
  });
  const device = createOpenClawDeviceIdentity();
  const token = randomUUID();
  const url = `ws://127.0.0.1:${server.address().port}`;
  const options = { url, token, device, connectTimeoutMs: 500, requestTimeoutMs: 500 };
  const providerOptions = {
    OPENCLAW_GATEWAY_URL: url,
    OPENCLAW_GATEWAY_TOKEN: token,
    OPENCLAW_GATEWAY_DEVICE_ID: device.deviceId,
    OPENCLAW_GATEWAY_PUBLIC_KEY: device.publicKey,
    OPENCLAW_GATEWAY_PRIVATE_KEY: device.privateKey
  };
  return {
    server,
    sockets,
    requests,
    options,
    providerOptions,
    client(overrides = {}) {
      const client = new OpenClawGatewayClient({ ...options, log: () => {}, ...overrides });
      clients.push(client);
      return client;
    },
    request(overrides = {}) {
      return invokeRequest({
        invocationId: randomUUID(),
        runId: randomUUID(),
        agentSessionId: randomUUID(),
        ...overrides,
        agentEnv: withAgentEnvItems(overrides.agentEnv, [
          { namespace: "octo.security", name: "approval_policy", payload: { mode: "full_access" } },
          {
            namespace: "octo.execution",
            name: "adapter",
            payload: { type: "openclaw" }
          },
          {
            namespace: "adapter.openclaw",
            name: "options",
            payload: { agentId: "main" }
          }
        ])
      });
    }
  };
}
export async function eventually(predicate) {
  const until = performance.now() + 3000;
  while (!predicate()) {
    assert.ok(performance.now() < until, "fixture observation timed out");
    await new Promise((resolve) => setImmediate(resolve));
  }
}
export async function collect(iterable) {
  const values = [];
  for await (const value of iterable) values.push(value);
  return values;
}
