import { withAgentEnvItems } from "../../packages/octo-runtime-adapter-sdk/dist/index.js";
// 显式本地专项：公开输入准备后执行真实 Adapter 分支，不进入默认测试或 CI glob。
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";
import { prepareInvokeInput } from "../../packages/octo-runtime-executor-core/dist/index.js";
import { createAcpAdapter } from "../../packages/octo-runtime-adapter-acp/dist/index.js";
import { createGrokBuildAdapter } from "../../packages/octo-runtime-adapter-grok-build/dist/index.js";
import { GrokBuildRpcError } from "../../packages/octo-runtime-adapter-grok-build/dist/client.js";
import { createScopedCodexAdapter } from "../../test-support/scoped-codex-adapter.mjs";
import { visualInputImages } from "../../test-support/multimodal-images.mjs";
const [image, historyImage] = visualInputImages();
const ordinary = [
  { type: "text", text: "Caller startup prompt" },
  { type: "text", text: "Business material" },
  { type: "text", text: "Current request" }
];
const mixed = [ordinary[0], image, ordinary[1], ordinary[2]];
const explicitPrimary =
  "Explicit caller prompt\nExplicit business material\nExplicit current request";
const explicitRecovery = "Recovery caller prompt\nRecovery history\nCurrent request";
function publicInput(type, inputs, content = {}) {
  return {
    inputs: structuredClone(inputs),
    agentEnv: withAgentEnvItems(
      {
        schema: "octo.context-envelope/v3",
        items: [{ namespace: "octo.execution", name: "adapter", payload: { type } }]
      },
      [{ namespace: "octo.execution", name: "workspace", payload: { path: process.cwd() } }]
    ),
    ...content
  };
}
function acpFixture(type, missing) {
  let nextId = 1;
  const frames = [];
  const client = {
    initialize: async () => ({
      protocolVersion: 1,
      _meta: { agentVersion: "1.0.67" },
      authMethods: [{ id: "cached_token" }],
      agentCapabilities: { promptCapabilities: { image: true } }
    }),
    reserveRequestId: () => nextId++,
    request: async (method, params) => {
      frames.push({ method, params });
      if (method === "session/load" && missing) {
        if (type === "grok-build")
          throw new GrokBuildRpcError({
            code: -32603,
            message: "session not found",
            data: { code: "FS_NOT_FOUND" }
          });
        return null;
      }
      return { sessionId: "fixture-session" };
    },
    async *prompt(_session, _input, options) {
      frames.push({ method: "session/prompt", params: options.params });
      yield { sessionUpdate: "agent_message_chunk", content: { text: "done" } };
      yield { type: "prompt_result", stopReason: "end_turn" };
    },
    cancel() {},
    close: async () => {}
  };
  const adapter =
    type === "grok-build"
      ? createGrokBuildAdapter({
          command: process.execPath,
          env: process.env,
          acpClientFactory: () => client
        })
      : createAcpAdapter(
          { type, provider: type, command: "fixture" },
          { acpClientFactory: () => client }
        );
  return { adapter, frames };
}
function codexFixture(missing) {
  const child = new EventEmitter();
  const frames = [];
  const send = (message) => child.stdout.write(`${JSON.stringify(message)}\n`);
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.signalCode = null;
  child.stdin = new Writable({
    write(chunk, _encoding, callback) {
      const frame = JSON.parse(chunk.toString());
      frames.push(frame);
      if (["initialize", "thread/name/set"].includes(frame.method))
        send({ id: frame.id, result: {} });
      if (frame.method === "thread/unsubscribe")
        send({ id: frame.id, result: { status: "unsubscribed" } });
      if (["thread/start", "thread/resume"].includes(frame.method))
        send(
          frame.method === "thread/resume" && missing
            ? { id: frame.id, error: { code: -32600, message: "thread not found" } }
            : { id: frame.id, result: { thread: { id: "fixture-thread" } } }
        );
      if (frame.method === "turn/start") {
        send({ id: frame.id, result: { turn: { id: "fixture-turn" } } });
        setImmediate(() => {
          send({
            method: "item/agentMessage/delta",
            params: {
              threadId: "fixture-thread",
              turnId: "fixture-turn",
              itemId: "answer",
              delta: "done"
            }
          });
          send({
            method: "turn/completed",
            params: {
              threadId: "fixture-thread",
              turnId: "fixture-turn",
              turn: { id: "fixture-turn", status: "completed" }
            }
          });
        });
      }
      callback();
    },
    final(callback) {
      child.exitCode = 0;
      child.stdout.end();
      child.stderr.end();
      child.emit("close", 0);
      callback();
    }
  });
  child.kill = () => {
    child.exitCode = 0;
    child.emit("close", 0);
    return true;
  };
  return {
    adapter: createScopedCodexAdapter({ command: process.execPath, spawnFn: () => child }),
    frames
  };
}
function nativeParts(type, parts) {
  return parts.map((part) =>
    part.type === "image"
      ? type === "codex"
        ? { type: "image", url: `data:${part.mimeType};base64,${part.data}` }
        : { type: "image", mimeType: part.mimeType, data: part.data }
      : type === "codex"
        ? { type: "text", text: part.text, text_elements: [] }
        : part
  );
}
async function assertSubmitted(type, inputs, content, expected, { missing = false } = {}) {
  const fixture = type === "codex" ? codexFixture(missing) : acpFixture(type, missing);
  const value = publicInput(type, inputs, content);
  const original = structuredClone(value);
  const { request } = prepareInvokeInput(value);
  const events = await Array.fromAsync(fixture.adapter.invoke(request));
  assert.equal(events.at(-1).type, "run.completed");
  const promptMethod = type === "codex" ? "turn/start" : "session/prompt";
  const prompts = fixture.frames.filter((frame) => frame.method === promptMethod);
  assert.equal(prompts.length, 1, "one invocation submits exactly one ordinary input");
  assert.deepEqual(
    type === "codex" ? prompts[0].params.input : prompts[0].params.prompt,
    nativeParts(type, expected)
  );
  const loadMethod = type === "codex" ? "thread/resume" : "session/load";
  const freshMethod = type === "codex" ? "thread/start" : "session/new";
  assert.equal(
    fixture.frames.some((frame) => frame.method === loadMethod),
    !!content.providerSession
  );
  assert.equal(
    fixture.frames.some((frame) => frame.method === freshMethod),
    missing || !content.providerSession
  );
  for (const frame of fixture.frames.filter((frame) =>
    [loadMethod, freshMethod].includes(frame.method)
  )) {
    assert.equal(Object.hasOwn(frame.params, "developerInstructions"), false);
    assert.equal(Object.hasOwn(frame.params._meta ?? {}, "rules"), false);
  }
  if (missing) {
    const session = events.find((event) => event.type === "session.update").payload.providerSession;
    assert.equal(session.resumeOutcome, "fresh_fallback");
    assert.equal(
      session.contextInputVariant,
      content.freshFallbackModelInputParts || content.freshFallbackModelInput
        ? "recovery"
        : "primary"
    );
  }
  assert.deepEqual(
    value,
    original,
    "input preparation and Adapter execution do not modify caller input"
  );
}
for (const type of ["fixture", "grok-build", "codex"]) {
  for (const resumed of [false, true]) {
    const continuation = resumed ? { providerSession: { sessionId: "previous" } } : {};
    test(`${type}: ordinary ordered text parts stay exact on ${resumed ? "resume" : "initial"}`, () =>
      assertSubmitted(type, ordinary, continuation, ordinary));
    test(`${type}: explicit modelInput selects one text carrier on ${resumed ? "resume" : "initial"}`, () =>
      assertSubmitted(type, ordinary, { ...continuation, modelInput: explicitPrimary }, [
        { type: "text", text: explicitPrimary }
      ]));
    test(`${type}: mixed input stays ordered despite modelInput on ${resumed ? "resume" : "initial"}`, () =>
      assertSubmitted(type, mixed, { ...continuation, modelInput: explicitPrimary }, mixed));
  }
  test(`${type}: explicit modelInput selects its carrier even when equal to the text summary`, () => {
    const summary = ordinary.map((part) => part.text).join("\n\n");
    return assertSubmitted(type, ordinary, { modelInput: summary }, [
      { type: "text", text: summary }
    ]);
  });
  test(`${type}: a missing Provider session selects explicit recovery text`, () =>
    assertSubmitted(
      type,
      ordinary,
      {
        providerSession: { sessionId: "missing" },
        modelInput: explicitPrimary,
        freshFallbackModelInput: explicitRecovery
      },
      [{ type: "text", text: explicitRecovery }],
      { missing: true }
    ));
  test(`${type}: a missing Provider session retains primary parts without explicit recovery`, () =>
    assertSubmitted(
      type,
      ordinary,
      {
        providerSession: { sessionId: "missing" }
      },
      ordinary,
      { missing: true }
    ));
  test(`${type}: explicit recovery parts outrank recovery text without duplicate prompts`, () => {
    const recovery = [{ type: "text", text: "Recovery caller prompt" }, ...ordinary];
    return assertSubmitted(
      type,
      ordinary,
      {
        providerSession: { sessionId: "missing" },
        freshFallbackModelInput: explicitRecovery,
        freshFallbackModelInputParts: recovery
      },
      recovery,
      { missing: true }
    );
  });
  test(`${type}: explicit mixed recovery parts preserve history and current image order`, () => {
    const recovery = [{ type: "text", text: "Recovery history" }, historyImage, ...mixed];
    return assertSubmitted(
      type,
      mixed,
      {
        providerSession: { sessionId: "missing" },
        freshFallbackModelInput: explicitRecovery,
        freshFallbackModelInputParts: recovery
      },
      recovery,
      { missing: true }
    );
  });
}
test("public preparation rejects text-only recovery that would discard current images", () => {
  assert.throws(
    () =>
      prepareInvokeInput(
        publicInput("fixture", mixed, {
          providerSession: { sessionId: "missing" },
          freshFallbackModelInput: explicitRecovery
        })
      ),
    /IMAGE_RECOVERY_INPUT_REQUIRED/
  );
});
test("public preparation rejects recovery parts missing the current image", () => {
  assert.throws(
    () =>
      prepareInvokeInput(
        publicInput("fixture", mixed, {
          providerSession: { sessionId: "missing" },
          freshFallbackModelInputParts: [ordinary[0], historyImage]
        })
      ),
    /IMAGE_RECOVERY_INPUT_REQUIRED/
  );
});
