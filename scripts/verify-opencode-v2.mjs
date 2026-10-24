import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir, platform, arch } from "node:os";
import { join } from "node:path";
import { createOpenCodeAdapter } from "@mininglamp-oss/octo-runtime-adapter-opencode";
import { AgentExecutor } from "@mininglamp-oss/octo-runtime-executor-core";
import { startMcpHttpServer } from "../test-support/mcp/http-server.mjs";

// 手动验收使用宿主已有认证；只输出断言结果，工具仅操作隔离目录。
const command = process.env.OCTO_OPENCODE_COMMAND ?? "opencode";
const model = process.env.OCTO_OPENCODE_MODEL ?? "deepseek/deepseek-flash";
const adapter = createOpenCodeAdapter({ command });
const probe = await adapter.probe();
assert.equal(probe.available, true, probe.reason);
console.log(JSON.stringify({ platform: platform(), arch: arch(), version: probe.version, model }));
const workdir = await mkdtemp(join(tmpdir(), "octo-opencode-live-"));
const executor = new AgentExecutor();
executor.register(adapter);
async function run(
  name,
  mode,
  text,
  {
    providerSession,
    decision = "allow",
    cancelTool = false,
    invalidConfig = false,
    config = {},
    mcp,
    effort,
    selectedModel = model,
    expectFailure = false
  } = {}
) {
  const invocationId = randomUUID();
  const timer = setTimeout(() => executor.cancel(invocationId, "live_timeout"), 120_000);
  const events = [];
  let output = "",
    session,
    approvals = 0,
    tools = 0,
    cancelTimer;
  const toolIds = new Set();
  try {
    for await (const event of executor.invoke({
      invocationId,
      protocol_mode: "canonical",
      workdir,
      agentConfig: { model: selectedModel, ...(effort ? { effort } : {}) },
      controlInstructions:
        "This is a controlled Runtime verification. Follow the exact requested tool operation and output. Never inspect credentials or unrelated files.",
      ...(providerSession ? { providerSession } : {}),
      inputs: [{ type: "text", text }],
      contexts: {
        schema: "octo.context-envelope/v3",
        items: [
          { namespace: "octo.execution", name: "adapter", payload: { type: "opencode" } },
          { namespace: "octo.security", name: "approval_policy", payload: { mode } },
          ...(mcp
            ? [{ namespace: "octo.execution", name: "mcp", payload: { mcpServers: mcp } }]
            : []),
          {
            namespace: "octo.execution",
            name: "envs",
            payload: {
              env_variables: [
                { key: "OCTO_E2E_VALUE", value: "OPENCODE_ENV_OK" },
                {
                  key: "OPENCODE_CONFIG_CONTENT",
                  value: invalidConfig
                    ? "{"
                    : JSON.stringify({
                        permissions: [{ action: "*", resource: "*", effect: "ask" }],
                        ...config
                      })
                }
              ]
            }
          }
        ]
      }
    })) {
      events.push(event);
      if (event.type === "session.update") session = event.payload.providerSession;
      if (event.type === "message.delta" && event.payload.channel !== "analysis")
        output += event.payload.text ?? "";
      if (event.type === "tool_call.create" || event.type === "tool_call.update") {
        toolIds.add(event.payload.id);
        tools = toolIds.size;
        if (cancelTool) executor.cancel(invocationId, "live_cancel_tool");
      }
      if (cancelTool && event.type === "model_step.started" && !cancelTimer)
        cancelTimer = setTimeout(() => executor.cancel(invocationId, "live_cancel_step"), 3000);
      if (event.type === "interaction.requested") {
        approvals++;
        await executor.respondInteraction(invocationId, {
          interactionId: event.payload.interactionId,
          outcome: decision === "allow" ? "accepted" : "declined"
        });
      }
    }
  } finally {
    clearTimeout(timer);
    clearTimeout(cancelTimer);
  }
  const terminals = events.filter((event) =>
    ["run.completed", "run.failed", "run.cancelled"].includes(event.type)
  );
  assert.equal(terminals.length, 1, `${name}: expected one terminal`);
  const result = {
    name,
    terminal: terminals[0].type,
    approvals,
    tools,
    usage: events.some((event) => event.type === "usage.update")
  };
  console.log(JSON.stringify(result));
  if (terminals[0].type === "run.failed" && !invalidConfig && !expectFailure)
    console.error(JSON.stringify(terminals[0].payload));
  return { ...result, output, session };
}
try {
  for (const mode of ["full_access", "ask"]) {
    const first = await run(
      `${mode}-tool`,
      mode,
      "Run exactly this shell command in the current directory:\n```sh\nprintf '%s' \"$OCTO_E2E_VALUE\" > marker.txt\n```\nThen read marker.txt with a tool. Reply exactly OPENCODE_ENV_OK. Remember the marker OCTO_RESUME_103 for the next turn."
    );
    assert.equal(first.terminal, "run.completed");
    assert.match(first.output, /OPENCODE_ENV_OK/);
    assert.equal(await readFile(join(workdir, "marker.txt"), "utf8"), "OPENCODE_ENV_OK");
    assert.ok(first.tools > 0);
    if (mode === "ask") assert.ok(first.approvals > 0, "ACP must round-trip a permission");
    const second = await run(
      `${mode}-resume`,
      mode,
      "Repeat the OCTO_RESUME marker from my previous request, with no other text. Do not use tools.",
      { providerSession: first.session }
    );
    assert.equal(second.terminal, "run.completed");
    assert.equal(second.output.trim(), "OCTO_RESUME_103");
    assert.equal(second.session.sessionId, first.session.sessionId);
    const cancelled = await run(
      `${mode}-cancel`,
      mode,
      "Run this shell command now: sleep 60 . Do not do anything else until it finishes.",
      { cancelTool: true }
    );
    assert.equal(cancelled.terminal, "run.cancelled");
  }
  const http = await startMcpHttpServer();
  const mcpAuthorization = `Bearer ${randomUUID()}`;
  try {
    for (const mode of ["full_access", "ask"]) {
      const before = http.receipts.length;
      const mcp = await run(
        `${mode}-mcp`,
        mode,
        "Use the live MCP server's octo_echo tool with value OCTO_MCP_103. Find it via the tool catalog if needed. Reply with the tool result. Do not use shell tools.",
        {
          mcp: {
            live: {
              type: "streamable_http",
              url: http.url,
              headers: { Authorization: mcpAuthorization }
            }
          }
        }
      );
      assert.equal(mcp.terminal, "run.completed");
      assert.match(mcp.output, /octo-echo:OCTO_MCP_103/);
      assert.ok(
        http.receipts
          .slice(before)
          .some((r) => r.method === "tools/call" && r.authorization === mcpAuthorization)
      );
    }
  } finally {
    await http.close();
  }
  const effort = await run(
    "full_access-effort",
    "full_access",
    "Reply exactly EFFORT_OK. Do not use tools.",
    { effort: "high" }
  );
  assert.equal(effort.terminal, "run.completed");
  const denied = await run(
    "ask-deny",
    "ask",
    "Run this shell command: printf denied > denied.txt .",
    { decision: "deny" }
  );
  assert.ok(denied.approvals > 0);
  await assert.rejects(readFile(join(workdir, "denied.txt")), { code: "ENOENT" });
  for (const mode of ["full_access", "ask"]) {
    const invalid = await run(`${mode}-invalid-config`, mode, "Reply OK", { invalidConfig: true });
    assert.equal(invalid.terminal, "run.failed");
    const credentials = await run(`${mode}-invalid-credentials`, mode, "Reply OK", {
      config: { providers: { deepseek: { settings: { apiKey: randomUUID() } } } },
      expectFailure: true
    });
    assert.equal(credentials.terminal, "run.failed");
    const provider = await run(`${mode}-invalid-provider`, mode, "Reply OK", {
      selectedModel: "octo-missing-provider/no-model",
      expectFailure: true
    });
    assert.equal(provider.terminal, "run.failed");
  }
} finally {
  const result = await executor.shutdown();
  await rm(workdir, { recursive: true, force: true });
  assert.notEqual(result.cleanup, "incomplete");
  console.log(JSON.stringify({ cleanup: result.cleanup }));
}
