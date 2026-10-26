import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createKernelService } from "../packages/octo-runtime-executor-kernel/dist/index.js";
import { invocationInput } from "../packages/octo-runtime-protocol/dist/index.js";
import { invokeRequest } from "../test/runtime-fixture.js";

// 显式运行的真实 Provider 验收；只写临时工作目录，不输出认证或原始模型轨迹。
const directory = await mkdtemp("/tmp/od-dsh-");
const kernel = createKernelService({
  endpoint: join(directory, "k.sock"),
  workerEntrypoint: fileURLToPath(new URL("../test/fixtures/dsh-worker.mjs", import.meta.url))
});
const report = { platform: process.platform, version: "0.2.1-rc.3" };
const final = (events) =>
  events
    .filter((e) => e.type === "message.delta" && e.payload.channel === "final")
    .map((e) => e.payload.text)
    .join("");
const terminal = (events) =>
  events.filter((e) => ["run.completed", "run.failed", "run.cancelled"].includes(e.type));
function input(prompt, providerSession, providerOptions = {}) {
  return invocationInput(
    invokeRequest({
      workdir: directory,
      runId: randomUUID(),
      invocationId: randomUUID(),
      approvalMode: "full_access",
      modelInput: prompt,
      ...(providerSession ? { providerSession } : {}),
      agentConfig: { providerOptions },
      runtimeLimits: { runTimeoutMs: 90000 }
    }),
    "canonical",
    "dsh"
  );
}
async function run(prompt, session, options) {
  const events = await Array.fromAsync(kernel.client.invoke(input(prompt, session, options)));
  assert.equal(terminal(events).length, 1);
  return events;
}
try {
  await kernel.initialize();
  const marker = `DSH_${randomUUID().replaceAll("-", "")}`;
  const first = await run(
    `Remember this exact verification marker for the next message: ${marker}. Reply only with the marker.`
  );
  assert.equal(terminal(first)[0].type, "run.completed", JSON.stringify(terminal(first)));
  assert.ok(final(first).includes(marker));
  const session = first.find((e) => e.type === "session.update").payload.providerSession;
  report.firstTurn = "completed";
  const resumed = await run(
    "Reply only with the verification marker from my previous message.",
    session
  );
  assert.equal(terminal(resumed)[0].type, "run.completed", JSON.stringify(terminal(resumed)));
  assert.ok(final(resumed).includes(marker));
  assert.equal(
    resumed.find((e) => e.type === "session.update").payload.providerSession.resumeOutcome,
    "resumed"
  );
  report.resume = "same session, original marker restored";
  const tool = await run(
    `Use a filesystem tool to write exactly ${marker} (no newline) to dsh-proof.txt in the current working directory, then reply DONE. Do not just describe the action.`
  );
  assert.equal(terminal(tool)[0].type, "run.completed", JSON.stringify(terminal(tool)));
  assert.equal((await readFile(join(directory, "dsh-proof.txt"), "utf8")).trim(), marker);
  assert.ok(tool.some((e) => e.type === "tool_call.create"));
  assert.ok(tool.some((e) => e.type === "tool_call.update"));
  report.tool = "canonical tool events and file side effect verified";
  const missing = await run("Reply OK", { sessionId: `missing-${randomUUID()}`, resumable: true });
  assert.equal(terminal(missing)[0].payload.failure.reasonCode, "DSH_SESSION_RESUME_FAILED");
  report.missingResume = "failed without creating replacement session";
  const failed = await run("Reply OK without tools.", undefined, { provider: "deepseek-official" });
  assert.equal(terminal(failed)[0].type, "run.failed");
  report.providerFailure = terminal(failed)[0].payload.failure.reasonCode;
  const aborted = new AbortController();
  const cancelled = [];
  const cancellation = (async () => {
    try {
      for await (const event of kernel.client.invoke(
        input("Use a shell tool to sleep for 30 seconds, then reply DONE."),
        { signal: aborted.signal }
      )) {
        cancelled.push(event);
        if (event.type === "tool_call.create") aborted.abort(new Error("DSH_QA_CANCEL"));
      }
    } catch (error) {
      assert.equal(error.message, "DSH_QA_CANCEL");
    }
  })();
  const timer = setTimeout(() => aborted.abort(new Error("DSH_QA_CANCEL")), 20000);
  const sibling = run("Reply only SIBLING_OK.");
  await cancellation;
  clearTimeout(timer);
  assert.equal(terminal(cancelled)[0]?.type, "run.cancelled");
  assert.equal(terminal(await sibling)[0].type, "run.completed");
  report.cancel = "cancelled; independent sibling completed";
  const recovered = await run("Reply only RECOVERED.");
  assert.equal(terminal(recovered)[0].type, "run.completed");
  report.recovery = "completed";
} finally {
  report.cleanup = await kernel.close();
  await rm(directory, { recursive: true, force: true });
  console.log(JSON.stringify(report, null, 2));
}
