import { createInterface } from "node:readline";
import { appendFileSync } from "node:fs";

const threads = new Map();
const turns = new Map();
const approvals = new Map();
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const notify = (method, params) => send({ method, params });
let sequence = 0;
let released = false;
const complete = (threadId, status = "completed") => {
  const turn = turns.get(threadId);
  if (!turn || turn.done) return;
  turn.done = true;
  notify("turn/completed", { threadId, turn: { id: turn.id, status } });
};
const release = () => {
  if (released || turns.size < Number(process.argv[3] ?? 1)) return;
  released = true;
  for (const [threadId, turn] of turns) {
    const item = {
      id: `answer-${turn.id}`,
      type: "agentMessage",
      phase: "final_answer",
      text: turn.text
    };
    notify("item/completed", { threadId, turnId: turn.id, item });
    if (turn.text.startsWith("approval")) {
      const id = `approve-${turn.id}`;
      approvals.set(id, threadId);
      send({
        id,
        method: "item/commandExecution/requestApproval",
        params: {
          threadId,
          turnId: turn.id,
          itemId: `tool-${turn.id}`,
          command: turn.text
        }
      });
    } else if (turn.text !== "hang") complete(threadId);
  }
};
createInterface({ input: process.stdin })
  .on("line", (line) => {
    const m = JSON.parse(line);
    appendFileSync(process.argv[2], JSON.stringify(m) + "\n");
    const reply = (result = {}) => send({ id: m.id, result });
    if (!m.method) {
      const threadId = approvals.get(m.id);
      if (threadId) {
        approvals.delete(m.id);
        complete(threadId, m.error ? "failed" : "completed");
      }
      return;
    }
    if (m.method === "config/read")
      return reply({
        config: {
          shell_environment_policy: { set: { BASE: "native" } },
          mcp_servers: { native: { command: "node", env: { MCP_OWN: "native" } } }
        }
      });
    if (m.method === "thread/start") {
      const id = `thread-${++sequence}`;
      threads.set(id, m.params);
      if (process.env.OCTO_343_ROUTE_PROBE === "1") {
        if (threads.size === 1) {
          for (let i = 0; i < 128; i++)
            send({
              ...(i === 0 ? { id: "orphan-request" } : {}),
              method: "item/started",
              params: { threadId: `orphan-${i}`, turnId: "old-turn", item: {} }
            });
        } else notify("thread/started", { threadId: id, thread: { id } });
      }
      return reply({ thread: { id } });
    }
    if (m.method === "thread/resume") return reply({ thread: { id: m.params.threadId } });
    if (m.method === "turn/start") {
      const threadId = m.params.threadId;
      const id = `turn-${++sequence}`;
      const text = m.params.input.find((part) => part.type === "text").text;
      turns.set(threadId, { id, text });
      notify("turn/started", { threadId, turn: { id, status: "inProgress" } });
      reply({ turn: { id } });
      release();
      if (released && turns.size > Number(process.argv[3] ?? 1)) complete(threadId);
      return;
    }
    if (m.method === "turn/interrupt") {
      reply();
      complete(m.params.threadId, "interrupted");
      return;
    }
    if (m.method === "thread/unsubscribe") return reply({ status: "unsubscribed" });
    if (m.id !== undefined) reply();
  })
  .on("close", () => process.exit(0));
