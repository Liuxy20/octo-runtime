import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { InvokeInput, invocationInput } from "@mininglamp-oss/octo-runtime-protocol";
import { prepareInvokeInput } from "@mininglamp-oss/octo-runtime-executor-core";
import { AgentExecutor } from "@mininglamp-oss/octo-runtime-executor-core";
import { invokeRequest } from "./runtime-fixture.js";

const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const image = {
  id: "image-1",
  type: "image",
  mimeType: "image/png",
  data: bytes.toString("base64"),
  byteSize: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex")
};

test("all prepared fields, primary/recovery images and provider extensions survive JSON reorganization", () => {
  const context = {
    schema: "octo.context-envelope/v3",
    items: [
      { namespace: "extra.test", name: "selection", payload: { text: "business" } },
      { namespace: "octo.execution", name: "adapter", payload: { type: "fixture" } },
      {
        namespace: "octo.execution",
        name: "workspace",
        payload: { mode: "fixed", path: process.cwd() }
      },
      { namespace: "octo.security", name: "approval_policy", payload: { mode: "ask" } },
      { namespace: "octo.execution", name: "limits", payload: { run_timeout_ms: 120000 } }
    ]
  };
  const request = invokeRequest({
    sessionName: "arbitrary-caller-name",
    context,
    sessionGeneration: 7,
    providerEpoch: 3,
    continuityMode: "continue",
    modelInputParts: [{ type: "text", text: "actual input" }, image],
    freshFallbackModelInput: "caller-frozen recovery",
    freshFallbackModelInputParts: [{ type: "text", text: "recovery" }, image],
    freshFallbackImagesUnavailable: false,
    providerSession: {
      sessionId: "opaque",
      resumable: true,
      resumeOutcome: "resumed",
      resumeFallback: "reason",
      contextInputVariant: "primary",
      custom: { providerToken: "fixture-only" }
    },
    agentConfig: {
      workdir: process.cwd(),
      sandbox: "workspace-write",
      timeoutSeconds: 120,
      providerOptions: { custom: [1, { mode: "exact" }] },
      arbitraryProviderField: { preserve: true }
    },
    runtimeLimits: { firstFrameTimeoutMs: 10000, runTimeoutMs: 120000, enforcement: "enforce" }
  });
  const input = JSON.parse(JSON.stringify(invocationInput(request, "canonical")));
  const before = structuredClone(input);
  assert.equal(InvokeInput.check(input), input);
  assert.deepEqual(prepareInvokeInput(input).request, request);
  assert.deepEqual(input, before);
  assert.equal(input.inputs[1].data, image.data);
});

test("removed channel snapshot metadata is ignored and never forwarded to execution", () => {
  for (const contextSnapshot of [{ snapshot_id: "old-reference" }, "unrecognized-extension"]) {
    const input = {
      inputs: [{ type: "text", text: "this turn only" }],
      contexts: { schema: "octo.context-envelope/v3", items: [] },
      contextSnapshot
    };
    const before = structuredClone(input);
    assert.doesNotThrow(() => InvokeInput.check(input));
    const prepared = prepareInvokeInput(input);
    assert.equal(Object.hasOwn(prepared.request, "contextSnapshot"), false);
    assert.equal(prepared.request.modelInput, "this turn only");
    assert.deepEqual(prepared.request.context, input.contexts);
    assert.deepEqual(input, before);
  }
});

test("session names are optional caller data with a Core-only UUID default", () => {
  const input = {
    inputs: [{ type: "text", text: "hello" }],
    contexts: { schema: "octo.context-envelope/v3", items: [] },
    providerSession: { sessionId: "opaque-provider-session" }
  };
  const first = prepareInvokeInput(input).request;
  const second = prepareInvokeInput(input).request;
  assert.match(first.sessionName, /^[0-9a-f-]{36}$/);
  assert.notEqual(first.sessionName, second.sessionName);
  assert.equal(input.sessionName, undefined);
  for (const sessionName of ["wecom:anything_1", "WebUI-ABC-123", " 名称 ", "😀".repeat(256)]) {
    const prepared = prepareInvokeInput({ ...input, sessionName }).request;
    assert.equal(prepared.sessionName, sessionName);
    assert.equal(prepared.providerSession.sessionId, input.providerSession.sessionId);
    assert.equal(prepared.continuityMode, "continue");
    assert.equal(prepared.modelInput, "hello");
  }
  for (const sessionName of [null, 1, "", "   ", "x\n", "x\x7f", "name\u0085", "a".repeat(257)])
    assert.throws(() => InvokeInput.check({ ...input, sessionName }), /sessionName/);
});

test("every ingress can use the same plain JSON and exact model parts reach the adapter", async () => {
  let received;
  const host = new AgentExecutor();
  host.register({
    metadata: {
      type: "fixture",
      agentSources: ["provisioned"],
      protocolSupport: { protocol: "fixture.canonical", modes: ["canonical"], nativeMethods: [] }
    },
    async respondInteraction() {},
    async *invoke(request) {
      received = request;
      yield { protocolVersion: 2, type: "run.completed", payload: {} };
    }
  });
  const input = {
    inputs: [{ type: "text", text: "hello" }],
    contexts: {
      schema: "octo.context-envelope/v3",
      items: [{ namespace: "octo.execution", name: "adapter", payload: { type: "fixture" } }]
    },
    protocol_mode: "canonical"
  };
  const events = [];
  for await (const event of host.invoke(input)) events.push(event);
  assert.deepEqual(received.modelInputParts, input.inputs);
  assert.ok(events.some((event) => event.type === "run.completed"));
  await host.shutdown();
});

test("recognized invalid fields reject and optional unknown extensions do not change the model input", () => {
  const input = {
    inputs: [{ type: "text", text: "hello" }],
    contexts: { schema: "octo.context-envelope/v3", items: [] }
  };
  for (const field of [
    { sessionGeneration: -1 },
    { protocol_mode: "other" },
    { agentConfig: { timeoutSeconds: "bad" } },
    { providerSession: { sessionId: "p", resumable: "yes" } },
    { signal: {} },
    { protocolMode: "canonical" }
  ])
    assert.throws(() => InvokeInput.check({ ...input, ...field }));
  assert.equal(
    prepareInvokeInput({ ...input, optionalFutureExtension: { value: true } }).request.modelInput,
    "hello"
  );
});
