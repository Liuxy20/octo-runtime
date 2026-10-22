import { createInterface } from "node:readline";
import { appendFileSync } from "node:fs";

const mode = process.env.OCTO_GROK_FIXTURE ?? "success";
const trace = process.env.OCTO_GROK_TRACE;
const authMethods = (
  {
    auth_missing: ["grok.com"],
    auth_api_key: ["xai.api_key"],
    auth_api_key_interactive: ["grok.com", "xai.api_key"],
    auth_api_key_first: ["xai.api_key", "cached_token"],
    auth_api_key_error: ["xai.api_key", "cached_token"],
    auth_cached_token: ["cached_token"]
  }[mode] ?? ["cached_token", "xai.api_key"]
).map((id) => ({ id }));
const send = (value) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...value }) + "\n");
const result = (id, value = {}) => send({ id, result: value });
const error = (id, message, data) =>
  send({ id, error: { code: -32603, message, ...(data ? { data } : {}) } });
const update = (sessionId, value) =>
  send({ method: "session/update", params: { sessionId, update: value } });
let nextSession = 0;
let activePrompt;
let pending;
let currentModel = "grok-test";
let effort = "high";
const options = () => [
  {
    id: "model",
    category: "model",
    currentValue: currentModel,
    options: [{ value: "grok-test" }, { value: "grok-three-level" }]
  },
  {
    id: "reasoning_effort",
    category: "thought_level",
    currentValue: effort,
    options: (currentModel === "grok-three-level"
      ? ["low", "medium", "high"]
      : ["low", "medium", "high", "xhigh"]
    ).map((value) => ({ value }))
  }
];
function finish(id, sessionId) {
  if (mode !== "empty") {
    update(sessionId, {
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "Checking" }
    });
    update(sessionId, {
      sessionUpdate: "tool_call",
      toolCallId: "tool-95",
      title: "read_file",
      status: "in_progress",
      rawInput: { path: "README.md" }
    });
    update(sessionId, {
      sessionUpdate: "tool_call_update",
      toolCallId: "tool-95",
      status: "completed",
      content: [{ type: "content", content: { type: "text", text: "file contents" } }]
    });
    update(sessionId, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "OCTO_" }
    });
    update(sessionId, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "GROK_95" }
    });
  }
  result(id, {
    stopReason: mode === "incomplete" ? "max_tokens" : "end_turn",
    _meta: { modelId: currentModel, usage: { inputTokens: 12, outputTokens: 3, totalTokens: 15 } }
  });
}

createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (trace)
    appendFileSync(
      trace,
      JSON.stringify({
        ...message,
        fixtureCwd: process.cwd(),
        fixtureEnv: process.env.OCTO_TEST_VALUE,
        fixturePid: process.pid
      }) + "\n"
    );
  if (pending && message.id === pending.id && !message.method) {
    const { promptId, sessionId } = pending;
    pending = undefined;
    finish(promptId, sessionId);
    return;
  }
  const { method, params = {}, id } = message;
  if (method === "initialize")
    return result(id, {
      protocolVersion: mode === "bad_protocol" ? 2 : 1,
      _meta: { agentVersion: mode === "bad_version" ? "0.2.1" : "1.0.67" },
      authMethods,
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: { image: mode !== "no_images" },
        mcpCapabilities: { http: true }
      }
    });
  if (method === "authenticate") {
    if (!authMethods.some(({ id }) => id === params.methodId))
      return error(id, "authentication method was not advertised");
    return mode === "auth_error" || mode === "auth_api_key_error"
      ? error(id, `rejected ${process.env.OCTO_TEST_SECRET}`)
      : result(id);
  }
  if (method === "session/new")
    return result(id, {
      sessionId: `grok-session-${++nextSession}`,
      configOptions: options(),
      models: { currentModelId: currentModel }
    });
  if (method === "session/load")
    return mode === "missing_session"
      ? error(id, "Path not found.", { code: "FS_NOT_FOUND" })
      : mode === "load_error"
        ? error(id, "Authentication expired")
        : result(id, { configOptions: options(), models: { currentModelId: currentModel } });
  if (method === "session/set_mode")
    return mode === "mode_error" ? error(id, "mode request failed") : result(id);
  if (method === "session/set_config_option") {
    if (params.configId === "model") currentModel = params.value;
    if (params.configId === "reasoning_effort") effort = params.value;
    return result(id, { configOptions: options() });
  }
  if (method === "session/cancel") {
    if (activePrompt) result(activePrompt.id, { stopReason: "cancelled" });
    return;
  }
  if (method !== "session/prompt") return error(id, "unexpected fixture request");
  activePrompt = { id, sessionId: params.sessionId };
  if (mode === "wait") return;
  if (mode === "exit") return process.exit(7);
  if (mode === "disconnect" || mode === "disconnect_diagnostic") {
    if (mode === "disconnect_diagnostic")
      process.stderr.write("CONFIG_INVALID: missing provider credential\n");
    process.stdout.end();
    setInterval(() => {}, 1000);
    return;
  }
  if (mode === "provider_error")
    return error(id, `provider rejected key ${process.env.OCTO_TEST_SECRET}`);
  if (mode === "accepted_only") return result(id, { accepted: true });
  if (["permission", "question", "plan"].includes(mode)) {
    pending = { id: "reverse-95", promptId: id, sessionId: params.sessionId };
    if (mode === "permission")
      return send({
        id: pending.id,
        method: "session/request_permission",
        params: {
          sessionId: params.sessionId,
          toolCall: { toolCallId: "tool-95", title: "Read file" },
          options: [
            { optionId: "once", kind: "allow_once" },
            { optionId: "deny", kind: "reject_once" }
          ]
        }
      });
    const nativeMethod = mode === "question" ? "x.ai/ask_user_question" : "x.ai/exit_plan_mode";
    const nativeParams = {
      sessionId: params.sessionId,
      toolCallId: "tool-95",
      ...(mode === "question"
        ? { questions: [{ question: "Which file?", options: [{ label: "README.md" }] }] }
        : { planContent: "Read README.md" })
    };
    return send({
      id: pending.id,
      method: `_${nativeMethod}`,
      params: nativeParams
    });
  }
  finish(id, params.sessionId);
});
