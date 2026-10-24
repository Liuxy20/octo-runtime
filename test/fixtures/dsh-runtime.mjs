import { createInterface } from "node:readline";
import { appendFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";

if (process.argv.includes("--version")) {
  if (process.env.OCTO_DSH_FIXTURE === "version-cancel") {
    writeFileSync(process.env.OCTO_DSH_VERSION_PID, String(process.pid));
    setInterval(() => {}, 1000);
    await new Promise(() => {});
  }
  console.log(process.env.OCTO_DSH_FIXTURE === "version" ? "0.0.0" : "0.2.1-rc.3");
  process.exit(0);
}
const mode = process.env.OCTO_DSH_FIXTURE ?? "success";
const send = (value) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...value }) + "\r\n");
let seq = 0;
let root;
let waiter;
const notify = (sessionId, type, data) =>
  send({
    method: "session.event",
    params: {
      sessionId,
      event: { type, seq: seq++, time: Date.now(), data }
    }
  });
const result = (id, value = {}) => send({ id, result: value });
const error = (id) =>
  send({ id, error: { code: -32000, message: process.env.OCTO_DSH_CANARY ?? "fixture failure" } });
const trace = (message) => {
  if (process.env.OCTO_DSH_TRACE)
    appendFileSync(
      process.env.OCTO_DSH_TRACE,
      JSON.stringify({
        ...message,
        pid: process.pid,
        cwd: process.cwd(),
        permission: process.env.DSH_PERMISSION_MODE,
        value: process.env.OCTO_DSH_VALUE
      }) + "\n"
    );
};
const terminal = () => {
  if (mode !== "no-terminal")
    notify(root, "turn/end", {
      turn: 0,
      reason:
        mode === "provider-error"
          ? {
              kind: "error",
              error: { code: "ACCOUNT_SIGN_IN_REQUIRED", message: process.env.OCTO_DSH_CANARY }
            }
          : { kind: "completed" }
    });
  send({ method: "session.status", params: { sessionId: root, status: "idle" } });
  if (waiter) result(waiter);
};
const answer = () => {
  notify(root, "step/start", { turn: 0, step: 0 });
  if (mode === "tool") {
    notify(root, "tool/call", {
      turn: 0,
      step: 0,
      callId: "tool-1",
      name: "read",
      arguments: JSON.stringify({ path: "fixture.txt" })
    });
    notify(root, "tool/result", {
      turn: 0,
      step: 0,
      message: {
        toolCallId: "tool-1",
        isError: true,
        content: [{ type: "text", text: "not found" }]
      }
    });
  }
  if (mode === "child") {
    send({
      method: "subagent.started",
      params: { parentSessionId: root, childSessionId: "child" }
    });
    notify("unrelated", "assistant/message", {
      turn: 0,
      step: 0,
      message: { content: [{ type: "text", text: "LEAK" }] }
    });
    notify("child", "turn/start", { turn: 0 });
    notify("child", "step/start", { turn: 0, step: 0 });
    notify("child", "assistant/message", {
      turn: 0,
      step: 0,
      message: { content: [{ type: "text", text: "child output" }] }
    });
    notify("child", "step/end", { turn: 0, step: 0 });
    notify("child", "turn/end", { turn: 0, reason: { kind: "completed" } });
    send({
      method: "subagent.finished",
      params: { parentSessionId: root, childSessionId: "child", status: "ok" }
    });
  }
  if (mode !== "provider-error") {
    if (mode === "legacy-chunk")
      notify(root, "assistant/chunk", {
        turn: 0,
        step: 0,
        chunk: { type: "text-delta", text: "hello " }
      });
    notify(root, "assistant/message", {
      turn: 0,
      step: 0,
      message: {
        id: "message",
        content: [
          { type: "reasoning", text: "private fixture analysis" },
          { type: "text", text: mode === "empty" ? "" : "hello 世界" }
        ]
      },
      ...(mode === "legacy-chunk" || mode === "empty"
        ? {}
        : {
            stream: [
              { type: "text-chunks", texts: ["hello ", mode === "mismatch" ? "wrong" : "世界"] }
            ]
          }),
      usage: { inputTokens: 12, outputTokens: 3 }
    });
  }
  notify(root, "step/end", { turn: 0, step: 0 });
  terminal();
};
createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  trace(message);
  const { id, method, params } = message;
  if (method === "initialize") {
    if (mode === "startup-timeout") return;
    if (mode === "invalid-json") return process.stdout.write("invalid\n");
    if (mode === "oversized") return process.stdout.write("x".repeat(10000) + "\n");
    if (mode === "start-error") return error(id);
    console.log("[llm-deepseek-account] fixture catalog info");
    result(id, { serverInfo: { name: "deepseek-harness-sdk-runtime", version: "0.0.1" } });
  } else if (method === "session/resume") {
    if (mode === "resume-error") error(id);
    else result(id);
  } else if (method === "session/working-directory/set") {
    result(id, { cwd: params.path });
  } else if (method === "session/prompt") {
    root = params.sessionId;
    if (mode === "transport") return process.exit(7);
    if (mode !== "no-receipt")
      notify(root, "agent/inbox/spliced", { inserted: [{ id: "receipt" }] });
    notify(root, "turn/start", { turn: 0 });
    result(id, { messageId: "receipt" });
    if (mode === "cancel" || mode === "tree") {
      if (mode === "tree") {
        const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
          stdio: "ignore"
        });
        if (process.env.OCTO_DSH_CHILD_PID)
          writeFileSync(process.env.OCTO_DSH_CHILD_PID, String(child.pid));
      }
      setInterval(() => {}, 1000);
    } else if (mode === "delayed") setTimeout(answer, 300);
    else answer();
  } else if (method === "session/wait") {
    waiter = id;
    if (!["cancel", "tree", "delayed"].includes(mode)) result(id);
  } else if (method === "shutdown") {
    result(id);
    process.exit(0);
  }
});
