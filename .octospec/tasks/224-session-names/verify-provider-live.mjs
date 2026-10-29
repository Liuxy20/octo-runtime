import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createOpenClawAdapter } from "../../../packages/octo-runtime-adapter-openclaw/dist/index.js";
import {
  OpenClawGatewayClient,
  createOpenClawDeviceIdentity
} from "../../../packages/octo-runtime-adapter-openclaw/dist/gateway.js";
import { createCodexAdapter } from "../../../packages/octo-runtime-adapter-codex/dist/index.js";
import { createClaudeCodeAdapter } from "../../../packages/octo-runtime-adapter-claude-code/dist/index.js";

// 独立 non-gating 原生验收：只操作新 QA 会话，不注入历史，不调用工具，不发送 IM。
const provider = process.argv[2];
assert.ok(["openclaw", "codex", "claude-code"].includes(provider));
const workdir = await mkdtemp(join(tmpdir(), "octo-224-live-"));
const calls = [];
const name = process.argv[3] ?? `octo-dm-qa224-${randomUUID()}`;
let agentConfig = {};
let adapter;
if (provider === "openclaw") {
  const config = JSON.parse(await readFile(join(homedir(), ".openclaw/openclaw.json"), "utf8"));
  const device = createOpenClawDeviceIdentity();
  agentConfig = {
    providerAgentId: "main",
    timeoutSeconds: 55,
    providerOptions: {
      OPENCLAW_GATEWAY_URL: `ws://127.0.0.1:${config.gateway?.port ?? 18789}`,
      OPENCLAW_GATEWAY_TOKEN: config.gateway.auth.token,
      OPENCLAW_GATEWAY_DEVICE_ID: device.deviceId,
      OPENCLAW_GATEWAY_PUBLIC_KEY: device.publicKey,
      OPENCLAW_GATEWAY_PRIVATE_KEY: device.privateKey
    }
  };
  adapter = createOpenClawAdapter({
    clientFactory(options) {
      const client = new OpenClawGatewayClient(options);
      const request = client.request.bind(client);
      client.request = (method, params, options) => {
        calls.push({
          method,
          ...(params.key ? { key: params.key } : {}),
          ...(params.sessionKey ? { key: params.sessionKey } : {})
        });
        return request(method, params, options);
      };
      return client;
    }
  });
} else if (provider === "codex") {
  adapter = createCodexAdapter({
    spawnFn(command, args, options) {
      const child = spawn(command, args, { ...options, stdio: ["pipe", "pipe", "pipe"] });
      const write = child.stdin.write.bind(child.stdin);
      let buffered = "";
      child.stdin.write = (chunk, ...rest) => {
        buffered += chunk.toString();
        const lines = buffered.split("\n");
        buffered = lines.pop();
        for (const line of lines) {
          if (!line) continue;
          const message = JSON.parse(line);
          if (message.method)
            calls.push({
              method: message.method,
              ...(message.method === "thread/name/set" ? { name: message.params.name } : {})
            });
        }
        return write(chunk, ...rest);
      };
      return child;
    }
  });
} else adapter = createClaudeCodeAdapter();

const marker = `MEMORY_${randomUUID().replaceAll("-", "")}`;
const results = [];
let providerSession;
async function turn(prompt, fresh = false) {
  const events = [];
  for await (const event of adapter.invoke({
    protocolVersion: 2,
    invocationId: randomUUID(),
    agentSessionId: fresh ? randomUUID() : "qa-logical-session",
    sessionName: name,
    runId: randomUUID(),
    prompt,
    modelInput: prompt,
    controlInstructions: "QA: obey the user, do not use tools or access files.",
    context: { schema: "octo.context-envelope/v3", items: [] },
    approvalMode: "full_access",
    agentSource: provider === "openclaw" ? "preset" : "provisioned",
    workdir,
    agentConfig,
    ...(!fresh && providerSession ? { providerSession } : {}),
    signal: AbortSignal.timeout(75_000)
  }))
    events.push(event);
  const terminal = events.at(-1);
  const session = events.find((event) => event.type === "session.update")?.payload.providerSession;
  const text = events
    .filter(
      (event) =>
        ["message.update", "message.delta"].includes(event.type) &&
        event.payload.channel !== "analysis"
    )
    .map((event) => event.payload.text ?? "")
    .join("");
  const result = {
    terminal: terminal?.type,
    sessionId: session?.sessionId,
    remembered: text.includes(marker),
    failure: terminal?.type === "run.failed" ? terminal.payload.message : undefined
  };
  results.push(result);
  console.log(JSON.stringify({ provider, turn: results.length, ...result }));
  assert.equal(terminal?.type, "run.completed", JSON.stringify(result));
  assert.ok(session?.sessionId);
  return { session, text };
}
try {
  const first = await turn(
    `Remember this exact QA marker: ${marker}. Reply exactly SAVED. Do not call tools.`
  );
  providerSession = first.session;
  for (let index = 0; index < 2; index++) {
    const next = await turn(
      "Reply with the exact QA marker I asked you to remember earlier in this conversation. Do not call tools."
    );
    assert.equal(next.session.sessionId, providerSession.sessionId);
    assert.ok(next.text.includes(marker), "native memory must work without transcript replay");
  }
  const reset = await turn("Reply exactly FRESH_QA. Do not call tools.", true);
  assert.notEqual(reset.session.sessionId, providerSession.sessionId);
  if (provider === "openclaw") {
    assert.equal(calls.filter((call) => call.method === "sessions.create").length, 2);
    assert.equal(calls.filter((call) => call.method === "sessions.describe").length, 2);
    const missing = { sessionId: `agent:main:qa224-missing-${randomUUID()}` };
    providerSession = missing;
    const events = [];
    for await (const event of adapter.invoke({
      protocolVersion: 2,
      invocationId: randomUUID(),
      agentSessionId: randomUUID(),
      runId: randomUUID(),
      sessionName: name,
      prompt: "do not execute",
      modelInput: "do not execute",
      controlInstructions: "",
      context: { schema: "octo.context-envelope/v3", items: [] },
      approvalMode: "full_access",
      agentSource: "preset",
      workdir,
      agentConfig,
      providerSession,
      signal: AbortSignal.timeout(15_000)
    }))
      events.push(event);
    assert.equal(events.at(-1).type, "run.failed");
    assert.match(events.at(-1).payload.message, /OPENCLAW_SESSION_NOT_FOUND/);
    assert.equal(calls.filter((call) => call.method === "agent").length, 4);
  }
  if (provider === "codex")
    assert.equal(
      calls.filter((call) => call.method === "thread/name/set" && call.name === name).length,
      2
    );
} finally {
  if (process.env.OCTO_SESSION_LIVE_REPORT)
    await writeFile(
      process.env.OCTO_SESSION_LIVE_REPORT,
      JSON.stringify({ provider, name, results, calls }, null, 2),
      { mode: 0o600 }
    );
  await rm(workdir, { recursive: true, force: true });
}
