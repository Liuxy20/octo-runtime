// 显式真实服务专项，不进入默认 selector：node test/manual/339-engine-sharing-live.mjs --live
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentExecutor } from "../../dist/public/executor-core.js";
import { createFixtureCodexHost } from "../../test-support/codex-owner.mjs";

if (!process.argv.includes("--live")) throw new Error("Explicit --live required");
const workdir = await mkdtemp(join(tmpdir(), "octo339-live-"));
// 本脚本是唯一 owner；两个 Core 只借用 provider，验证关闭权，不要求业务采用多 Core 部署。
const { owner, adapter } = createFixtureCodexHost();
const a = new AgentExecutor();
const b = new AgentExecutor();
a.register(adapter);
b.register(adapter);
const run = async (core, marker) => {
  const frames = await Array.fromAsync(
    core.invokeFrames(
      {
        inputs: [
          { type: "text", text: `Reply exactly ${marker}. Do not use tools or change files.` }
        ],
        protocol_mode: "canonical",
        agentEnv: {
          schema: "octo.context-envelope/v3",
          items: [
            { namespace: "octo.execution", name: "adapter", payload: { type: "codex" } },
            { namespace: "octo.execution", name: "workspace", payload: { path: workdir } },
            {
              namespace: "octo.security",
              name: "approval_policy",
              payload: { mode: "full_access" }
            },
            { namespace: "octo.execution", name: "limits", payload: { run_timeout_ms: 60000 } }
          ]
        }
      },
      { signal: AbortSignal.timeout(65000) }
    )
  );
  assert.equal(frames.at(-1).control.state, "completed");
  const session = frames.find((f) => f.kind === "canonical" && f.event.type === "session.update")
    ?.event.payload.providerSession;
  assert.ok(session);
  return session;
};
try {
  const sessions = await Promise.all([run(a, "READY_A"), run(b, "READY_B")]);
  assert.notDeepEqual(sessions[0], sessions[1]);
  assert.equal(owner.processes().length, 1);
  const pid = owner.processes()[0].pid;
  assert.equal((await a.shutdown()).cleanup, "complete");
  await run(b, "STILL_READY_B");
  assert.equal(owner.processes()[0].pid, pid);
  console.log(
    JSON.stringify({ turns: 3, sharedPid: pid, distinctSessions: true, coreAClosePreservesB: true })
  );
} finally {
  owner.beginShutdown();
  const cores = await Promise.allSettled([a.shutdown(), b.shutdown()]);
  const engine = await owner.close({ deadline: performance.now() + 2500 });
  await rm(workdir, { recursive: true, force: true });
  for (const result of cores) {
    assert.equal(result.status, "fulfilled");
    assert.equal(result.value.cleanup, "complete");
  }
  assert.equal(engine.complete, true);
  console.log(JSON.stringify({ ownerCleanup: true }));
}
