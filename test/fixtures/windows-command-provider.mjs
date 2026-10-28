import { createInterface } from "node:readline";
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const send = (value) => console.log(JSON.stringify(value));
if (process.env.FIXTURE_PID_FILE) writeFileSync(process.env.FIXTURE_PID_FILE, String(process.pid));
if (args.includes("--version")) {
  console.log("provider v1.2.3");
} else if (args[0] === "json") {
  send({ args: args.slice(1), cwd: process.cwd(), marker: process.env.FIXTURE_MARKER });
} else if (args[0] === "exit") {
  console.error("controlled failure");
  process.exitCode = 7;
} else if (args[0] === "hold") {
  send({ pid: process.pid });
  setInterval(() => {}, 1000);
} else if (args.includes("--output-format")) {
  send({
    type: "assistant",
    message: {
      id: "fixture-message",
      role: "assistant",
      content: [{ type: "text", text: "carrier fixture reply" }]
    }
  });
  send({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "carrier fixture reply",
    session_id: "fixture-session",
    usage: {}
  });
  process.stdin.resume();
} else {
  const input = createInterface({ input: process.stdin });
  input.on("line", (line) => {
    const message = JSON.parse(line);
    if (message.id === undefined) return;
    let result = {};
    if (message.method === "initialize")
      result = { protocolVersion: 1, pid: process.pid, marker: process.env.FIXTURE_MARKER };
    if (message.method === "config/read") result = { config: {} };
    if (message.method === "skills/list") result = { data: [] };
    if (["thread/start", "thread/resume"].includes(message.method))
      result = { thread: { id: "fixture-thread" } };
    if (message.method === "turn/start") result = { turn: { id: "fixture-turn" } };
    send({ jsonrpc: "2.0", id: message.id, result });
    if (message.method === "turn/start") {
      send({
        method: "item/agentMessage/delta",
        params: {
          threadId: "fixture-thread",
          turnId: "fixture-turn",
          itemId: "fixture-message",
          delta: "carrier fixture reply"
        }
      });
      send({
        method: "item/completed",
        params: {
          threadId: "fixture-thread",
          turnId: "fixture-turn",
          item: { id: "fixture-message", type: "agentMessage", text: "carrier fixture reply" }
        }
      });
      send({
        method: "turn/completed",
        params: { threadId: "fixture-thread", turn: { id: "fixture-turn", status: "completed" } }
      });
    }
  });
}
