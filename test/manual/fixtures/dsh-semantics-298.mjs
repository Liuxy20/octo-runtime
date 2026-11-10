import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

// 确定性原生协议 fixture；不调用模型、不读取认证。也供 trajectory 专项复用。
export function scenario(mode = "multi", root = "root") {
  if (mode === "interrupted-completed") {
    const events = scenario("final", root);
    events.find(
      (item) => item.params.event?.type === "assistant/message"
    ).params.event.data.interrupted = true;
    return events;
  }
  const result = [];
  const seqs = new Map();
  const notify = (type, data, sessionId = root) => {
    const seq = seqs.get(sessionId) ?? 0;
    seqs.set(sessionId, seq + 1);
    result.push({
      method: "session.event",
      params: { sessionId, event: { type, seq, time: 1000 + result.length * 10, data } }
    });
  };
  const message = (text, step, sessionId = root, turn = 0, extra = {}) => {
    if (mode === "chunks")
      notify(
        "assistant/chunk",
        { turn, step, chunk: { type: "text-delta", text: text.slice(0, 2) } },
        sessionId
      );
    notify(
      "assistant/message",
      {
        turn,
        step,
        message: {
          content: [
            { type: "reasoning", text: "PRIVATE_FIXTURE" },
            { type: "text", text }
          ]
        },
        stream: [{ type: "text-chunks", texts: [text.slice(0, 2), text.slice(2)] }],
        ...extra
      },
      sessionId
    );
  };
  notify("agent/inbox/spliced", { inserted: [{ id: "receipt" }] });
  notify("turn/start", { turn: 0 });
  notify("step/start", { turn: 0, step: 0 });
  if (!["final", "chunks", "cancel", "error", "max-tokens"].includes(mode)) {
    message("我将检查文件。", 0);
    for (const callId of ["read-1", "read-2"])
      notify("tool/call", {
        turn: 0,
        step: 0,
        callId,
        name: "read",
        arguments: JSON.stringify({ path: `${callId}.txt` })
      });
    for (const callId of ["read-2", "read-1"])
      notify("tool/result", {
        turn: 0,
        step: 0,
        message: {
          toolCallId: callId,
          isError: callId === "read-2",
          content: [{ type: "text", text: callId === "read-2" ? "not found" : "ok" }]
        }
      });
    notify("step/end", { turn: 0, step: 0 });
    if (mode === "tool-only") {
      notify("turn/end", { turn: 0, reason: { kind: "completed" } });
      return result;
    }
    result.push({
      method: "subagent.started",
      params: { parentSessionId: root, childSessionId: "child" }
    });
    notify("turn/start", { turn: 0 }, "child");
    notify("step/start", { turn: 0, step: 0 }, "child");
    message("子代理结果", 0, "child");
    notify("step/end", { turn: 0, step: 0 }, "child");
    notify("turn/end", { turn: 0, reason: { kind: "completed" } }, "child");
    result.push({
      method: "subagent.finished",
      params: { parentSessionId: root, childSessionId: "child", status: "ok" }
    });
    if (mode === "child-late" || mode === "child-reattach") {
      const finished = {
        method: "subagent.finished",
        params: { parentSessionId: root, childSessionId: "child", status: "ok" }
      };
      result.push(finished);
      notify("turn/start", { turn: 1 }, "child");
      notify("step/start", { turn: 1, step: 0 }, "child");
      message("LATE_CHILD_REPLAY", 0, "child", 1);
      notify("step/end", { turn: 1, step: 0 }, "child");
      notify("turn/end", { turn: 1, reason: { kind: "completed" } }, "child");
      if (mode === "child-reattach") {
        const started = {
          method: "subagent.started",
          params: { parentSessionId: root, childSessionId: "child" }
        };
        result.push(started, started);
        notify("turn/start", { turn: 1 }, "child");
        notify("step/start", { turn: 1, step: 0 }, "child");
        message("子代理续跑结果", 0, "child", 1);
        notify("step/end", { turn: 1, step: 0 }, "child");
        notify("turn/end", { turn: 1, reason: { kind: "completed" } }, "child");
        result.push(finished, finished);
      }
    }
    notify("step/start", { turn: 0, step: 1 });
  }
  const step = ["final", "chunks", "cancel", "error", "max-tokens"].includes(mode) ? 0 : 1;
  message("检查完成。", step, root, 0, mode === "cancel" ? { interrupted: true } : {});
  notify("step/end", { turn: 0, step });
  notify("turn/end", {
    turn: 0,
    reason: {
      kind:
        mode === "cancel"
          ? "aborted"
          : mode === "error"
            ? "error"
            : mode === "max-tokens"
              ? "max-tokens"
              : "completed"
    }
  });
  if (mode === "turns") {
    notify("turn/start", { turn: 1 });
    notify("step/start", { turn: 1, step: 0 });
    message("最后一轮回答。", 0, root, 1);
    notify("step/end", { turn: 1, step: 0 });
    notify("turn/end", { turn: 1, reason: { kind: "completed" } });
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--version")) {
    console.log("0.2.1-rc.5");
    process.exit(0);
  }
  const send = (value) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...value }) + "\n");
  createInterface({ input: process.stdin }).on("line", (line) => {
    const { id, method, params } = JSON.parse(line);
    if (method === "initialize")
      send({
        id,
        result: { serverInfo: { name: "deepseek-harness-sdk-runtime", version: "0.0.1" } }
      });
    else if (method === "session/prompt") {
      send({ id, result: { messageId: "receipt" } });
      for (const notification of scenario(process.env.OCTO_DSH_SEMANTICS_MODE, params.sessionId))
        send(notification);
      send({ method: "session.status", params: { sessionId: params.sessionId, status: "idle" } });
    } else if (method === "session/wait") send({ id, result: {} });
    else if (method === "shutdown") {
      send({ id, result: {} });
      process.exit(0);
    }
  });
}
