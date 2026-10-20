import { invocationInput } from "@mininglamp-oss/octo-runtime-protocol";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { attachKernel } from "../packages/octo-runtime-executor-kernel/dist/index.js";
import { componentEndpoint } from "../packages/octo-runtime-host-sdk/dist/index.js";
import { runCli } from "../apps/cli/dist/main.js";

const home = process.env.OCTO_STATELESS_LIVE_HOME ?? "/tmp/octo-runtime-im-codex-test";
const socketPath = componentEndpoint(home);
const client = attachKernel({ endpoint: socketPath });
const pages = await fetch("http://127.0.0.1:9222/json/list").then((response) => response.json());
const page = pages.find((value) => value.type === "page" && value.url.includes("localhost"));
assert.ok(page, "A real Work App renderer with CDP is required");
const cdp = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  cdp.addEventListener("open", resolve, { once: true });
  cdp.addEventListener("error", reject, { once: true });
});
try {
  const environment = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("CDP timeout")), 15_000);
    cdp.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      clearTimeout(timer);
      if (message.error || message.result.exceptionDetails)
        reject(new Error("Renderer probe failed"));
      else resolve(message.result.result.value);
    });
    cdp.send(
      JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: {
          expression:
            "(async()=>{const c=await window.octoWork.getConfig(),s=await window.octoWork.restoreSession(),r=await window.octoWork.getEmbeddedRuntimeStatus();return {server:c.serverUrl,loggedIn:s.loggedIn,daemonPid:r.daemonPid,phase:r.phase}})()",
          awaitPromise: true,
          returnByValue: true
        }
      })
    );
  });
  assert.equal(environment.server, "https://im-test.deepminer.com.cn");
  assert.equal(environment.loggedIn, true);
  assert.equal(environment.phase, "running");
  const status = await client.status();
  assert.equal(status.execution_ready, true);
  assert.equal(status.storePath, undefined);
  let componentStatus;
  await runCli(["--home", home, "status"], {
    output: (line) => {
      componentStatus = JSON.parse(line);
    }
  });
  const channels = componentStatus["channel-gateway"]?.runtime?.status?.bots ?? [];
  assert.ok(
    channels.some((channel) => channel.state === "online"),
    "Live IM registration and connection required"
  );
  const legacyFiles = (await readdir(home)).filter((name) =>
    /\.(?:db|sqlite)(?:-wal|-shm)?$/.test(name)
  );
  const before = await Promise.all(
    legacyFiles.map(async (name) => ({ name, mtime: (await stat(join(home, name))).mtimeMs }))
  );
  const marker = "STATELESS_" + randomUUID().slice(0, 8);
  const prompt = "Reply exactly " + marker + ". Do not call tools.";
  let answer = "",
    terminal;
  const request = {
    protocolVersion: 2,
    invocationId: randomUUID(),
    runId: randomUUID(),
    agentSessionId: randomUUID(),
    sessionGeneration: 0,
    prompt,
    modelInput: prompt,
    controlInstructions: "",
    context: { schema: "octo.context-envelope/v3", items: [] },
    approvalMode: "full_access",
    agentSource: "provisioned",
    agentConfig: {},
    workdir: process.cwd(),
    signal: AbortSignal.timeout(90_000)
  };
  const { ref } = await client.submit(invocationInput(request, "canonical", "codex"), {
    signal: request.signal
  });
  const cancel = () => {
    void client.cancel(ref, "QA timeout").catch(() => undefined);
  };
  request.signal.addEventListener("abort", cancel, { once: true });
  for await (const frame of client.subscribe(ref)) {
    if (
      frame.kind === "canonical" &&
      frame.event.type === "message.delta" &&
      frame.event.payload.channel === "final"
    )
      answer += frame.event.payload.text ?? "";
    if (frame.kind === "control" && frame.control.type === "state") terminal = frame.control.state;
  }
  request.signal.removeEventListener("abort", cancel);
  assert.equal(terminal, "completed");
  assert.equal(answer.trim(), marker);
  for (const file of before) assert.equal((await stat(join(home, file.name))).mtimeMs, file.mtime);
  assert.deepEqual(
    (await readdir(home)).filter((name) => /\.(?:db|sqlite)(?:-wal|-shm)?$/.test(name)),
    legacyFiles
  );
  console.log(
    JSON.stringify({
      passed: true,
      server: environment.server,
      rendererDaemonPid: environment.daemonPid,
      daemonPid: status.pid,
      liveImConnected: true,
      provider: "codex",
      runId: request.runId,
      terminal,
      noDatabaseWrites: true,
      legacyDatabaseCount: legacyFiles.length
    })
  );
} finally {
  client.close();
  cdp.close();
}
