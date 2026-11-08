// Explicit non-gating acceptance using only processes owned by this script.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { AgentExecutor } from "../../packages/octo-runtime-executor-core/dist/index.js";
import { createCodexAdapter } from "../../packages/octo-runtime-adapter-codex/dist/index.js";
import { componentEndpoint } from "../../packages/octo-runtime-host-sdk/dist/index.js";
import { createKernelService } from "../../packages/octo-runtime-executor-kernel/dist/index.js";
const mode = process.argv[process.argv.indexOf("--mode") + 1];
if (!["direct", "ipc"].includes(mode))
  throw new Error("Explicit --mode direct|ipc required for live model requests");
const home = await mkdtemp(join(tmpdir(), "octo-live-313-"));
const core = mode === "direct" ? new AgentExecutor() : undefined;
core?.register(createCodexAdapter());
const kernel = core
  ? undefined
  : createKernelService({
      home,
      endpoint: componentEndpoint(home),
      adapters: [createCodexAdapter()]
    });
let processes;
try {
  await kernel?.initialize();
  processes = async () =>
    core ? core.processes() : (await kernel.client.status()).service_processes;
  async function run(providerSession, killWhenStarted = false) {
    const input = {
      inputs: [
        {
          type: "text",
          text: killWhenStarted
            ? "Run sleep 10 using the shell, then reply READY. Do not change files."
            : "Reply exactly READY. Do not call tools or change files."
        }
      ],
      agentEnv: {
        ...{
          schema: "octo.context-envelope/v3",
          items: [{ namespace: "octo.execution", name: "adapter", payload: { type: "codex" } }]
        },
        workdir: home,
        approvalMode: "full_access",
        runtimeLimits: { runTimeoutMs: 60000 }
      },

      protocol_mode: "canonical",

      ...(providerSession ? { providerSession } : {})
    };
    const environment = { signal: AbortSignal.timeout(65000) };
    const stream = core
      ? core.invokeFrames(input, environment)
      : kernel.client.subscribe((await kernel.client.submit(input, environment)).ref);
    const frames = [];
    let killed = false;
    for await (const frame of stream) {
      frames.push(frame);
      if (
        killWhenStarted &&
        !killed &&
        frame.kind === "canonical" &&
        frame.event.type === "session.update"
      ) {
        killed = true;
        process.kill((await processes())[0].pid, "SIGKILL");
      }
    }
    if (killWhenStarted) assert.equal(killed, true);
    assert.equal(frames.at(-1).control.state, killWhenStarted ? "failed" : "completed");
    return frames.find(
      (frame) => frame.kind === "canonical" && frame.event.type === "session.update"
    )?.event.payload.providerSession;
  }
  const session = await run();
  const first = (await processes())[0];
  await run(session);
  assert.equal((await processes())[0].pid, first.pid);
  process.kill(first.pid, "SIGKILL");
  const until = performance.now() + 15000;
  let recovered;
  while (performance.now() < until) {
    recovered = (await processes())[0];
    if (recovered.state === "ready" && recovered.incarnation > first.incarnation) break;
    await delay(50);
  }
  assert.equal(recovered.state, "ready");
  assert.notEqual(recovered.pid, first.pid);
  await run(session);
  const idleRecoveryPid = recovered.pid;
  await run(undefined, true);
  const activeUntil = performance.now() + 15000;
  while (performance.now() < activeUntil) {
    recovered = (await processes())[0];
    if (recovered.state === "ready" && recovered.pid !== idleRecoveryPid) break;
    await delay(50);
  }
  assert.equal(recovered.state, "ready");
  assert.notEqual(recovered.pid, idleRecoveryPid);
  await run(session);
  console.log(
    JSON.stringify({
      mode,
      provider: "codex-cli 0.164.0",
      turns: 5,
      reusedPid: first.pid,
      recoveredPid: recovered.pid,
      incarnation: recovered.incarnation,
      idleRecovery: "passed",
      activeRecovery: "passed",
      interruptedTurn: "failed without replay"
    })
  );
} finally {
  const cleanup = core
    ? (await core.shutdown()).cleanup === "complete"
    : (await kernel.close()).complete;
  console.log(JSON.stringify({ mode, ownerCleanup: cleanup }));
  assert.equal(cleanup, true);
  await rm(home, { recursive: true, force: true });
}
