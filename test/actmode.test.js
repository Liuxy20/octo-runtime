import {
  withAgentEnvItems,
  assertAdapterAgentEnv
} from "../packages/octo-runtime-adapter-sdk/dist/index.js";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertContextEnvelope,
  resolveContextConfiguration,
  contextItem
} from "../packages/octo-runtime-protocol/dist/index.js";
import { assertJsonValue } from "../packages/octo-runtime-protocol/dist/context.js";
import { prepareInvokeInput } from "../packages/octo-runtime-executor-core/dist/invoke-input.js";
import { createScopedCodexAdapter as createCodexAdapter } from "../test-support/scoped-codex-adapter.mjs";
import { createClaudeCodeAdapter } from "../packages/octo-runtime-adapter-claude-code/dist/index.js";
import { createAcpAdapter } from "../packages/octo-runtime-adapter-acp/dist/index.js";
import { invokeRequest, contextEnvelope } from "./runtime-fixture.js";
const fixture = fileURLToPath(new URL("../test-support/fake-actmode.mjs", import.meta.url));
const contexts = (mode, provider = "fixture") =>
  contextEnvelope(
    mode === undefined
      ? []
      : [
          {
            namespace: `adapter.${provider}`,
            name: "options",
            payload:
              provider === "codex"
                ? { collaborationMode: mode }
                : provider === "claude-code"
                  ? { permissionMode: mode }
                  : { modeId: mode }
          }
        ]
  );
const collect = async (source) => {
  const events = [];
  for await (const event of source) events.push(event);
  return events;
};
test("private options remain opaque, explicitly composed and never rendered as model text", () => {
  const env = contexts("provider-mode");
  assertContextEnvelope(env);
  const { request } = prepareInvokeInput({
    inputs: [{ type: "text", text: "test" }],
    agentEnv: env
  });
  assert.deepEqual(request.agentEnv, env);
  assert.equal(request.modelInput, "test");
  assert.doesNotThrow(() => assertAdapterAgentEnv(invokeRequest({ agentEnv: env })));
  assert.throws(
    () => assertContextEnvelope(contextEnvelope([...env.items, ...env.items])),
    /DUPLICATED/
  );
  const result = resolveContextConfiguration(
    { defaults: env, mandatory: contexts() },
    contexts("other")
  );
  assert.deepEqual(contextItem(result, "adapter.fixture", "options").payload, { modeId: "other" });
});
for (const provider of ["codex", "claude-code"])
  for (const mode of provider === "codex" ? [undefined, "default", "plan"] : [undefined, "plan"]) {
    test(
      `${provider} maps only explicit private mode=${mode} in canonical and native`,
      { timeout: 10000 },
      async () => {
        const directory = await mkdtemp(join(tmpdir(), "octo-actmode-"));
        try {
          for (const protocolMode of ["canonical", "native"]) {
            const log = join(directory, protocolMode);
            const options = [fixture, "--log", log];
            const adapter =
              provider === "codex"
                ? createCodexAdapter({ command: process.execPath, appServerArgs: options })
                : createClaudeCodeAdapter({
                    env: process.env,
                    command: process.execPath,
                    commandArgsPrefix: options
                  });
            const req = invokeRequest({
              signal: AbortSignal.timeout(8000),
              agentEnv: withAgentEnvItems(contexts(mode, provider), [])
            });
            const snapshot = structuredClone(req.agentEnv);
            const events = await collect(adapter.invoke(req, { protocolMode }));
            const evidence = events.find(
              (event) => event.type === "execution.update" || event.control?.name === "execution"
            );
            assert.equal(evidence, undefined);
            const lines = (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
            if (provider === "codex") {
              const turn = lines.find((line) => line.method === "turn/start");
              assert.equal(turn.params.collaborationMode?.mode, mode);
              assert.equal(
                lines.some((line) => line.method === "collaborationMode/list"),
                mode !== undefined
              );
              if (mode)
                assert.equal(turn.params.collaborationMode.settings.model, "provider-chosen-model");
            } else {
              const args = lines[0].args;
              assert.equal(
                args[args.indexOf("--permission-mode") + 1],
                mode === "plan" ? "plan" : "default"
              );
              assert.equal(args.includes("--dangerously-skip-permissions"), false);
            }
            assert.deepEqual(req.agentEnv, snapshot);
          }
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
      }
    );
  }
test(
  "Codex rejects unsupported private modes; provider failure does not restart turn",
  { timeout: 10000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "octo-actmode-fallback-"));
    try {
      for (const fail of [false, true]) {
        const log = join(directory, String(fail));
        const adapter = createCodexAdapter({
          command: process.execPath,
          appServerArgs: [fixture, "--log", log, ...(fail ? ["--fail-turn"] : ["--unsupported"])]
        });
        const events = await collect(
          adapter.invoke(
            invokeRequest({
              signal: AbortSignal.timeout(8000),
              agentEnv: withAgentEnvItems(contexts("plan", "codex"), [])
            })
          )
        );
        const evidence = events.find((e) => e.type === "execution.update");
        assert.equal(evidence, undefined);
        assert.equal(events.at(-1).type, "run.failed");
        const lines = (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
        assert.equal(lines.filter((line) => line.method === "turn/start").length, fail ? 1 : 0);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
);
for (const modern of [true, false])
  test(`ACP ${modern ? "configOptions" : "modes"} maps explicit input, omission performs no setting`, async () => {
    for (const mode of [undefined, "default", "plan"]) {
      const calls = [];
      const client = {
        initialize: async () => ({ protocolVersion: 1, agentCapabilities: {} }),
        reserveRequestId: () => calls.length + 1,
        request: async (method, params) => {
          calls.push({ method, params });
          return method === "session/new"
            ? {
                sessionId: "acp-actmode",
                ...(modern
                  ? {
                      configOptions: [
                        {
                          id: "mode",
                          category: "mode",
                          currentValue: "default",
                          options: [{ value: "default" }, { value: "plan" }]
                        }
                      ]
                    }
                  : {
                      modes: {
                        currentModeId: "default",
                        availableModes: [{ id: "default" }, { id: "plan" }]
                      }
                    })
              }
            : {};
        },
        async *prompt() {
          yield { sessionUpdate: "agent_message_chunk", content: { text: "MODE_OK" } };
          yield { type: "usage", usage: { inputTokens: 1 } };
          yield { type: "prompt_result", stopReason: "end_turn" };
        },
        close: async () => {},
        cancel: () => {}
      };
      const adapter = createAcpAdapter(
        { type: "fixture", provider: "fixture", command: "fixture" },
        { acpClientFactory: () => client }
      );
      const events = await collect(
        adapter.invoke(invokeRequest({ agentEnv: withAgentEnvItems(contexts(mode), []) }))
      );
      const settings = calls.filter((call) => call.method.startsWith("session/set_"));
      assert.equal(settings.length, mode === "plan" ? 1 : 0);
      if (mode === "plan")
        assert.deepEqual(
          settings[0],
          modern
            ? {
                method: "session/set_config_option",
                params: { sessionId: "acp-actmode", configId: "mode", value: "plan" }
              }
            : { method: "session/set_mode", params: { sessionId: "acp-actmode", modeId: "plan" } }
        );
      assert.equal(
        events.some((event) => event.type === "execution.update"),
        false
      );
      assert.equal(events.at(-1).type, "run.completed");
      for (const event of events) assertJsonValue(event);
    }
  });
test("ACP rejects unsupported native IDs; setter errors do not prompt", async () => {
  for (const fail of [false, true]) {
    let prompted = false;
    const client = {
      initialize: async () => ({ protocolVersion: 1, agentCapabilities: {} }),
      reserveRequestId: () => 1,
      request: async (method) => {
        if (method === "session/new")
          return {
            sessionId: "fallback-session",
            modes: { currentModeId: "other", availableModes: [{ id: fail ? "plan" : "default" }] }
          };
        if (fail) throw new Error("SET_MODE_FAILED");
        return {};
      },
      async *prompt() {
        prompted = true;
        yield { type: "prompt_result", stopReason: "end_turn" };
      },
      close: async () => {},
      cancel: () => {}
    };
    const adapter = createAcpAdapter(
      { type: "fixture", provider: "fixture", command: "fixture" },
      { acpClientFactory: () => client }
    );
    const events = [];
    const execution = async () => {
      for await (const event of adapter.invoke(
        invokeRequest({ agentEnv: withAgentEnvItems(contexts("plan"), []) })
      ))
        events.push(event);
    };
    await assert.rejects(execution, fail ? /SET_MODE_FAILED/ : /ACP_MODE_UNSUPPORTED/);
    assert.equal(prompted, false);
    assert.equal(
      events.some((event) => event.type === "execution.update"),
      false
    );
  }
});
