// Explicit local protocol probe. Only the process created here is terminated.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { createProcessCleanup } from "../../packages/octo-runtime-adapter-sdk/dist/process-cleanup.js";

if (!process.argv.includes("--run")) throw new Error("Pass --run to invoke the installed Codex");
const child = spawn("codex", ["app-server", "--listen", "stdio://"], { stdio: "pipe" });
const cleanup = createProcessCleanup(child);
const pending = new Map();
const completed = new Map();
const waiters = new Map();
let next = 0;
let failure;
const reader = createInterface({ input: child.stdout });
child.stderr.resume();
reader.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id !== undefined && ("result" in message || "error" in message)) {
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
    else entry.resolve(message.result);
  } else if (message.method === "turn/completed") {
    const id = message.params.turn.id;
    completed.set(id, message.params.turn.status);
    waiters.get(id)?.resolve();
  } else if (message.id !== undefined) {
    child.stdin.write(
      JSON.stringify({ id: message.id, error: { code: -32601, message: "probe declines tools" } }) +
        "\n"
    );
  }
});
function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++next;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(method + " timeout"));
    }, 60_000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
  });
}
async function finish(id) {
  if (!completed.has(id))
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("turn completion timeout")), 90_000);
      waiters.set(id, {
        timer,
        reject,
        resolve: () => {
          clearTimeout(timer);
          waiters.delete(id);
          resolve();
        }
      });
    });
  return completed.get(id);
}
try {
  await rpc("initialize", {
    clientInfo: { name: "octo-313-probe", version: "0.1.0" },
    capabilities: { experimentalApi: true }
  });
  child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
  const threads = await Promise.all(
    ["one", "two"].map((name) =>
      rpc("thread/start", {
        cwd: process.cwd(),
        approvalPolicy: "never",
        sandbox: "read-only",
        developerInstructions: "Do not use tools. Reply with a single short word. " + name
      })
    )
  );
  assert.notEqual(threads[0].thread.id, threads[1].thread.id);
  const turns = await Promise.all(
    threads.map((result) =>
      rpc("turn/start", {
        threadId: result.thread.id,
        input: [{ type: "text", text: "Reply OK." }]
      })
    )
  );
  for (const status of await Promise.all(turns.map((result) => finish(result.turn.id))))
    assert.equal(status, "completed");
  const resumed = await rpc("thread/resume", {
    threadId: threads[0].thread.id,
    excludeTurns: true,
    developerInstructions: "Do not use tools. Reply briefly."
  });
  assert.equal(resumed.thread.id, threads[0].thread.id);
  const followup = await rpc("turn/start", {
    threadId: resumed.thread.id,
    input: [{ type: "text", text: "Reply OK again." }]
  });
  assert.equal(await finish(followup.turn.id), "completed");
  for (const result of threads) await rpc("thread/unsubscribe", { threadId: result.thread.id });
  console.log(
    JSON.stringify({
      pid: child.pid,
      initialize: 1,
      concurrentThreads: 2,
      resumed: true,
      unsubscribe: true,
      result: "passed"
    })
  );
} catch (error) {
  failure = error;
  throw error;
} finally {
  for (const entry of pending.values()) {
    clearTimeout(entry.timer);
    entry.reject(new Error("probe closing"));
  }
  for (const waiter of waiters.values()) {
    clearTimeout(waiter.timer);
    waiter.reject(new Error("probe closing"));
  }
  waiters.clear();
  reader.close();
  child.stdin.end();
  try {
    await cleanup();
  } catch (error) {
    if (failure) throw new AggregateError([failure, error], "Protocol probe and cleanup failed");
    throw error;
  }
}
