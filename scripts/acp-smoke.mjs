#!/usr/bin/env node
import { withAgentEnvItems } from "../packages/octo-runtime-adapter-sdk/dist/index.js";
import { AgentExecutor } from "../packages/octo-runtime-executor-core/dist/index.js";
const adapterType = process.argv[2];
const adapters = {
  hermes: async () => (await import("@mininglamp-oss/octo-runtime-adapter-hermes")).hermesAdapter,
  "kimi-code": async () =>
    (await import("@mininglamp-oss/octo-runtime-adapter-kimi-code")).kimiCodeAdapter
};
if (!adapters[adapterType]) {
  console.error("usage: node scripts/acp-smoke.mjs <hermes|kimi-code>");
  process.exit(2);
}
const adapter = await adapters[adapterType]();
const executor = new AgentExecutor();
executor.register(adapter);
const controller = new AbortController();
const timeoutMs = Number(process.env.ACP_SMOKE_TIMEOUT_MS ?? 120000);
const timeout = setTimeout(() => controller.abort("smoke_timeout"), timeoutMs);
const startedAt = Date.now();
const events = [];
const expectedText = `${adapterType.toUpperCase().replaceAll("-", "_")}_E2E_OK`;
let finalText = "";
try {
  // 显式 smoke 拥有本轮 Core 和关闭；配置使用目标 Harness 的默认信封。
  for await (const event of executor.invoke(
    {
      inputs: [{ type: "text", text: `Reply with exactly ${expectedText} and nothing else.` }],
      protocol_mode: "canonical",
      agentEnv: withAgentEnvItems(adapter.defaultAgentEnv, [
        { namespace: "octo.execution", name: "workspace", payload: { path: process.cwd() } },
        { namespace: "octo.security", name: "approval_policy", payload: { mode: "full_access" } }
      ])
    },
    { signal: controller.signal }
  )) {
    events.push(event);
    if (event.type === "message.delta" && (event.payload.channel ?? "final") === "final") {
      finalText += typeof event.payload.text === "string" ? event.payload.text : "";
    }
    if (
      event.type === "message.update" &&
      (event.payload.channel ?? "final") === "final" &&
      typeof event.payload.text === "string"
    ) {
      finalText = event.payload.text;
    }
    const text =
      typeof event.payload?.text === "string" ? event.payload.text.slice(0, 200) : undefined;
    console.log(
      JSON.stringify({
        elapsedMs: Date.now() - startedAt,
        type: event.type,
        ...(text ? { text } : {})
      })
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
  const closed = await executor.shutdown();
  if (closed.cleanup !== "complete") throw new Error("ACP_SMOKE_CLEANUP_INCOMPLETE");
}
if (events.at(-1)?.type !== "run.completed" || finalText.trim() !== expectedText) {
  console.error(
    `ACP smoke failed: terminal=${events.at(-1)?.type ?? "none"} final=${JSON.stringify(finalText.trim())}`
  );
  process.exitCode = 1;
}
