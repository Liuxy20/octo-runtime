import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as protocol from "../../packages/octo-runtime-protocol/dist/index.js";
import {
  assertAdapterAgentEnv,
  assertAdapterWorkdir,
  defaultAgentEnv,
  invocationModel,
  invocationEffort,
  withAgentEnvItems,
  withAgentEnvDefaults
} from "../../packages/octo-runtime-adapter-sdk/dist/index.js";
import {
  buildClaudeCommand,
  createClaudeCodeAdapter
} from "../../packages/octo-runtime-adapter-claude-code/dist/index.js";
import { createScopedCodexAdapter } from "../../test-support/scoped-codex-adapter.mjs";
import { codexCollaborationMode } from "../../packages/octo-runtime-adapter-codex/dist/agent-env.js";
import { grokModeId } from "../../packages/octo-runtime-adapter-grok-build/dist/agent-env.js";
import {
  createAcpAdapter,
  acpModeId,
  acpModeSelectionRequest
} from "../../packages/octo-runtime-adapter-acp/dist/index.js";
import { createOpenCodeAdapter } from "../../packages/octo-runtime-adapter-opencode/dist/index.js";
import { invokeRequest, contextEnvelope } from "../runtime-fixture.js";

const item = (namespace, name, payload) => ({ namespace, name, payload });
const request = (...items) => invokeRequest({ agentEnv: contextEnvelope(items) });
const model = (payload) => item("octo.execution", "model", payload);
const options = (type, payload) => item(`adapter.${type}`, "options", payload);

test("removed definitions and opaque private names do not enter public protocol", async () => {
  const schema = JSON.parse(
    await readFile(
      new URL("../../packages/octo-runtime-protocol/schema/protocol.schema.json", import.meta.url)
    )
  );
  for (const name of [
    "AgentSource",
    "ContextActmodePayload",
    "ExecutionEvidence",
    "ContextInlineEntry",
    "ContextInlinePayload",
    "ContextReferenceEntry",
    "ContextReferencesPayload",
    "ContextMcpLocator",
    "PublicObjectMaterial",
    "ContextPreparationReceipt",
    "RunContextProjection",
    "ContextRuntimeSelectionPayload",
    "ResolvedRuntimeSelection"
  ])
    assert.equal(schema.definitions[name], undefined, name);
  for (const name of [
    "contextActmode",
    "assertExecutionEvidence",
    "assertAgentSource",
    "RUNTIME_SELECTION_SCHEMA",
    "assertResolvedRuntimeSelection"
  ])
    assert.equal(protocol[name], undefined, name);
  assert.deepEqual(Object.keys(schema.definitions.ContextItem.properties).sort(), [
    "name",
    "namespace",
    "payload"
  ]);
  assert.ok(!JSON.stringify(schema).includes('"adapter.codex"'));
  assert.equal(Object.hasOwn(protocol.RUNTIME_RUN_CONTRACT, "routing_schema"), false);
  const previous = contextEnvelope([
    item("octo.runtime", "selection", { offline_behavior: "wait", failover: "candidates" })
  ]);
  const current = contextEnvelope([item("octo.runtime", "selection", { opaque: true })]);
  assert.deepEqual(protocol.mergeContext(previous, current), current);

  assert.ok(
    !protocol.CONTEXT_TYPE_CATALOG.some(
      (i) =>
        i.namespace.startsWith("adapter.") ||
        i.namespace === "octo.content" ||
        i.namespace === "octo.runtime" ||
        ["agent", "actmode"].includes(i.name)
    )
  );
  for (const namespace of ["product.custom", "adapter.codex", "another.owner"])
    assert.doesNotThrow(() =>
      assertAdapterAgentEnv(
        request(
          item(namespace, "arbitrary", {
            guidance: "business",
            data_format: "business",
            history: [1, 2]
          })
        )
      )
    );
  for (const field of ["guidance", "data_format"])
    assert.throws(
      () =>
        protocol.assertContextEnvelope(
          contextEnvelope([{ ...options("custom", {}), [field]: "text" }])
        ),
      /CONTEXT_SCHEMA_INVALID/
    );
  assert.throws(() =>
    protocol.assertCanonicalEvent({ protocolVersion: 2, type: "execution.update", payload: {} })
  );
  assert.throws(() =>
    protocol.assertHostControl({ type: "evidence", name: "execution", payload: {} })
  );
  assert.doesNotThrow(() =>
    protocol.assertHostControl({ type: "evidence", name: "session", payload: {} })
  );
  assert.doesNotThrow(() =>
    protocol.assertCanonicalEvent({
      protocolVersion: 2,
      type: "plan.updated",
      payload: { planId: "p", revision: 1, explanation: null, steps: [] }
    })
  );
});

test("source metadata and preset do not grant a workdir exemption", async () => {
  assert.ok(!defaultAgentEnv("custom").items.some((i) => i.name === "agent"));
  const req = {
    ...request(item("octo.execution", "agent", { source: "preset" })),
    agentEnv: contextEnvelope([item("octo.execution", "agent", { source: "preset" })])
  };
  await assert.rejects(assertAdapterWorkdir(req), { code: "WORKDIR_REQUIRED" });
  await assertAdapterWorkdir(req, false);
});

test("model omission and explicit configuration composition have separate ownership", () => {
  for (const payload of [
    { selection: { id: "model-a" } },
    { reasoning: { effort: "high" } },
    { selection: { id: "model-a" }, reasoning: { effort: "high" } }
  ]) {
    const req = request(model(payload));
    const snapshot = structuredClone(req.agentEnv);
    assertAdapterAgentEnv(req);
    assert.equal(invocationModel(req), payload.selection?.id);
    assert.equal(invocationEffort(req), payload.reasoning?.effort);
    assert.deepEqual(req.agentEnv, snapshot);
  }
  const omitted = request();
  assertAdapterAgentEnv(omitted);
  assert.equal(invocationModel(omitted), undefined);
  assert.equal(invocationEffort(omitted), undefined);
  for (const payload of [
    {},
    { selection: {} },
    { reasoning: {} },
    { selection: { use_provider_default: true } },
    { reasoning: { use_provider_default: true } },
    { selection: { id: "x", use_provider_default: false } }
  ])
    assert.throws(() => assertAdapterAgentEnv(request(model(payload))), /CONTEXT_SCHEMA_INVALID/);
  const empty = contextEnvelope();
  const defaults = contextEnvelope([model({ selection: { id: "default-model" } })]);
  assert.deepEqual(withAgentEnvDefaults(empty, defaults), defaults);
  assert.deepEqual(
    protocol.resolveContextConfiguration({ defaults, mandatory: empty }, empty),
    defaults
  );
  // 应用清除默认覆盖后再组合；执行层不替应用推测清除意图。
  assert.deepEqual(
    withAgentEnvDefaults(empty, contextEnvelope(defaults.items.filter((i) => i.name !== "model"))),
    empty
  );
  const before = contextEnvelope([
    item("octo.content", "references", { entries: [{ resource_ref: "a" }, { resource_ref: "b" }] })
  ]);
  const after = contextEnvelope([
    item("octo.content", "references", { entries: [{ resource_ref: "c" }] })
  ]);
  assert.deepEqual(protocol.mergeContext(before, after), after);
});

test("package-local mode validation does not interpret legacy or foreign items", async () => {
  const legacy = request(item("octo.execution", "actmode", { mode: "plan" }));
  for (const read of [codexCollaborationMode, grokModeId, (req) => acpModeId(req, "fixture")])
    assert.equal(read(legacy), undefined);
  assert.equal(
    codexCollaborationMode(request(options("another", { collaborationMode: "plan" }))),
    undefined
  );
  for (const value of [null, "", false, {}, "other"]) {
    assert.throws(
      () => codexCollaborationMode(request(options("codex", { collaborationMode: value }))),
      /ADAPTER_OPTION_INVALID/
    );
    assert.throws(
      () => grokModeId(request(options("grok-build", { modeId: value }))),
      /ADAPTER_OPTION_INVALID/
    );
    await assert.rejects(
      buildClaudeCommand(request(options("claude-code", { permissionMode: value }))),
      /ADAPTER_OPTION_INVALID/
    );
  }
  for (const value of ["default", "auto", "bypassPermissions"])
    await assert.rejects(
      buildClaudeCommand(request(options("claude-code", { permissionMode: value }))),
      /ADAPTER_OPTION_INVALID/
    );
  for (const value of [null, "", "  ", false])
    assert.throws(() => acpModeId(request(options("fixture", { modeId: value })), "fixture"));
  for (const [approval, expected] of [
    ["ask", "default"],
    ["assisted", "auto"],
    ["full_access", "bypassPermissions"]
  ]) {
    for (const plan of [false, true]) {
      const req = request(
        item("octo.security", "approval_policy", { mode: approval }),
        ...(plan ? [options("claude-code", { permissionMode: "plan" })] : [])
      );
      const spec = await buildClaudeCommand(req);
      try {
        assert.equal(
          spec.args[spec.args.indexOf("--permission-mode") + 1],
          plan ? "plan" : expected
        );
        assert.equal(
          spec.args.includes("--dangerously-skip-permissions"),
          !plan && approval === "full_access"
        );
      } finally {
        await spec.cleanup();
      }
    }
  }
});

test("ACP selects exact grouped native IDs, and OpenCode rejects modes on its JSON path", async () => {
  const session = {
    configOptions: [
      {
        id: "native-mode",
        category: "mode",
        currentValue: "build",
        options: [{ group: "modes", options: [{ value: "build" }, { value: "review-42" }] }]
      }
    ]
  };
  const selection = acpModeSelectionRequest(session, "session", "review-42");
  assert.deepEqual(selection.params, {
    sessionId: "session",
    configId: "native-mode",
    value: "review-42"
  });
  assert.equal(acpModeSelectionRequest(session, "session", "build").unchanged, true);
  assert.throws(
    () => acpModeSelectionRequest(session, "session", "default"),
    /ACP_MODE_UNSUPPORTED/
  );
  assert.throws(() => acpModeSelectionRequest({}, "session", "plan"), /ACP_MODE_UNSUPPORTED/);
  const invalid = structuredClone(session);
  delete invalid.configOptions[0].id;
  assert.throws(() => acpModeSelectionRequest(invalid, "session", "review-42"), /ACP_MODE_INVALID/);
  const adapter = createOpenCodeAdapter({ command: "/nonexistent/provider-must-not-start" });
  const req = request(
    options("opencode", { modeId: "plan" }),
    item("octo.security", "approval_policy", { mode: "full_access" })
  );
  await assert.rejects(Array.fromAsync(adapter.invoke(req)), /OPENCODE_MODE_UNSUPPORTED/);
});

test("ACP private mode follows the final registered type, not the transport definition", async () => {
  for (const configured of [undefined, "custom", "base", "another"]) {
    const calls = [];
    let closed = false;
    const client = {
      initialize: async () => ({ protocolVersion: 1, agentCapabilities: {} }),
      reserveRequestId: () => calls.length + 1,
      request: async (method, params) => {
        calls.push({ method, params });
        return method === "session/new"
          ? {
              sessionId: "custom-session",
              modes: { currentModeId: "build", availableModes: [{ id: "plan" }] }
            }
          : {};
      },
      async *prompt() {
        yield { sessionUpdate: "agent_message_chunk", content: { text: "MODE_OK" } };
        yield { type: "prompt_result", stopReason: "end_turn" };
      },
      close: async () => {
        closed = true;
      },
      cancel: () => {}
    };
    const adapter = createAcpAdapter(
      { type: "base", metadata: { type: "custom" }, provider: "custom", command: "unused" },
      { acpClientFactory: () => client }
    );
    const req = request(
      item("octo.execution", "adapter", { type: "custom" }),
      ...(configured ? [options(configured, { modeId: "plan" })] : [])
    );
    const events = await Array.fromAsync(adapter.invoke(req));
    assert.equal(adapter.metadata.type, "custom");
    assert.equal(events.at(-1).type, "run.completed");
    assert.equal(closed, true);
    const setters = calls.filter((call) => call.method === "session/set_mode");
    assert.deepEqual(
      setters,
      configured === "custom"
        ? [
            {
              method: "session/set_mode",
              params: { sessionId: "custom-session", modeId: "plan" }
            }
          ]
        : []
    );
  }
});

test("Codex native mode uses the current thread model after fresh recovery and rejects missing models", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "context-private-codex-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const fixture = fileURLToPath(new URL("../../test-support/fake-actmode.mjs", import.meta.url));
  for (const flag of ["--fresh-fallback", "--no-model"]) {
    const log = join(directory, flag);
    const adapter = createScopedCodexAdapter({
      command: process.execPath,
      appServerArgs: [fixture, "--log", log, flag]
    });
    try {
      const req = {
        ...request(options("codex", { collaborationMode: "plan" })),
        signal: AbortSignal.timeout(8000),
        ...(flag === "--fresh-fallback"
          ? {
              providerSession: { sessionId: "codex-resumed" },
              freshFallbackModelInput: "fresh input"
            }
          : {})
      };
      const events = await Array.fromAsync(adapter.invoke(req));
      const turns = (await readFile(log, "utf8"))
        .trim()
        .split("\n")
        .map(JSON.parse)
        .filter((x) => x.method === "turn/start");
      if (flag === "--no-model") {
        assert.equal(turns.length, 0);
        assert.equal(events.at(-1).type, "run.failed");
      } else {
        assert.equal(events.at(-1).type, "run.completed");
        assert.deepEqual(
          turns.map((x) => x.params.collaborationMode.settings.model),
          ["old-thread-model", "provider-chosen-model"]
        );
      }
    } finally {
      assert.equal((await adapter.close()).complete, true);
    }
  }
});

test("Claude missing or mismatched native plan confirmation uses existing diagnostics", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "context-private-claude-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const fixture = fileURLToPath(new URL("../../test-support/fake-actmode.mjs", import.meta.url));
  for (const flag of ["--missing-init", "--mismatch-mode"]) {
    const adapter = createClaudeCodeAdapter({
      command: process.execPath,
      commandArgsPrefix: [fixture, "--log", join(directory, flag), flag]
    });
    const events = await Array.fromAsync(
      adapter.invoke({
        ...request(options("claude-code", { permissionMode: "plan" })),
        signal: AbortSignal.timeout(8000)
      })
    );
    assert.equal(
      events.filter(
        (e) =>
          e.type === "run.notice" && e.payload.params?.category === "permission_mode_unconfirmed"
      ).length,
      1
    );
    assert.equal(events.at(-1).type, "run.completed");
  }
});
