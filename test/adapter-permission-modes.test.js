import { defineAdapter } from "../packages/octo-runtime-adapter-sdk/dist/index.js";
import { agentEnvItem } from "../packages/octo-runtime-adapter-sdk/dist/index.js";
import { withAgentEnvItems } from "../packages/octo-runtime-adapter-sdk/dist/index.js";
import { preparedFrames } from "./runtime-fixture.js";
import { preparedTestInvoke } from "./runtime-fixture.js";
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { createClaudeCodeAdapter } from "@mininglamp-oss/octo-runtime-adapter-claude-code";
import { AgentExecutor } from "@mininglamp-oss/octo-runtime-executor-core";
import { loadCliAdapters } from "../apps/cli/dist/adapters.js";
const request = {
  protocolVersion: 2,
  invocationId: "permission-instance",
  agentSessionId: "session",
  runId: "run",
  prompt: "fixture",
  modelInput: "fixture",
  agentEnv: withAgentEnvItems({ schema: "octo.context-envelope/v3", items: [] }, [
    { namespace: "octo.execution", name: "workspace", payload: { path: process.cwd() } },
    { namespace: "octo.security", name: "approval_policy", payload: { mode: "ask" } },
    { namespace: "octo.execution", name: "agent", payload: { source: "provisioned" } }
  ])
};
test("default adapters reject unsupported approval modes at their execution boundary", async (t) => {
  const manifest = JSON.parse(
    await readFile(new URL("../apps/cli/src/manifest.json", import.meta.url), "utf8")
  );
  assert.equal(manifest.adapters.length, 13);
  for (const declaration of manifest.adapters) {
    const entry = {
      ...declaration,
      options: {},
      sourceManifest: fileURLToPath(new URL("../apps/cli/dist/manifest.json", import.meta.url))
    };
    const assembly = await loadCliAdapters([entry]);
    t.after(async () => {
      assert.equal((await assembly.close(performance.now() + 1000)).complete, true);
    });
    const adapter = assembly.adapters[0];
    if (["antigravity", "dsh"].includes(entry.type)) {
      assert.equal(adapter.respondInteraction, undefined);
      for (const approvalMode of ["ask", "assisted"])
        await assert.rejects(async () => {
          for await (const event of adapter.invoke({
            ...request,
            agentEnv: withAgentEnvItems(request.agentEnv, [
              {
                namespace: "octo.security",
                name: "approval_policy",
                payload: { mode: approvalMode }
              }
            ])
          }))
            assert.fail(event.type);
        }, /APPROVAL_MODE_UNSUPPORTED/);
      continue;
    }
    assert.equal(typeof adapter.respondInteraction, "function", entry.type);
    if (!["codex", "claude-code", "codebuddy"].includes(entry.type))
      await assert.rejects(async () => {
        for await (const event of adapter.invoke({
          ...request,
          agentEnv: withAgentEnvItems(request.agentEnv, [
            { namespace: "octo.security", name: "approval_policy", payload: { mode: "assisted" } }
          ])
        }))
          assert.fail(event.type);
      }, /APPROVAL_MODE_UNSUPPORTED/);
  }
});
for (const approvalMode of ["ask", "assisted", "full_access"])
  test(`Host admits ${approvalMode} through the actual responder without feature labels`, async () => {
    const host = new AgentExecutor();
    let invoked;
    host.register({
      metadata: {
        protocolSupport: { protocol: "fixture.canonical", modes: ["canonical"], nativeMethods: [] },
        type: "fixture",
        agentSources: ["provisioned"]
      },
      async respondInteraction() {},
      async *invoke(input) {
        invoked = agentEnvItem(input.agentEnv, "octo.security", "approval_policy").mode;
        yield { protocolVersion: 2, type: "run.completed", payload: {} };
      }
    });
    const events = [];
    for await (const event of preparedTestInvoke((...args) => preparedFrames(host, ...args))(
      "fixture",
      {
        ...request,
        agentEnv: withAgentEnvItems(request.agentEnv, [
          { namespace: "octo.security", name: "approval_policy", payload: { mode: approvalMode } }
        ])
      },
      { protocolMode: "canonical" }
    ))
      events.push(event);
    assert.equal(invoked, approvalMode);
    assert.equal(events.at(-1).type, "run.completed");
  });
for (const protocolMode of ["canonical", "native"])
  test(`Host requires the actual ${protocolMode} responder for interactive approval`, async () => {
    const host = new AgentExecutor();
    let invoked = false;
    host.register(
      defineAdapter({
        metadata: {
          protocolSupport: {
            protocol: "fixture.raw",
            modes: ["native", "canonical"],
            nativeMethods: []
          },
          type: "fixture",
          agentSources: ["provisioned"]
        },
        ...(protocolMode === "native"
          ? { async respondInteraction() {} }
          : { async respondNative() {} }),
        async *invoke() {
          invoked = true;
        }
      })
    );
    const frames = await Array.fromAsync(
      preparedFrames(host, "fixture", request, { protocolMode })
    );
    const failure = frames.find(
      (frame) => frame.kind === "control" && frame.control.type === "error"
    );
    const canonical = frames.find(
      (frame) => frame.kind === "canonical" && frame.event.type === "run.failed"
    );
    assert.match(
      failure?.control.message ?? canonical?.event.payload.message,
      /APPROVAL_MODE_UNSUPPORTED/
    );
    assert.equal(invoked, false);
  });
for (const [provider, factory] of [
  [
    "Claude",
    () =>
      createClaudeCodeAdapter({
        command: process.execPath,
        commandArgsPrefix: [
          fileURLToPath(new URL("../test-support/claude/fake-permission-cli.js", import.meta.url))
        ]
      })
  ]
]) {
  for (const outcome of ["accepted", "declined", "cancelled"]) {
    test(
      `${provider} waits for ${outcome} and returns it to the original native request`,
      { timeout: 5000 },
      async () => {
        const adapter = factory();
        const events = [];
        for await (const event of adapter.invoke(request)) {
          events.push(event);
          if (event.type !== "interaction.requested") continue;
          assert.equal(
            events.some((item) => item.type === "interaction.resolved"),
            false
          );
          await assert.rejects(
            adapter.respondInteraction("stale-instance", {
              interactionId: event.payload.interactionId,
              outcome
            }),
            /INTERACTION_NOT_ACTIVE/
          );
          await adapter.respondInteraction(request.invocationId, {
            interactionId: event.payload.interactionId,
            outcome
          });
        }
        assert.equal(events.at(-1).type, "run.completed");
        assert.equal(
          events.find((item) => item.type === "interaction.resolved")?.payload.outcome,
          outcome
        );
        const final = events
          .filter((item) => item.type.startsWith("message.") && item.payload.channel !== "analysis")
          .map((item) => item.payload.text ?? "")
          .join("");
        assert.match(final, new RegExp(`permission:${outcome === "accepted" ? "allow" : "deny"}`));
      }
    );
  }
}
