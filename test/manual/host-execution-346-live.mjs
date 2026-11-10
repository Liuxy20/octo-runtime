// Explicit local acceptance: node test/manual/host-execution-346-live.mjs --live
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveHostProviderLaunch } from "@mininglamp-oss/octo-runtime-adapter-sdk/process-launch";
import { createOpenCodeAdapter } from "@mininglamp-oss/octo-runtime-adapter-opencode";
import { AgentExecutor } from "@mininglamp-oss/octo-runtime-executor-core";

if (!process.argv.includes("--live")) throw new Error("Explicit --live required");
const launch = resolveHostProviderLaunch(process.env.OCTO_OPENCODE_COMMAND ?? "opencode", {
  env: process.env,
  cwd: process.cwd()
});
const adapter = createOpenCodeAdapter({
  command: launch.command,
  commandArgsPrefix: launch.args,
  env: launch.env
});
const probe = await adapter.probe();
assert.equal(probe.available, true, probe.reason);
console.log(
  JSON.stringify({ provider: "opencode", version: probe.version, platform: process.platform })
);
const root = await mkdtemp(join(tmpdir(), "octo346-live-"));
const core = new AgentExecutor();
core.register(adapter);
try {
  for (const mode of ["full_access", "ask"]) {
    const marker = `HOST_BINDING_346_${mode.toUpperCase()}`;
    const events = await Array.fromAsync(
      core.invoke(
        {
          inputs: [
            { type: "text", text: `Reply exactly ${marker}. Do not call tools or change files.` }
          ],
          protocol_mode: "canonical",
          agentEnv: {
            schema: "octo.context-envelope/v3",
            items: [
              { namespace: "octo.execution", name: "adapter", payload: { type: "opencode" } },
              { namespace: "octo.execution", name: "workspace", payload: { path: root } },
              { namespace: "octo.security", name: "approval_policy", payload: { mode } },
              {
                namespace: "octo.execution",
                name: "model",
                payload: {
                  selection: { id: process.env.OCTO_OPENCODE_MODEL ?? "deepseek/deepseek-flash" }
                }
              }
            ]
          }
        },
        { signal: AbortSignal.timeout(60000) }
      )
    );
    const failure = events.find((event) => event.type === "run.failed");
    if (failure)
      console.log(
        JSON.stringify({
          mode,
          failureCode: failure.payload.code,
          message: failure.payload.message
        })
      );
    assert.equal(events.at(-1).type, "run.completed");
    assert.ok(
      events.some((event) => event.type === "message.delta" && event.payload.text?.includes(marker))
    );
    console.log(JSON.stringify({ mode, terminal: "run.completed", markerObserved: true }));
  }
} finally {
  const closed = await core.shutdown();
  await rm(root, { recursive: true, force: true });
  assert.equal(closed.cleanup, "complete");
  console.log(JSON.stringify({ cleanup: closed.cleanup }));
}
