import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentExecutor } from "@mininglamp-oss/octo-runtime-executor-core";
import { HostRunService } from "@mininglamp-oss/octo-runtime-executor-kernel";
import {
  DEFAULT_STREAM_LIMIT_POLICY,
  invocationInput,
  isHostTerminal,
  resolveStreamLimitPolicy
} from "@mininglamp-oss/octo-runtime-protocol";
import { invokeRequest, waitFor } from "./runtime-fixture.js";

const MIB = 1024 * 1024;
const reducedPolicy = resolveStreamLimitPolicy({
  hostFrameMaxBytes: 4096,
  replayRunMaxBytes: 8192,
  replayGlobalMaxBytes: 16384
});

function createPolicyAdapter({ type }) {
  return {
    metadata: {
      type,
      agentSources: ["provisioned"],
      protocolSupport: { protocol: "fixture.canonical", modes: ["canonical"], nativeMethods: [] }
    },
    async *invoke(request, context) {
      if (request.prompt === "replay") {
        for (let index = 0; index < 24; index++)
          yield {
            protocolVersion: 2,
            type: "message.delta",
            payload: { channel: "final", text: "x".repeat(1024) }
          };
      } else {
        yield {
          protocolVersion: 2,
          type: "message.delta",
          payload: {
            channel: "final",
            text:
              request.prompt === "large"
                ? "x".repeat(21 * 1024 * 1024)
                : JSON.stringify(context.streamLimits)
          }
        };
      }
      yield { protocolVersion: 2, type: "run.completed", payload: {} };
    }
  };
}

function largeToolOutput() {
  return "大".repeat(476_921) + "xy";
}

function createSdkAdapter({ type }) {
  return {
    metadata: {
      type,
      agentSources: ["provisioned"],
      protocolSupport: {
        protocol: "fixture.sdk",
        modes: ["canonical", "native"],
        nativeMethods: []
      }
    },
    async *invoke(_request, context) {
      const output = largeToolOutput();
      if (context.protocolMode === "native") {
        yield {
          kind: "native",
          messageKind: "notification",
          payload: {
            jsonrpc: "2.0",
            method: "item/completed",
            params: {
              threadId: "thread-sdk",
              turnId: "turn-sdk",
              item: {
                id: "tool-sdk",
                type: "commandExecution",
                status: "completed",
                aggregated_output: output,
                exit_code: 0
              }
            },
            future: { keep: ["原生字段", 7, true, null] }
          }
        };
        yield {
          kind: "native",
          messageKind: "notification",
          payload: {
            jsonrpc: "2.0",
            method: "turn/completed",
            params: { threadId: "thread-sdk", turn: { id: "turn-sdk", status: "completed" } }
          }
        };
        yield { kind: "control", control: { type: "state", state: "completed" } };
        return;
      }
      yield {
        protocolVersion: 2,
        type: "tool_call.create",
        payload: {
          id: "tool-sdk",
          name: "commandExecution",
          args: { command: "fixture-output" },
          status: "running"
        }
      };
      yield {
        protocolVersion: 2,
        type: "tool_call.update",
        payload: {
          id: "tool-sdk",
          status: "completed",
          result: { stdout: output, stderr: "", exitCode: 0 }
        }
      };
      yield { protocolVersion: 2, type: "run.completed", payload: {} };
    }
  };
}

function input(adapterType, prompt = "policy", protocolMode = "canonical") {
  return invocationInput(
    invokeRequest({
      runId: randomUUID(),
      invocationId: randomUUID(),
      approvalMode: "full_access",
      prompt
    }),
    protocolMode,
    adapterType
  );
}

function assertReducedReplay(host, runId) {
  const info = host.get(runId);
  assert.equal(info.terminal.control.state, "completed");
  assert.ok(info.oldest_seq > 1);
  assert.throws(() => host.read(runId, undefined, 0), /STREAM_GAP/);
  const retained = host.read(runId, info.stream_id, info.oldest_seq - 1).events;
  assert.ok(retained.length > 0);
  assert.equal(retained.at(-1).seq, info.latest_seq);
  assert.ok(
    retained.reduce((bytes, event) => bytes + event.bytes, 0) <= reducedPolicy.replayRunMaxBytes
  );
}

test("HostRunService resolves trusted limits once and freezes before transport starts", async (context) => {
  const provider = new AgentExecutor();
  provider.register(createPolicyAdapter({ type: "limited" }));
  const overrides = { ...reducedPolicy };
  let resolutions = 0;
  let transportPolicy;
  const host = new HostRunService(
    {
      async *invokeFrames(request, environment) {
        transportPolicy = environment.streamLimits;
        assert.equal(Object.isFrozen(transportPolicy), true);
        overrides.replayRunMaxBytes = 32 * MIB;
        yield* provider.invokeFrames(request, environment);
      },
      cancel: async (invocationId, reason) => ({ cancelled: provider.cancel(invocationId, reason) })
    },
    () => {
      resolutions++;
      return overrides;
    }
  );
  context.after(async () => {
    await host.close();
    await provider.shutdown();
  });
  const request = input("limited", "replay");
  for await (const frame of host.invokeFrames(request)) void frame;
  assert.equal(resolutions, 1);
  assert.deepEqual(transportPolicy, reducedPolicy);
  assertReducedReplay(host, request.runId);
});
