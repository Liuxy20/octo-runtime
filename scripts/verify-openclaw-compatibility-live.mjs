import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createOpenClawAdapter } from "../packages/octo-runtime-adapter-openclaw/dist/index.js";
import {
  createOpenClawDeviceIdentity,
  OpenClawGatewayClient
} from "../packages/octo-runtime-adapter-openclaw/dist/gateway.js";
import { assertCanonicalEvent } from "../packages/octo-runtime-protocol/dist/index.js";

// 显式 QA 脚本：凭据不输出；创建本次会话，不改全局策略，不发送 IM。
const config = process.env.OCTO_OPENCLAW_QA_TOKEN
  ? {}
  : JSON.parse(
      await readFile(
        process.env.OCTO_OPENCLAW_QA_CONFIG ?? join(homedir(), ".openclaw/openclaw.json"),
        "utf8"
      )
    );
// 显式指定文件时保留身份，远程管理员批准后重跑不会产生新的配对请求。
const devicePath = process.env.OCTO_OPENCLAW_QA_DEVICE;
let device;
if (devicePath) {
  try {
    device = JSON.parse(await readFile(devicePath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    device = createOpenClawDeviceIdentity();
    await writeFile(devicePath, JSON.stringify(device), { mode: 0o600, flag: "wx" });
  }
} else device = createOpenClawDeviceIdentity();
const gatewayUrl =
  process.env.OCTO_OPENCLAW_QA_URL ?? `ws://127.0.0.1:${config.gateway?.port ?? 18789}`;
const gatewayToken = process.env.OCTO_OPENCLAW_QA_TOKEN ?? config.gateway?.auth?.token;
const probeOnly = process.argv.includes("--probe");
if (probeOnly) {
  const client = new OpenClawGatewayClient({ url: gatewayUrl, token: gatewayToken, device });
  try {
    const hello = await client.connect();
    console.log(
      JSON.stringify(
        {
          protocol: hello.protocol,
          version: hello.server?.version,
          features: hello.features,
          scopes: hello.auth?.scopes
        },
        null,
        2
      )
    );
  } finally {
    await client.close();
  }
}
const results = [];
const scenarios = process.argv.includes("--tools")
  ? ["full_access_tool", "ask_tool"]
  : ["full_access", "ask", "cancel"];
for (const scenario of probeOnly ? [] : scenarios) {
  const toolScenario = scenario.endsWith("_tool");
  const requestedPermission = scenario.startsWith("ask") ? "ask" : "full_access";
  const controller = new AbortController();
  const calls = [];
  const handshakes = [];
  let agentAccepted = false;
  const adapter = createOpenClawAdapter({
    clientFactory(options) {
      const client = new OpenClawGatewayClient(options);
      const connect = client.connect.bind(client);
      const request = client.request.bind(client);
      client.connect = async () => {
        const hello = await connect();
        handshakes.push({ protocol: hello.protocol, version: hello.server?.version });
        return hello;
      };
      client.request = (method, params, options = {}) => {
        calls.push({
          method,
          ...(method === "sessions.create"
            ? { fields: Object.keys(params).sort(), permissionMode: params.permissionMode }
            : {}),
          ...(method === "sessions.patch"
            ? { execSecurity: params.execSecurity, execAsk: params.execAsk }
            : {})
        });
        return request(method, params, {
          ...options,
          onAccepted(value) {
            agentAccepted = true;
            options.onAccepted?.(value);
            if (scenario === "cancel") controller.abort("compatibility QA cancellation");
          }
        });
      };
      return client;
    }
  });
  const events = [];
  const timer = setTimeout(() => controller.abort("compatibility QA deadline"), 60_000);
  try {
    const prompt = toolScenario
      ? "Use the exec tool exactly once with command `printf OPENCLAW_COMPAT_TOOL_OK`. Do not use any other tool, write files, or send messages. After it succeeds, reply exactly OPENCLAW_COMPAT_OK."
      : "Reply exactly OPENCLAW_COMPAT_OK. Do not call tools.";
    for await (const event of adapter.invoke({
      protocolVersion: 2,
      invocationId: randomUUID(),
      agentSessionId: randomUUID(),
      runId: randomUUID(),
      prompt,
      modelInput: prompt,
      controlInstructions: "",
      context: { schema: "octo.context-envelope/v3", items: [] },
      approvalMode: requestedPermission,
      agentSource: "preset",
      workdir: "",
      signal: controller.signal,
      agentConfig: {
        providerAgentId: process.env.OCTO_OPENCLAW_QA_AGENT ?? "main",
        timeoutSeconds: 45,
        providerOptions: {
          OPENCLAW_GATEWAY_URL: gatewayUrl,
          OPENCLAW_GATEWAY_TOKEN: gatewayToken,
          OPENCLAW_GATEWAY_DEVICE_ID: device.deviceId,
          OPENCLAW_GATEWAY_PUBLIC_KEY: device.publicKey,
          OPENCLAW_GATEWAY_PRIVATE_KEY: device.privateKey
        }
      }
    })) {
      assertCanonicalEvent(event);
      events.push(event);
    }
  } finally {
    clearTimeout(timer);
  }
  const terminal = events.at(-1)?.type;
  const tools = events.filter((event) => event.type === "tool_call.create");
  const toolCalls = tools.length;
  assert.equal(toolCalls, toolScenario ? 1 : 0, "Unexpected QA tool invocation count");
  if (toolScenario) {
    assert.equal(tools[0].payload.name, "exec");
    assert.equal(tools[0].payload.args.command, "printf OPENCLAW_COMPAT_TOOL_OK");
    assert.ok(
      events.some(
        (event) =>
          event.type === "tool_call.update" &&
          event.payload.id === tools[0].payload.id &&
          event.payload.status === "completed" &&
          JSON.stringify(event.payload.output).includes("OPENCLAW_COMPAT_TOOL_OK")
      ),
      "Missing successful native tool output"
    );
  }
  assert.equal(
    terminal,
    scenario === "cancel" ? "run.cancelled" : "run.completed",
    events.at(-1)?.payload?.message
  );
  assert.equal(agentAccepted, true);
  assert.equal(calls.filter((call) => call.method === "agent").length, 1);
  assert.equal(calls.filter((call) => call.method === "sessions.create").length, 1);
  assert.equal(
    events.filter((event) => ["run.completed", "run.failed", "run.cancelled"].includes(event.type))
      .length,
    1
  );
  if (scenario !== "cancel") {
    assert.ok(events.some((event) => event.payload?.text?.includes("OPENCLAW_COMPAT_OK")));
    assert.equal(
      events.find((event) => event.type === "model_step.started")?.payload.stepId,
      events.find((event) => event.type === "model_step.finished")?.payload.stepId
    );
  } else {
    assert.equal(calls.filter((call) => call.method === "sessions.abort").length, 1);
    assert.ok(calls.some((call) => call.method === "agent.wait"));
  }
  const permissionFallbacks = events.filter(
    (event) =>
      event.type === "run.notice" && event.payload.params?.category === "permission_fallback"
  );
  const patch = calls.find((call) => call.method === "sessions.patch");
  const create = calls.find((call) => call.method === "sessions.create");
  if (patch) {
    assert.equal(patch.execSecurity, "full");
    assert.equal(patch.execAsk, "off");
    assert.ok(!create.fields.includes("permissionMode"));
    assert.ok(!create.fields.includes("idempotencyKey"));
    assert.ok(!create.fields.includes("thinkingLevel"));
    assert.equal(permissionFallbacks.length, requestedPermission === "ask" ? 1 : 0);
    if (requestedPermission === "ask")
      assert.match(
        permissionFallbacks[0].payload.params.message,
        /requested ask; using full_access.*legacy_human_reviewer_unconfirmed/
      );
  }
  results.push({
    scenario,
    requestedPermission,
    effectivePermission: patch
      ? "full_access"
      : create.permissionMode === "guarded"
        ? "ask"
        : "full_access",
    handshakes,
    terminal,
    toolCalls,
    calls,
    permissionFallbacks: permissionFallbacks.length
  });
}
// 只输出白名单证据，不含 token、私钥、会话正文或完整原生回执。
if (!probeOnly) {
  const evidence = JSON.stringify({ realGateway: true, imDelivery: false, results }, null, 2);
  if (process.env.OCTO_OPENCLAW_QA_EVIDENCE)
    await writeFile(process.env.OCTO_OPENCLAW_QA_EVIDENCE, `${evidence}\n`);
  console.log(evidence);
}
