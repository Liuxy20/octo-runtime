import { createInterface } from "node:readline";
import { appendFileSync } from "node:fs";
let thread = 0,
  turn = 0;
const active = new Map();
const interactions = new Map();
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const notify = (method, params) => send({ method, params });
const reader = createInterface({ input: process.stdin });
const log = process.argv[2];
reader.on("line", (line) => {
  const message = JSON.parse(line);
  if (log)
    appendFileSync(
      log,
      JSON.stringify({ pid: process.pid, method: message.method, id: message.id }) + "\n"
    );
  const reply = (result = {}) => send({ id: message.id, result });
  if (!message.method && interactions.has(message.id)) {
    const { threadId, id } = interactions.get(message.id);
    interactions.delete(message.id);
    notify("turn/completed", {
      threadId,
      turn: { id, status: message.error ? "failed" : "completed" }
    });
    return;
  }
  if (message.method === "initialize") return reply();
  if (message.method === "thread/name/set") return reply();
  if (message.method === "thread/start")
    return reply({ thread: { id: `thread-${process.pid}-${++thread}` } });
  if (message.method === "thread/resume") return reply({ thread: { id: message.params.threadId } });
  if (message.method === "thread/unsubscribe") {
    active.delete(message.params.threadId);
    return reply({ status: "unsubscribed" });
  }
  if (message.method === "config/read") return reply({ config: {} });
  if (message.method === "turn/interrupt") {
    if (active.get(message.params.threadId)?.startsWith("ignored-")) return;
    reply();
    const id = active.get(message.params.threadId);
    if (id)
      notify("turn/completed", {
        threadId: message.params.threadId,
        turn: { id, status: "interrupted" }
      });
    return;
  }
  if (message.method === "turn/start") {
    const threadId = message.params.threadId;
    const prompt = message.params.input[0].text;
    const id = `${prompt === "stall-ignore" ? "ignored-" : ""}turn-${++turn}`;
    active.set(threadId, id);
    // Exercise notifications arriving before the turn/start ACK.
    notify("turn/started", { threadId, turn: { id, status: "inProgress" } });
    reply({ turn: { id } });
    if (prompt === "partial-line") {
      process.stdout.write("x".repeat(300 * 1024));
      return;
    }
    if (prompt === "exit") return process.exit(3);
    if (prompt === "hang") return;
    if (prompt.startsWith("approval") || prompt === "elicitation") {
      const rpcId = `interaction-${id}`;
      interactions.set(rpcId, { threadId, id });
      send({
        id: rpcId,
        method:
          prompt === "elicitation"
            ? "mcpServer/elicitation/request"
            : "item/commandExecution/requestApproval",
        params: {
          threadId,
          turnId: prompt === "elicitation" ? null : id,
          itemId: "tool",
          command: "read-only-probe",
          serverName: "probe",
          mode: "form",
          message: "Confirm probe",
          requestedSchema: { type: "object", properties: {} }
        }
      });
      return;
    }
    if (prompt === "eof-live") {
      process.stdout.end();
      setInterval(() => {}, 1000);
      return;
    }
    const item = { id: `answer-${id}`, type: "agentMessage", phase: "final_answer", text: prompt };
    notify("item/started", { threadId, turnId: id, item });
    notify("item/completed", { threadId, turnId: id, item });
    if (prompt === "stall" || prompt === "stall-ignore") return;
    setTimeout(() => {
      if (active.get(threadId) !== id) return;
      notify("turn/completed", { threadId, turn: { id, status: "completed" } });
    }, 25);
  }
});
reader.on("close", () => process.exit(0));
