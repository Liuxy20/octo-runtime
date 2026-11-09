import { withAgentEnvItems } from "../packages/octo-runtime-adapter-sdk/dist/index.js";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createScopedCodexAdapter as createCodexAdapter } from "../test-support/scoped-codex-adapter.mjs";
import { invokeRequest } from "./runtime-fixture.js";
test(
  "real Codex finalization interruption preserves the answer and resumes the thread",
  {
    skip: process.env.OCTO_CODEX_FINALIZATION_LIVE !== "1",
    timeout: 180000
  },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "octo-codex-finalization-live-"));
    const adapter = createCodexAdapter();
    const run = async (input, providerSession, timeoutMs) => {
      const events = [];
      const started = Date.now();
      for await (const event of adapter.invoke(
        invokeRequest({
          modelInput: input,
          prompt: input,
          providerSession,
          signal: AbortSignal.timeout(80000),
          agentEnv: withAgentEnvItems(undefined, [
            { namespace: "octo.execution", name: "workspace", payload: { path: directory } },
            {
              namespace: "adapter.codex",
              name: "options",
              payload: { ...{ finalizationTimeoutMs: timeoutMs } }
            }
          ])
        })
      ))
        events.push(event);
      console.log(
        JSON.stringify({
          elapsedMs: Date.now() - started,
          terminal: events.at(-1),
          answer: events
            .filter((event) => event.type === "message.update" && event.payload.channel === "final")
            .map((event) => event.payload.text)
        })
      );
      return events;
    };
    try {
      const first = await run(
        "Remember the marker OCTO_FINALIZATION_RESUME. Reply with only that marker.",
        undefined,
        1
      );
      assert.ok(
        first.some(
          (event) =>
            event.type === "message.update" &&
            event.payload.text?.includes("OCTO_FINALIZATION_RESUME")
        )
      );
      assert.ok(["run.completed", "run.failed"].includes(first.at(-1).type));
      if (first.at(-1).type === "run.failed")
        assert.equal(first.at(-1).payload.code, "CODEX_FINALIZATION_TIMEOUT");
      const session = first.find((event) => event.type === "session.update")?.payload
        .providerSession;
      assert.ok(session?.sessionId);
      const second = await run(
        "What marker did I ask you to remember? Reply with only the marker.",
        session,
        15000
      );
      assert.equal(second.at(-1).type, "run.completed");
      assert.ok(
        second.some(
          (event) =>
            event.type === "session.update" &&
            event.payload.providerSession?.resumeOutcome === "resumed"
        )
      );
      assert.ok(
        second.some(
          (event) =>
            event.type === "message.update" &&
            event.payload.text?.includes("OCTO_FINALIZATION_RESUME")
        )
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
);
