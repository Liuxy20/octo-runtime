import { withAgentEnvItems } from "../../packages/octo-runtime-adapter-sdk/dist/index.js";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createFixtureCodexHost } from "../../test-support/codex-owner.mjs";
import { invokeRequest } from "../runtime-fixture.js";
if (!process.argv.includes("--run"))
  throw new Error("Explicit --run required for a real model/MCP request");
const { owner, adapter } = createFixtureCodexHost();
const scope = adapter.createExecutionScope({ log: () => {} });
let elicitations = 0,
  approvals = 0,
  terminal;
try {
  const request = invokeRequest({
    signal: AbortSignal.timeout(90000),
    modelInput:
      "Use only the supplied consent_echo MCP tool. Never use shell or edit files.\nCall the consent_echo tool once, wait for its elicitation response, then report only the tool result.",
    agentEnv: withAgentEnvItems(
      {
        schema: "octo.context-envelope/v3",
        items: [
          {
            namespace: "octo.execution",
            name: "mcp",
            payload: {
              mcpServers: {
                octo_consent_313: {
                  type: "stdio",
                  command: process.execPath,
                  args: [
                    fileURLToPath(new URL("./fixtures/codex-elicitation-313.mjs", import.meta.url))
                  ]
                }
              }
            }
          }
        ]
      },
      [
        { namespace: "octo.execution", name: "workspace", payload: { path: process.cwd() } },
        { namespace: "octo.security", name: "approval_policy", payload: { mode: "full_access" } }
      ]
    )
  });
  for await (const event of scope.invoke(request)) {
    if (event.type === "interaction.requested") {
      if (
        event.payload.providerMethod === "mcpServer/elicitation/request" ||
        event.payload.kind === "elicitation"
      )
        elicitations++;
      else approvals++;
      await scope.respondInteraction(request.invocationId, {
        interactionId: event.payload.interactionId,
        outcome: "accepted",
        value: { approved: true }
      });
    }
    if (
      event.type?.startsWith("run.") &&
      ["run.completed", "run.failed", "run.cancelled"].includes(event.type)
    )
      terminal = event.type;
  }
  console.log(
    JSON.stringify({ terminal, elicitations, approvals, processes: owner.processes().length })
  );
  assert.equal(terminal, "run.completed");
  assert.ok(elicitations >= 1);
} finally {
  const deadline = performance.now() + 2500;
  const local = await Promise.allSettled([scope.close({ deadline })]);
  const engine = await Promise.allSettled([owner.close({ deadline })]);
  for (const result of [...local, ...engine]) {
    assert.equal(result.status, "fulfilled");
    assert.equal(result.value.complete, true);
  }
}
