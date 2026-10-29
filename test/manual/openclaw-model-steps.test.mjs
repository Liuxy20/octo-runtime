import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import Ajv from "ajv";
import { createOpenClawAdapter } from "../../packages/octo-runtime-adapter-openclaw/dist/index.js";
import { resolveGatewayContract } from "../../packages/octo-runtime-adapter-openclaw/dist/compatibility.js";
import { assertCanonicalEvent } from "../../packages/octo-runtime-protocol/dist/index.js";
import { ImRunProjector } from "../../packages/octo-runtime-extra-channel-gateway/dist/presentation/run-projector.js";
import { reasoningPhases } from "../../packages/octo-runtime-extra-channel-gateway/dist/transport/reasoning-frame.js";

const contracts = JSON.parse(
  await readFile(
    new URL("../../test-support/openclaw-request-contracts.json", import.meta.url),
    "utf8"
  )
);
const resumeContracts = JSON.parse(
  await readFile(
    new URL("../../test-support/openclaw-resume-contracts.json", import.meta.url),
    "utf8"
  )
);
const ajv = new Ajv();
const validators = Object.fromEntries(
  Object.entries({ ...contracts.schemas, ...resumeContracts.schemas }).map(([id, schema]) => [
    id,
    ajv.compile(schema)
  ])
);
const additionalVersions = ["2026.9.34", "2026.9.35", "2026.10.6", "2026.10.7", "2026.10.8"];

async function replay(
  emitFrames,
  {
    resumed = false,
    result = { status: "ok" },
    terminal = "completed",
    version = "2026.9.4",
    schemaVersion
  } = {}
) {
  let listener;
  const checkpoints = [];
  const client = {
    async connect() {
      return {
        protocol: 4,
        server: { version },
        features: {
          methods: [
            "agents.list",
            "sessions.create",
            "sessions.describe",
            "sessions.patch",
            "sessions.messages.subscribe",
            "agent",
            "agent.wait",
            "sessions.abort"
          ],
          events: ["agent"]
        }
      };
    },
    onEvent(fn) {
      listener = fn;
      return () => {};
    },
    async close() {},
    async request(method, params, options = {}) {
      const schemaName = {
        "sessions.create": "SessionsCreateParamsSchema",
        "sessions.describe": "SessionsDescribeParamsSchema",
        "sessions.patch": "SessionsPatchParamsSchema",
        agent: "AgentParamsSchema"
      }[method];
      if (schemaName) {
        const fixtureVersion =
          schemaVersion ?? (additionalVersions.includes(version) ? "2026.10.5" : version);
        const source = ["sessions.describe", "sessions.patch"].includes(method)
          ? resumeContracts
          : contracts;
        const fixture = source.versions.find((entry) => entry.tag === fixtureVersion);
        const validate = fixture && validators[fixture.schemas[schemaName]];
        assert.ok(validate, `${version}: missing ${method} schema`);
        assert.ok(validate(params), `${version}: ${method} ${ajv.errorsText(validate.errors)}`);
      }
      if (method === "agents.list") return { agents: [{ id: "main" }] };
      if (method === "sessions.create") return { key: params.key };
      if (method === "sessions.describe") return { session: { key: params.key, agentId: "main" } };
      if (method === "sessions.patch")
        return {
          ok: true,
          key: params.key,
          entry: { permissionMode: "full", execSecurity: "full", execAsk: "off" }
        };
      if (method !== "agent") return { status: "ok" };
      options.onAccepted?.({ runId: params.idempotencyKey });
      let seq = 0;
      const agent = (stream, data) =>
        listener({
          event: "agent",
          payload: {
            runId: params.idempotencyKey,
            seq: ++seq,
            stream,
            data
          }
        });
      const message = (id, content, stopReason, overrides = {}) =>
        listener({
          event: "session.message",
          payload: {
            sessionKey: params.sessionKey,
            messageId: id,
            message: {
              role: "assistant",
              content,
              stopReason,
              timestamp: 10,
              __openclaw: { runId: params.idempotencyKey }
            },
            ...overrides
          }
        });
      await emitFrames({ agent, message, params, listener });
      return result;
    }
  };
  const value = randomUUID();
  const projector = new ImRunProjector("qa245");
  const events = [];
  for await (const event of createOpenClawAdapter({ clientFactory: () => client }).invoke({
    protocolVersion: 2,
    invocationId: "qa245",
    agentSessionId: "qa245",
    runId: "qa245",
    prompt: "fixture",
    modelInput: "fixture",
    controlInstructions: "",
    workdir: "",
    context: { schema: "octo.context-envelope/v3", items: [] },
    approvalMode: "full_access",
    agentSource: "preset",
    ...(resumed ? { providerSession: { sessionId: "agent:main:qa245", resumable: true } } : {}),
    agentConfig: {
      providerAgentId: "main",
      providerOptions: {
        OPENCLAW_GATEWAY_URL: "ws://localhost:1",
        OPENCLAW_GATEWAY_TOKEN: value,
        OPENCLAW_GATEWAY_DEVICE_ID: value,
        OPENCLAW_GATEWAY_PUBLIC_KEY: value,
        OPENCLAW_GATEWAY_PRIVATE_KEY: value
      }
    }
  })) {
    assertCanonicalEvent(event);
    events.push(event);
    projector.accept(event);
    checkpoints.push({ event, snapshot: projector.snapshot() });
  }
  const starts = events.filter((e) => e.type === "model_step.started");
  const finishes = events.filter((e) => e.type === "model_step.finished");
  assert.deepEqual(
    finishes.map((e) => e.payload.stepId).sort(),
    starts.map((e) => e.payload.stepId).sort()
  );
  assert.equal(
    events.filter((e) => e.type.startsWith("run.") && /completed|failed|cancelled/.test(e.type))
      .length,
    1
  );
  assert.equal(events.at(-1).type, `run.${terminal}`);
  return { events, starts, finishes, projector, checkpoints };
}

const thought = (text) => ({ type: "thinking", thinking: text });
const text = (value) => ({ type: "text", text: value });
const tool = (id) => ({
  type: "toolCall",
  id,
  name: "exec",
  arguments: { command: `printf ${id}` }
});

test("length continuations advance live card rounds without tool calls or duplicate final text", async () => {
  const r = await replay(
    ({ agent, message }) => {
      agent("lifecycle", { phase: "start" });
      agent("thinking", { text: "<html>native thinking is acceptable</html>" });
      message("m1", [thought("<html>native thinking is acceptable</html>")], "length");
      message("m1", [thought("duplicate")], "length");
      agent("thinking", { text: "second" });
      message("m2", [thought("second")], "length");
      agent("thinking", { text: "third" });
      agent("assistant", { itemId: "answer", text: "done" });
      message("m3", [thought("third"), text("done")], "stop");
      agent("lifecycle", { phase: "end" });
    },
    { result: { status: "ok", result: { payloads: [{ text: "done" }] } } }
  );
  assert.equal(r.starts.length, 3);
  assert.deepEqual(
    r.finishes.map((e) => e.payload.finishReason),
    ["length", "length", "stop"]
  );
  assert.equal(r.projector.snapshot().reasoningCount, 3);
  assert.equal(r.projector.finalReply.text, "done");
  assert.match(reasoningPhases(r.projector.snapshot()).at(-1).thought, /^第 3 轮/);
  assert.equal(r.events.filter((e) => e.payload.text === "duplicate").length, 0);
});

test("parallel tools and their late deltas/results stay in the originating step", async () => {
  const r = await replay(({ agent, message }) => {
    agent("thinking", { text: "first" });
    message("m1", [thought("first"), tool("a"), tool("b")], "toolUse");
    agent("tool", { phase: "start", toolCallId: "a", name: "exec", args: {} });
    agent("tool", { phase: "start", toolCallId: "b", name: "exec", args: {} });
    agent("thinking", { text: "second" });
    agent("tool", { phase: "update", toolCallId: "a", partialResult: "OUTPUT_ONLY" });
    agent("tool", { phase: "result", toolCallId: "b", result: "b" });
    agent("tool", { phase: "result", toolCallId: "a", result: "a" });
    agent("assistant", { text: "done" });
    message("m2", [text("done")], "stop");
  });
  assert.equal(r.starts.length, 2);
  const tools = r.events.filter((e) => e.type.startsWith("tool_call."));
  assert.equal(tools.filter((e) => e.type === "tool_call.create").length, 2);
  for (const event of tools) assert.equal(event.payload.stepId, r.starts[0].payload.stepId);
  const late = r.checkpoints.find((c) => c.event.type === "tool_call.delta");
  assert.equal(late.snapshot.modelStepCount, 2);
  assert.equal(
    late.snapshot.items.find((i) => i.id === "tool:a").stepId,
    r.starts[0].payload.stepId
  );
  assert.ok(
    !r.projector
      .snapshot()
      .items.some((i) => i.kind === "reasoning" && i.content.includes("OUTPUT_ONLY"))
  );
});

test("a delayed durable tool message reconciles with the already finished tool step", async () => {
  const r = await replay(({ agent, message }) => {
    agent("thinking", { text: "first" });
    agent("tool", { phase: "start", toolCallId: "a", name: "exec" });
    agent("tool", { phase: "result", toolCallId: "a", result: "ok" });
    agent("thinking", { text: "next" });
    message("late-first", [thought("first"), tool("a")], "toolUse");
    agent("assistant", { text: "done" });
    message("second", [text("done")], "stop");
  });
  assert.equal(r.starts.length, 2);
  assert.equal(r.projector.snapshot().toolCallCount, 1);
  assert.equal(r.finishes[0].payload.finishReason, "tool-calls");
});

test("resumed sessions reject foreign/runless completion events and accept nested native run identity", async () => {
  const r = await replay(
    ({ agent, message, params }) => {
      agent("thinking", { text: "current" });
      message("foreign", [tool("foreign")], "toolUse", { runId: "foreign" });
      message("other-session", [tool("foreign-2")], "toolUse", { sessionKey: "agent:main:other" });
      message("no-run", [tool("foreign-3")], "toolUse", {
        message: { role: "assistant", content: [tool("foreign-3")], stopReason: "toolUse" }
      });
      message("old-nested", [tool("foreign-4")], "toolUse", {
        message: {
          role: "assistant",
          content: [tool("foreign-4")],
          stopReason: "toolUse",
          __openclaw: { runId: "old" }
        }
      });
      message("current", [thought("current")], "length");
      agent("assistant", { text: "done" });
      message("current-final", [text("done")], "stop", { runId: params.idempotencyKey });
    },
    { resumed: true }
  );
  assert.equal(r.starts.length, 2);
  assert.equal(r.projector.snapshot().toolCallCount, 0);
});

test("tool-only fallback starts the next model round and ignores unknown item streams", async () => {
  const r = await replay(({ agent }) => {
    agent("lifecycle", { phase: "start" });
    agent("tool", { phase: "start", toolCallId: "a", name: "exec", args: {} });
    agent("tool", { phase: "result", toolCallId: "a", result: "ok" });
    agent("item", {
      phase: "update",
      kind: "command",
      progressText: "not reasoning",
      toolCallId: "a"
    });
    agent("assistant", { text: "done" });
    agent("lifecycle", { phase: "end" });
  });
  assert.equal(r.starts.length, 2);
  assert.equal(r.events.filter((e) => e.payload.text === "not reasoning").length, 0);
  assert.equal(r.projector.snapshot().reasoningCount, 0);
});

test("failed model messages finish their own step without terminating a continuing run", async () => {
  const r = await replay(({ agent, message }) => {
    agent("thinking", { text: "first" });
    message("failed", [], "error");
    agent("thinking", { text: "retry" });
    agent("assistant", { text: "done" });
    message("retry", [text("done")], "stop");
  });
  assert.equal(r.starts.length, 2);
  assert.equal(r.finishes[0].payload.status, "failed");
  assert.equal(r.finishes[1].payload.status, "completed");
});

test("tool argument and command output snapshots keep their type and original round", async () => {
  const r = await replay(({ agent, message }) => {
    agent("tool", { phase: "start", toolCallId: "a", name: "exec" });
    agent("tool", { phase: "update", toolCallId: "a", argsDelta: '{"command":' });
    message("first", [tool("a")], "toolUse");
    agent("command_output", { phase: "delta", toolCallId: "a", output: "TOOL_OUTPUT" });
    agent("thinking", { text: "second" });
    agent("command_output", {
      phase: "end",
      toolCallId: "a",
      output: "TOOL_OUTPUT_DONE",
      status: "completed",
      exitCode: 0,
      durationMs: 2
    });
    agent("assistant", { text: "done" });
    message("second", [text("done")], "stop");
    message("late-copy", [tool("a")], "toolUse");
  });
  assert.equal(r.starts.length, 2);
  const updates = r.events.filter((e) => e.type.startsWith("tool_call."));
  assert.ok(updates.every((e) => e.payload.stepId === r.starts[0].payload.stepId));
  assert.equal(updates.find((e) => e.payload.argsDelta)?.payload.outputSnapshot, undefined);
  assert.equal(updates.at(-1).payload.output, "TOOL_OUTPUT_DONE");
  assert.equal(updates.at(-1).payload.exitCode, 0);
  assert.ok(
    !r.projector
      .snapshot()
      .items.some((i) => i.kind === "reasoning" && i.content.includes("TOOL_OUTPUT"))
  );
});

test("durable text reconciles a partial answer without duplicating the final receipt", async () => {
  const r = await replay(
    ({ agent, message }) => {
      agent("assistant", { itemId: "answer", text: "partial" });
      message("final", [text("corrected answer")], "stop");
      agent("lifecycle", { phase: "end" });
    },
    { result: { status: "ok", result: { payloads: [{ text: "corrected answer" }] } } }
  );
  assert.equal(r.starts.length, 1);
  assert.equal(r.projector.finalReply.text, "corrected answer");
  assert.equal(
    new Set(r.events.filter((e) => e.payload.channel === "final").map((e) => e.payload.messageId))
      .size,
    1
  );
});

test("aggregate final receipt does not repeat answers across model rounds", async () => {
  const r = await replay(
    ({ agent, message }) => {
      agent("assistant", { itemId: "first", text: "first answer" });
      message("first", [text("first answer"), tool("a")], "toolUse");
      agent("tool", { phase: "result", toolCallId: "a", result: "ok" });
      agent("assistant", { itemId: "last", text: "last answer" });
      message("last", [text("last answer")], "stop");
    },
    {
      result: {
        status: "ok",
        result: {
          payloads: [{ text: "first answer", isCommentary: true }, { text: "last answer" }]
        }
      }
    }
  );
  assert.equal(r.starts.length, 2);
  assert.equal(r.projector.finalReply.text, "last answer");
});

for (const thinking of [true, false])
  test(`a final-only receipt belongs to the current round (thinking=${thinking})`, async () => {
    const r = await replay(
      ({ agent, message }) => {
        agent("assistant", { itemId: "first", text: "Inspecting" });
        message("first", [text("Inspecting"), tool("a")], "toolUse");
        agent("tool", { phase: "result", toolCallId: "a", result: "ok" });
        if (thinking) agent("thinking", { text: "next round" });
      },
      { result: { status: "ok", result: { payloads: [{ text: "Done" }] } } }
    );
    assert.equal(r.starts.length, 2);
    const answer = r.events.find(
      (e) =>
        e.type === "message.update" && e.payload.channel === "final" && e.payload.text === "Done"
    );
    assert.equal(answer.payload.stepId, r.starts[1].payload.stepId);
    assert.notEqual(answer.payload.messageId, "openclaw:first");
    assert.equal(r.projector.finalReply.text, "Done");
    assert.ok(
      r.events.some((e) => e.payload.channel === "commentary" && e.payload.text === "Inspecting")
    );
  });

for (const corrected of [false, true, "first", "merged"])
  test(`durable multi-block text reconciles streamed items (corrected=${corrected})`, async () => {
    const first =
      corrected === "first" || corrected === "merged" ? "first corrected" : "first block";
    const second = corrected === true ? "second corrected" : "second block";
    const r = await replay(({ agent, message }) => {
      agent("assistant", { itemId: "first", text: "first block" });
      agent("assistant", { itemId: "second", text: "second block" });
      message(
        "both",
        corrected === "merged" ? [text(`${first}\n${second}`)] : [text(first), text(second)],
        "stop"
      );
    });
    assert.equal(r.starts.length, 1);
    assert.equal(r.projector.finalReply.text, `${first}\n${second}`);
  });

test("sanitized MC boundary sequence preserves length continuations, failed attempt and tool batch", async () => {
  // 来自 MC 样例的已核对边界；正文、参数、工具 ID 均为本地替代值，不宣称完整原始 WS 抓包。
  const r = await replay(({ agent, message }) => {
    agent("thinking", { text: "<html>first native thinking</html>" });
    message("mc-1", [thought("first")], "length");
    agent("thinking", { text: "<html>second native thinking</html>" });
    message("mc-2", [thought("second")], "length");
    message("mc-error", [], "error");
    agent("thinking", { text: "tools" });
    message("mc-tools", [tool("read"), tool("exec")], "toolUse");
    agent("tool", { phase: "result", toolCallId: "read", result: "read-result" });
    agent("tool", { phase: "result", toolCallId: "exec", result: "exec-result" });
    agent("assistant", { text: "synthetic completion" });
    message("mc-final", [text("synthetic completion")], "stop");
  });
  assert.equal(r.starts.length, 5);
  assert.deepEqual(
    r.finishes.map((e) => e.payload.finishReason),
    ["length", "length", "error", "tool-calls", "stop"]
  );
  const tools = r.events.filter((e) => e.type.startsWith("tool_call."));
  assert.ok(tools.every((e) => e.payload.stepId === r.starts[3].payload.stepId));
  assert.match(reasoningPhases(r.projector.snapshot()).at(-1).thought, /^第 5 轮/);
});

for (const terminal of ["failed", "cancelled"])
  test(`multi-step ${terminal} final receipt pairs only the open step`, async () => {
    const r = await replay(
      ({ agent, message }) => {
        agent("thinking", { text: "first" });
        message("first", [tool("a")], "toolUse");
        agent("tool", { phase: "result", toolCallId: "a", result: "ok" });
        agent("thinking", { text: "second" });
      },
      {
        terminal,
        result: {
          status: "error",
          result: { meta: { ...(terminal === "cancelled" ? { aborted: true } : {}) } }
        }
      }
    );
    assert.equal(r.starts.length, 2);
    assert.deepEqual(
      r.finishes.map((e) => e.payload.status),
      ["completed", terminal]
    );
  });

test("IM final selects only native final payload and emits it exactly once", async () => {
  const r = await replay(
    ({ agent, message }) => {
      agent("assistant", { itemId: "process", text: "PROCESS_ONLY" });
      message("process", [text("PROCESS_ONLY"), tool("a")], "toolUse");
      agent("tool", { phase: "result", toolCallId: "a", result: "TOOL_ONLY" });
      agent("thinking", { text: "THINKING_ONLY" });
      agent("assistant", { itemId: "answer", text: "Done" });
      message("answer", [text("Done")], "stop");
    },
    {
      result: {
        status: "ok",
        result: {
          payloads: [
            { text: "THINKING_ONLY", isReasoning: true },
            { text: "PROCESS_ONLY", isCommentary: true },
            { text: "ERROR_ONLY", isError: true },
            { text: "Done" }
          ]
        }
      }
    }
  );
  assert.equal(r.projector.finalReply.text, "Done");
  assert.equal(
    r.events.filter(
      (e) => e.type.startsWith("message.") && e.payload.channel === "final" && e.payload.text
    ).length,
    1
  );
});

test("status-only receipt selects last completed step, excluding earlier process text", async () => {
  const r = await replay(({ agent, message }) => {
    agent("assistant", { itemId: "process", text: "PROCESS_ONLY" });
    message("process", [text("PROCESS_ONLY"), tool("a")], "toolUse");
    agent("tool", { phase: "result", toolCallId: "a", result: "ok" });
    agent("assistant", { itemId: "answer", text: "Done" });
    message("answer", [text("Done")], "stop");
  });
  assert.equal(r.projector.finalReply.text, "Done");
});

for (const phased of ["signature", "message"])
  test(`durable final excludes explicit commentary phase (${phased})`, async () => {
    const content =
      phased === "signature"
        ? [
            {
              ...text("PROCESS_ONLY"),
              textSignature: JSON.stringify({ v: 1, id: "process", phase: "commentary" })
            },
            {
              ...text("Done"),
              textSignature: JSON.stringify({ v: 1, id: "answer", phase: "final_answer" })
            }
          ]
        : [text("PROCESS_ONLY")];
    const r = await replay(({ message }) => {
      message("answer", content, "stop", {
        message: {
          role: "assistant",
          content,
          stopReason: "stop",
          ...(phased === "message" ? { phase: "commentary" } : {})
        }
      });
    });
    assert.equal(
      r.projector.finalReply.text,
      phased === "signature" ? "Done" : "执行已结束，未返回文本。"
    );
  });

test("native metadata supplies final text when non-answer payloads are excluded", async () => {
  const r = await replay(() => {}, {
    result: {
      status: "ok",
      result: {
        payloads: [{ text: "PROCESS_ONLY", isCommentary: true }],
        meta: { finalAssistantVisibleText: "Done" }
      }
    }
  });
  assert.equal(r.projector.finalReply.text, "Done");
});

for (const final of [false, true])
  test(`stream phase survives status-only final selection (final=${final})`, async () => {
    const r = await replay(({ agent }) => {
      agent("assistant", { itemId: "process", phase: "commentary", text: "PROCESS_ONLY" });
      if (final) agent("assistant", { itemId: "answer", phase: "final_answer", text: "Done" });
    });
    assert.equal(r.projector.finalReply.text, final ? "Done" : "执行已结束，未返回文本。");
  });

for (const finalText of ["Done", ""])
  test(`7.1 final metadata overrides payloads with lost reasoning flags (${!!finalText})`, async () => {
    const r = await replay(() => {}, {
      result: {
        status: "ok",
        result: {
          payloads: [{ text: "THINKING_WITH_LOST_FLAG" }, { text: "Done" }],
          meta: { finalAssistantVisibleText: finalText }
        }
      }
    });
    assert.equal(r.projector.finalReply.text, finalText || "执行已结束，未返回文本。");
  });

// 手动事件形状回放与固定请求字段验证，不冒充真实 Gateway。
for (const [version, family, schemaVersion] of [
  ["2026.6.10", "legacy", "2026.7.1"],
  ["2026.7.35", "legacy", "2026.7.35"],
  ["2026.8.1", "session-permissions", "2026.8.1"],
  ["2026.10.99", "session-permissions", "2026.10.5"],
  ["2027.1.1", "session-permissions", "2026.10.5"],
  ["LobsterAI-1.0.0", "session-permissions", "2026.10.5"],
  ["v1.0.0", "session-permissions", "2026.10.5"],
  ["2026.10.9-beta.1", "session-permissions", "2026.10.5"],
  ["dev", "session-permissions", "2026.10.5"],
  [undefined, "session-permissions", "2026.10.5"]
])
  test(`capability stage ${version ?? "missing version"} uses ${family} without a release gate`, async () => {
    const handshake = {
      protocol: 4,
      server: { version },
      features: {
        methods: [
          "agents.list",
          "sessions.create",
          "sessions.patch",
          "sessions.messages.subscribe",
          "agent",
          "agent.wait",
          "sessions.abort"
        ],
        events: ["agent"]
      }
    };
    assert.equal(resolveGatewayContract(handshake).family, family);
    for (const resumed of [false, true]) {
      const r = await replay(({ agent }) => agent("assistant", { text: "Done" }), {
        version: version ?? null,
        schemaVersion,
        resumed,
        result: { status: "ok", result: { payloads: [{ text: "Done" }] } }
      });
      assert.equal(r.projector.finalReply.text, "Done");
      assert.equal(r.events.filter((event) => event.payload.channel === "final").length, 1);
    }
  });
const versions = contracts.versions
  .map((entry) => entry.tag)
  .filter((version) => version !== "2026.6.11");
for (const version of additionalVersions)
  test(`${version}: resumed request uses the fixed session-permissions contract`, async () => {
    const r = await replay(({ agent }) => agent("assistant", { text: "Done" }), {
      version,
      resumed: true,
      result: { status: "ok", result: { payloads: [{ text: "Done" }] } }
    });
    assert.equal(r.projector.finalReply.text, "Done");
  });
test("7.1 toolUse completion without tool blocks owns subsequent parallel tool starts", async () => {
  const r = await replay(
    ({ agent, message }) => {
      agent("assistant", { text: "PROCESS_ONLY", phase: "commentary" });
      message("process", [text("PROCESS_ONLY")], "toolUse");
      for (const id of ["a", "b"]) {
        agent("tool", { phase: "start", toolCallId: id, name: "exec", args: {} });
        agent("tool", { phase: "result", toolCallId: id, result: "ok" });
      }
      agent("assistant", { text: "Done" });
    },
    { version: "2026.7.1", result: { status: "ok", result: { payloads: [{ text: "Done" }] } } }
  );
  assert.equal(r.starts.length, 2);
  assert.ok(
    r.events
      .filter((event) => event.type.startsWith("tool_call."))
      .every((event) => event.payload.stepId === r.starts[0].payload.stepId)
  );
  assert.equal(r.projector.finalReply.text, "Done");
});
test("assistant flush after durable stop does not create an extra model round", async () => {
  const r = await replay(
    ({ agent, message }) => {
      agent("assistant", { text: "Done" });
      message("done", [text("Done")], "stop");
      agent("assistant", { text: "Done" });
    },
    { result: { status: "ok", result: { payloads: [{ text: "Done" }] } } }
  );
  assert.equal(r.starts.length, 1);
  assert.equal(r.projector.finalReply.text, "Done");
});
for (const version of [...versions, ...additionalVersions])
  for (const phased of [false, true])
    test(`version ${version}: ${phased ? "optional phase" : "legacy unphased"} preserves steps and exact final`, async () => {
      const r = await replay(
        ({ agent, message }) => {
          agent("thinking", { text: "THINKING_ONLY" });
          message("length", [thought("THINKING_ONLY")], "length", {
            message: {
              role: "assistant",
              content: [thought("THINKING_ONLY")],
              stopReason: "length",
              __openclaw: { id: "length", seq: 1 }
            }
          });
          agent("assistant", {
            itemId: "process",
            text: "PROCESS_ONLY",
            ...(phased ? { phase: "commentary" } : {})
          });
          agent("tool", { phase: "start", toolCallId: "a", name: "exec", args: {} });
          agent("tool", { phase: "result", toolCallId: "a", result: "TOOL_ONLY" });
          agent("assistant", {
            itemId: "answer",
            text: "Done",
            ...(phased ? { phase: "final_answer" } : {})
          });
        },
        {
          version,
          result: {
            status: "ok",
            result: {
              payloads: [{ text: "THINKING_WITH_LOST_FLAG" }, { text: "Done" }],
              meta: { finalAssistantVisibleText: "Done" }
            }
          }
        }
      );
      assert.equal(r.starts.length, 3);
      assert.equal(r.projector.finalReply.text, "Done");
      const tools = r.events.filter((event) => event.type.startsWith("tool_call."));
      assert.ok(tools.length > 0);
      assert.ok(tools.every((event) => event.payload.stepId === r.starts[1].payload.stepId));
      assert.equal(
        r.events.filter((event) => event.payload.channel === "final" && event.payload.text).length,
        1
      );
    });
