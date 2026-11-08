import { invokeClient } from "../../test-support/invoke-client.js";
import { createKernelService } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { componentEndpoint } from "@mininglamp-oss/octo-runtime-host-sdk";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

if (process.env.OCTO_RUN_CODEX_APPROVAL_LIVE !== "1")
  throw new Error("Explicit live opt-in required");
const directory = await mkdtemp(join(process.platform === "win32" ? tmpdir() : "/tmp", "oa-"));
const kernel = createKernelService({
  home: directory,
  endpoint: process.platform === "win32" ? componentEndpoint(directory) : join(directory, "k.sock"),
  adapters: (
    await import(
      (await import("node:url")).pathToFileURL(
        resolve("test/manual/codex-approval-live-worker.mjs")
      ).href
    )
  ).adapters
});
let passed = true;
try {
  await kernel.initialize();
  for (const mode of ["canonical", "native"]) {
    for (const scenario of ["shell", "mcp"]) {
      const name = `approval_${randomUUID().replaceAll("-", "")}`;
      const input =
        scenario === "shell"
          ? "Run 32 separate read-only shell tool calls concurrently in one batch. Each command must only print a distinct number from 1 to 32 using printf. Do not combine commands into one shell call, do not read credentials or contact services, and do not modify files. Then answer done."
          : `Call the read_only_echo tool from MCP server ${name} 32 times concurrently in one batch, with values 1 through 32. Do not call shell tools, read files, or contact other services. Then answer done.`;
      const items = [{ namespace: "octo.execution", name: "adapter", payload: { type: "codex" } }];
      if (scenario === "mcp")
        items.push({
          namespace: "octo.execution",
          name: "mcp",
          payload: {
            mcpServers: {
              [name]: {
                type: "stdio",
                command: process.execPath,
                args: [resolve("test/manual/codex-approval-mcp.mjs")]
              }
            }
          }
        });
      let requested = 0,
        resolved = 0,
        inFlight = 0,
        maxInFlight = 0,
        toolCalls = 0,
        terminal,
        failure;
      const start = performance.now();
      try {
        for await (const event of invokeClient(
          kernel.client,
          {
            inputs: [{ type: "text", text: input }],
            agentEnv: {
              ...{ schema: "octo.context-envelope/v3", items },
              approvalMode: "full_access",
              workdir: directory,
              runtimeLimits: { runTimeoutMs: 120000 }
            },
            protocol_mode: mode,

            invocationId: randomUUID(),
            runId: randomUUID()
          },
          { signal: AbortSignal.timeout(125000) }
        )) {
          const status =
            mode === "native"
              ? event.control?.type === "interaction"
                ? event.control.status
                : undefined
              : event.type === "interaction.requested"
                ? "pending"
                : event.type === "interaction.resolved"
                  ? event.payload.status
                  : undefined;
          if (status === "pending") {
            requested++;
            inFlight++;
            maxInFlight = Math.max(maxInFlight, inFlight);
          }
          if (status === "resolved") {
            resolved++;
            inFlight--;
          }
          if (mode === "native") {
            if (event.control?.type === "state") terminal = event.control.state;
            if (event.control?.type === "error")
              failure = event.control.failure?.reasonCode ?? event.control.code;
            if (
              event.kind === "native" &&
              event.payload.method === "item/started" &&
              ["commandExecution", "mcpToolCall"].includes(event.payload.params?.item?.type)
            )
              toolCalls++;
          } else {
            if (event.type === "tool_call.create") toolCalls++;
            if (["run.completed", "run.failed", "run.cancelled"].includes(event.type))
              terminal = event.type;
            if (event.type === "run.failed")
              failure = event.payload.failure?.reasonCode ?? event.payload.code;
          }
        }
      } catch (error) {
        failure = error.code ?? error.name;
      }
      const success =
        ["completed", "run.completed"].includes(terminal) && toolCalls >= 32 && !failure;
      passed &&= success;
      console.log(
        JSON.stringify({
          mode,
          scenario,
          terminal,
          failure,
          requested,
          resolved,
          maxInFlight,
          toolCalls,
          durationMs: Math.round(performance.now() - start),
          outcome: success ? "PASS" : "FAIL",
          burstEvidence:
            maxInFlight > 16 ? "observed" : "not-observed; deterministic fixture covers exact burst"
        })
      );
    }
  }
} finally {
  const cleanup = await kernel.close();
  console.log(JSON.stringify({ cleanupComplete: cleanup.complete }));
  if (cleanup.complete) await rm(directory, { recursive: true, force: true });
  else passed = false;
}
if (!passed) process.exitCode = 1;
