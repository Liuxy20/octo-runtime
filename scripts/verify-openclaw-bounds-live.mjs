import { withAgentEnvItems } from "../packages/octo-runtime-adapter-sdk/dist/index.js";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createOpenClawAdapter } from "../packages/octo-runtime-adapter-openclaw/dist/index.js";
import {
  OpenClawGatewayClient,
  createOpenClawDeviceIdentity
} from "../packages/octo-runtime-adapter-openclaw/dist/gateway.js";
// Read existing connection credentials, without rewriting Provider configuration.
const config = JSON.parse(
  await readFile(
    process.env.OCTO_OPENCLAW_QA_CONFIG ?? join(homedir(), ".openclaw/openclaw.json"),
    "utf8"
  )
);
const device = createOpenClawDeviceIdentity();
let accepted = false,
  acceptedBeforeEvent = true,
  nativeEvents = 0;
const adapter = createOpenClawAdapter({
  clientFactory(options) {
    const client = new OpenClawGatewayClient(options);
    const request = client.request.bind(client);
    client.request = (method, params, options = {}) =>
      request(method, params, {
        ...options,
        onAccepted(value) {
          accepted = true;
          options.onAccepted?.(value);
        }
      });
    client.onEvent((event) => {
      if (event.event === "agent") {
        nativeEvents++;
        if (!accepted) acceptedBeforeEvent = false;
      }
    });
    return client;
  }
});
const events = [];
for await (const event of adapter.invoke(
  {
    protocolVersion: 2,
    invocationId: randomUUID(),
    runId: randomUUID(),
    agentSessionId: randomUUID(),
    prompt: "Reply exactly QUEUE_BOUNDS_OK. Do not call tools.",
    modelInput: "Reply exactly QUEUE_BOUNDS_OK. Do not call tools.",
    signal: AbortSignal.timeout(90000),
    agentEnv: withAgentEnvItems({ schema: "octo.context-envelope/v3", items: [] }, [
      { namespace: "octo.execution", name: "workspace", payload: { path: "" } },
      { namespace: "octo.security", name: "approval_policy", payload: { mode: "full_access" } },
      { namespace: "octo.execution", name: "agent", payload: { source: "preset" } },
      {
        namespace: "octo.execution",
        name: "adapter",
        payload: { type: "openclaw" }
      },
      {
        namespace: "adapter.openclaw",
        name: "options",
        payload: { agentId: process.env.OCTO_OPENCLAW_QA_AGENT ?? "main", timeoutSeconds: 60 }
      }
    ])
  },
  {
    // 连接身份只属于可信本地调用环境，不进入业务 AgentEnv。
    providerOptions: {
      OPENCLAW_GATEWAY_URL: `ws://127.0.0.1:${config.gateway?.port ?? 18789}`,
      ...(config.gateway?.auth?.token ? { OPENCLAW_GATEWAY_TOKEN: config.gateway.auth.token } : {}),
      OPENCLAW_GATEWAY_DEVICE_ID: device.deviceId,
      OPENCLAW_GATEWAY_PUBLIC_KEY: device.publicKey,
      OPENCLAW_GATEWAY_PRIVATE_KEY: device.privateKey
    }
  }
))
  events.push(event);
assert.equal(events.at(-1)?.type, "run.completed");
assert.ok(events.some((e) => e.payload?.text?.includes("QUEUE_BOUNDS_OK")));
assert.ok(accepted && nativeEvents > 0 && acceptedBeforeEvent);
console.log(
  JSON.stringify({
    realGateway: true,
    acceptedBeforeEvent,
    nativeEvents,
    terminal: events.at(-1).type
  })
);
