import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir, platform, arch } from "node:os";
import { join } from "node:path";
import { createGrokBuildAdapter } from "@mininglamp-oss/octo-runtime-adapter-grok-build";
import { AgentExecutor } from "@mininglamp-oss/octo-runtime-executor-core";

// 显式手动运行：使用本机 Grok 登录和网络，仅验证文本对话，不自动批准工具。
const adapter = createGrokBuildAdapter();
const probe = await adapter.probe();
assert.equal(probe.available, true, probe.reason);
console.log(JSON.stringify({ platform: platform(), arch: arch(), version: probe.version }));
const workdir = await mkdtemp(join(tmpdir(), "octo-grok-live-"));
const executor = new AgentExecutor();
executor.register(adapter);
let providerSession;
try {
  for (const round of [1, 2]) {
    const invocationId = randomUUID();
    const previousSessionId = providerSession?.sessionId;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort("grok_live_timeout"), 120_000);
    let text = "";
    const terminals = [];
    let failure;
    try {
      for await (const event of executor.invoke(
        {
          invocationId,
          protocol_mode: "canonical",
          workdir,
          agentConfig: { effort: "low" },
          controlInstructions: "Read-only verification. Do not use tools.",
          ...(providerSession ? { providerSession } : {}),
          inputs: [
            {
              type: "text",
              text:
                round === 1
                  ? "Remember the marker OCTO_GROK_95. Reply exactly OCTO_GROK_95. Do not use tools."
                  : "Repeat the marker from my previous message, with no other text. Do not use tools."
            }
          ],
          contexts: {
            schema: "octo.context-envelope/v3",
            items: [
              { namespace: "octo.execution", name: "adapter", payload: { type: "grok-build" } },
              { namespace: "octo.security", name: "approval_policy", payload: { mode: "ask" } }
            ]
          }
        },
        { signal: controller.signal }
      )) {
        if (event.type === "session.update") providerSession = event.payload.providerSession;
        if (event.type === "message.delta" && event.payload.channel !== "analysis")
          text += event.payload.text ?? "";
        if (event.type === "interaction.requested")
          await executor.respondInteraction(invocationId, {
            interactionId: event.payload.interactionId,
            outcome: "cancelled"
          });
        if (["run.completed", "run.failed", "run.cancelled"].includes(event.type))
          terminals.push(event.type);
        if (event.type === "run.failed") failure = event.payload;
      }
    } finally {
      clearTimeout(timer);
    }
    assert.deepEqual(terminals, ["run.completed"], failure ? JSON.stringify(failure) : undefined);
    assert.equal(text.trim(), "OCTO_GROK_95");
    assert.ok(providerSession?.sessionId);
    if (round === 2) {
      assert.equal(providerSession.sessionId, previousSessionId);
      assert.notEqual(providerSession.resumeOutcome, "fresh_fallback");
    }
    console.log(
      JSON.stringify({ round, text: text.trim(), terminal: terminals[0], resumed: round === 2 })
    );
  }
} finally {
  const result = await executor.shutdown();
  await rm(workdir, { recursive: true, force: true });
  assert.notEqual(result.cleanup, "incomplete");
}
