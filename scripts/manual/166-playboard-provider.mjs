import { createInterface } from "node:readline";
import { appendFileSync } from "node:fs";

// 专项独占的假 Provider；回执记录响应次数、实际 cwd 和 PID，不使用真实账号。
const trace = (value) => appendFileSync(process.env.ORT166_TRACE, JSON.stringify(value) + "\n");
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
trace({ pid: process.pid, hostPid: process.ppid, cwd: process.cwd() });
let scenario;
const identity = { threadId: "thread-166", turnId: "turn-166" };
const finish = (status = "completed") =>
  send({
    method: "turn/completed",
    params: { ...identity, turn: { id: identity.turnId, status } }
  });
const interaction = (kind) =>
  send({
    id: kind === "approval" ? 42 : 43,
    method:
      kind === "approval"
        ? "item/commandExecution/requestApproval"
        : kind === "question"
          ? "item/tool/requestUserInput"
          : "mcpServer/elicitation/request",
    params: {
      ...identity,
      command: "printf approved",
      questions: [{ id: "q", header: "Choice", question: "Continue?", options: [] }],
      message: "Continue?",
      requestedSchema: { type: "object", properties: {} }
    }
  });
for await (const line of createInterface({ input: process.stdin })) {
  const message = JSON.parse(line);
  if (message.method === "initialize") send({ id: message.id, result: {} });
  // SDK 每轮注入环境时，生产 Adapter 先读取原生配置再合并覆盖。
  else if (message.method === "config/read") send({ id: message.id, result: { config: {} } });
  else if (message.method === "thread/start" || message.method === "thread/resume")
    send({ id: message.id, result: { thread: { id: identity.threadId } } });
  else if (message.method === "thread/name/set") send({ id: message.id, result: {} });
  else if (message.method === "turn/start") {
    scenario = message.params.input[0].text;
    trace({ scenario });
    send({ id: message.id, result: { turn: { id: identity.turnId } } });
    interaction(["question", "elicitation"].includes(scenario) ? scenario : "approval");
  } else if (message.id === 42) {
    trace({ approvalReply: message });
    send({ method: "native/replyObserved", params: { ...identity, reply: message } });
    if (scenario === "approval-then-question") interaction("question");
    else if (scenario === "fail-after-approval") finish("failed");
    else if (scenario !== "hang-after-approval") finish();
  } else if (message.id === 43) {
    trace({ externalReply: message });
    finish();
  } else if (message.method === "turn/interrupt") {
    trace({ interrupted: true });
    send({ id: message.id, result: {} });
    finish("interrupted");
  }
}
