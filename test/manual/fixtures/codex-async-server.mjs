import { createInterface } from "node:readline";
let scenario = "normal",
  steers = 0,
  resumedThread;
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const notify = (method, item) =>
  send({ method, params: { threadId: "thread-async", turnId: "turn-async", item } });
const finish = () =>
  send({
    method: "turn/completed",
    params: {
      threadId: "thread-async",
      turnId: "turn-async",
      turn: { id: "turn-async", status: "completed" }
    }
  });
createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line);
  if (!m.method || m.id === undefined) return;
  if (["thread/start", "thread/resume"].includes(m.method)) {
    if (m.method === "thread/resume" && m.params.threadId === "resume-reject")
      return send({ id: m.id, error: { code: -32602, message: "fixture resume rejected" } });
    resumedThread = m.method === "thread/resume" ? m.params.threadId : "thread-async";
    return send({ id: m.id, result: { thread: { id: resumedThread } } });
  }
  if (m.method === "config/read") return send({ id: m.id, result: { config: {} } });
  if (m.method === "skills/list") return send({ id: m.id, result: { data: [{ skills: [] }] } });
  if (m.method === "turn/start") {
    if (resumedThread === "resume-turn-reject")
      return send({ id: m.id, error: { code: -32602, message: "thread not found" } });
    scenario = m.params.input[0].text;
    send({ id: m.id, result: { turn: { id: "turn-async" } } });
    if (scenario.startsWith("Answer to async user questions:")) {
      setTimeout(() => {
        notify("item/completed", {
          type: "agentMessage",
          id: "supplement-result",
          phase: "final_answer",
          text: scenario
        });
        finish();
      }, 10);
      return;
    }
    setTimeout(() => {
      const item = {
        type: "agentMessage",
        id: "async-message",
        text: "Color? Then details?",
        phase: "final_answer",
        delivery: "async",
        questions: [
          { title: "Color?", options: ["Red", "Green"] },
          { title: "Details?", options: null }
        ]
      };
      notify("item/started", item);
      notify("item/completed", item);
      notify("item/completed", item);
      if (scenario.includes("stale")) setTimeout(finish, 20);
      if (scenario.includes("long-gap"))
        setTimeout(() => {
          notify("item/completed", {
            type: "agentMessage",
            id: "gap-finished",
            phase: "final_answer",
            text: "gap-finished"
          });
          finish();
        }, 300);
    }, 5);
    return;
  }
  if (m.method === "turn/steer") {
    steers++;
    if (scenario.includes("reject")) {
      send({ id: m.id, error: { code: -32602, message: "fixture turn rejected" } });
      finish();
      return;
    }
    if (scenario.includes("lost")) {
      finish();
      return;
    }
    send({
      id: m.id,
      result: { turnId: scenario.includes("wrong") ? "wrong-turn" : "turn-async" }
    });
    notify("item/completed", {
      type: "agentMessage",
      id: "final",
      phase: "final_answer",
      text: `steers=${steers}; ${m.params.input[0].text}`
    });
    finish();
    return;
  }
  send({ id: m.id, result: {} });
  if (m.method === "turn/interrupt") finish();
});
