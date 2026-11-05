import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createCodexAdapter } from "../../packages/octo-runtime-adapter-codex/dist/index.js";
import { invokeRequest } from "../runtime-fixture.js";
if (!process.argv.includes("--run"))
  throw new Error("Explicit --run required for a real model/MCP request");
const scope = createCodexAdapter().createExecutionScope({ log: () => {} });
let elicitations = 0,
  approvals = 0,
  terminal;
try {
  const request = invokeRequest({
    workdir: process.cwd(),
    approvalMode: "full_access",
    signal: AbortSignal.timeout(90000),
    controlInstructions:
      "Use only the supplied consent_echo MCP tool. Never use shell or edit files.",
    modelInput:
      "Call the consent_echo tool once, wait for its elicitation response, then report only the tool result.",
    context: {
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
    }
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
    JSON.stringify({ terminal, elicitations, approvals, processes: scope.processes().length })
  );
  assert.equal(terminal, "run.completed");
  assert.ok(elicitations >= 1);
} finally {
  const cleanup = await scope.close({ deadline: performance.now() + 2500 });
  assert.equal(cleanup.complete, true);
}
