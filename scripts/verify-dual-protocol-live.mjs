import { withAgentEnvItems } from "../packages/octo-runtime-adapter-sdk/dist/index.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AgentExecutor } from "@mininglamp-oss/octo-runtime-executor-core";
import { CodexEventNormalizer } from "@mininglamp-oss/octo-runtime-adapter-codex";
import {
  createClaudeCodeAdapter,
  ClaudeEventNormalizer
} from "@mininglamp-oss/octo-runtime-adapter-claude-code";
import {
  assertHostFrame,
  isHostTerminal,
  invocationInput
} from "@mininglamp-oss/octo-runtime-protocol";
import { createFixtureCodexHost } from "../test-support/codex-owner.mjs";
import { resolveHostProviderLaunch } from "@mininglamp-oss/octo-runtime-adapter-sdk/process-launch";

// Print evidence metadata only. Provider payloads stay in this process.
const report = [];
for (const [type, create, Normalizer] of [
  ["codex", undefined, CodexEventNormalizer],
  ["claude-code", createClaudeCodeAdapter, ClaudeEventNormalizer]
]) {
  if (process.argv[2] && process.argv[2] !== type) continue;
  for (const protocolMode of ["native", "canonical"]) {
    if (process.argv[3] && process.argv[3] !== protocolMode) continue;
    const host = new AgentExecutor();
    const codex = type === "codex" ? createFixtureCodexHost() : undefined;
    const launch = codex
      ? undefined
      : resolveHostProviderLaunch("claude", { env: process.env, cwd: process.cwd() });
    host.register(
      codex
        ? codex.adapter
        : create({ command: launch.command, commandArgsPrefix: launch.args, env: launch.env })
    );
    const marker = "DUAL_PROTOCOL_" + randomUUID().slice(0, 8);
    const request = {
      protocolVersion: 2,
      invocationId: randomUUID(),
      runId: randomUUID(),
      agentSessionId: randomUUID(),
      sessionGeneration: 0,
      prompt: "Reply exactly " + marker + ". Do not call tools.",
      modelInput: "Reply exactly " + marker + ". Do not call tools.",
      signal: AbortSignal.timeout(90000),
      agentEnv: withAgentEnvItems({ schema: "octo.context-envelope/v3", items: [] }, [
        { namespace: "octo.execution", name: "workspace", payload: { path: process.cwd() } },
        { namespace: "octo.security", name: "approval_policy", payload: { mode: "full_access" } },
        { namespace: "octo.execution", name: "agent", payload: { source: "provisioned" } }
      ])
    };
    const original = Normalizer.prototype.normalize;
    let conversions = 0;
    Normalizer.prototype.normalize = function (...args) {
      conversions++;
      return original.apply(this, args);
    };
    const frames = [];
    const markerObserved = () =>
      (protocolMode === "native"
        ? JSON.stringify(frames)
        : frames
            .filter(
              (frame) => frame.kind === "canonical" && frame.event.payload.channel === "final"
            )
            .map((frame) => frame.event.payload.text ?? "")
            .join("")
      ).includes(marker);
    try {
      for await (const frame of host.invokeFrames(invocationInput(request, protocolMode, type), {
        signal: request.signal
      })) {
        assertHostFrame(frame);
        frames.push(frame);
      }
      const terminal = frames.filter(isHostTerminal);
      assert.equal(terminal.length, 1);
      assert.equal(terminal[0].control.state, "completed");
      assert.ok(markerObserved());
      if (protocolMode === "native") assert.equal(conversions, 0);
      else assert.ok(conversions > 0);
      report.push({
        type,
        protocolMode,
        runId: request.runId,
        passed: true,
        conversions,
        frameCount: frames.length,
        state: terminal[0].control.state
      });
    } catch (error) {
      report.push({
        type,
        protocolMode,
        runId: request.runId,
        passed: false,
        conversions,
        error: error.name,
        code: error.code,
        state: frames.filter(isHostTerminal).at(-1)?.control.state,
        markerObserved: markerObserved(),
        controls: frames
          .filter((frame) => frame.kind === "control" && frame.control.type === "error")
          .map((frame) => frame.control.code)
      });
      process.exitCode = 1;
    } finally {
      Normalizer.prototype.normalize = original;
      try {
        await host.shutdown();
      } finally {
        if (codex)
          assert.equal(
            (await codex.owner.close({ deadline: performance.now() + 2500 })).complete,
            true
          );
      }
    }
  }
}
console.log(JSON.stringify(report, null, 2));
