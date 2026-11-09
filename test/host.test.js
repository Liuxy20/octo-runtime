import { defineAdapter } from "../packages/octo-runtime-adapter-sdk/dist/index.js";
import { invocationRuntimeLimits } from "../packages/octo-runtime-adapter-sdk/dist/index.js";
import { agentEnvItem } from "../packages/octo-runtime-adapter-sdk/dist/index.js";
import { withAgentEnvItems } from "../packages/octo-runtime-adapter-sdk/dist/index.js";
import { deferred, preparedFrames, preparedTestInvoke } from "./runtime-fixture.js";
import test from "node:test";
import assert from "node:assert/strict";
import { AgentExecutor } from "@mininglamp-oss/octo-runtime-executor-core";
import { nativeHost } from "./native-host-fixture.js";
import { contextHash } from "@mininglamp-oss/octo-runtime-protocol";
const request = {
  protocolVersion: 2,
  invocationId: "inv-host",
  agentSessionId: "s",
  runId: "run_35c4ffc5db9940c9be7ce3a894819ae3",
  prompt: "p",
  modelInput: "p",
  agentEnv: withAgentEnvItems({ schema: "octo.context-envelope/v3", items: [] }, [
    { namespace: "octo.execution", name: "workspace", payload: { path: process.cwd() } },
    { namespace: "octo.security", name: "approval_policy", payload: { mode: "full_access" } },
    { namespace: "octo.execution", name: "agent", payload: { source: "provisioned" } }
  ])
};
test("host rejects malformed public input before dispatch and Adapter rejects missing cwd", async () => {
  let invoked = false;
  const host = new AgentExecutor();
  host.register(
    defineAdapter({
      metadata: { type: "contract", agentSources: ["provisioned"] },
      async *invoke() {
        invoked = true;
        yield { protocolVersion: 2, type: "run.completed", payload: {} };
      }
    })
  );
  for (const [field, reason] of [
    ["agentEnv", /CONTEXT_REQUIRED|JSON_VALUE_REQUIRED/],
    ["modelInput", /modelInput/]
  ]) {
    const invalid = { ...request };
    delete invalid[field];
    await assert.rejects(
      Array.fromAsync(
        preparedTestInvoke((...args) => preparedFrames(host, ...args))("contract", invalid, {
          protocolMode: "canonical"
        })
      ),
      reason
    );
  }
  const invalid = {
    ...request,
    agentEnv: withAgentEnvItems(request.agentEnv, [
      { namespace: "octo.execution", name: "workspace", payload: { path: "" } }
    ])
  };
  const events = await Array.fromAsync(
    preparedTestInvoke((...args) => preparedFrames(host, ...args))("contract", invalid, {
      protocolMode: "canonical"
    })
  );
  assert.equal(events.at(-1).payload.failure.reasonCode, "WORKDIR_REQUIRED");
  assert.equal(invoked, false);
  assert.equal((await host.shutdown()).cleanup, "complete");
});
test("public requests reject obsolete root fields before dispatch", async () => {
  const host = new AgentExecutor();
  for (const key of ["appendInstructions", "autoApprove", "permissionMode", "thinking"]) {
    await assert.rejects(
      Array.fromAsync(
        preparedTestInvoke((...args) => preparedFrames(host, ...args))(
          "unused",
          { ...request, [key]: true },
          { protocolMode: "canonical" }
        )
      ),
      /LEGACY_RUN_CONTRACT_REJECTED|unknown field/
    );
  }
});
test("SDK Adapter requires an actual responder for ask and assisted", async () => {
  let invoked = false;
  const host = new AgentExecutor();
  host.register(
    defineAdapter({
      metadata: { type: "no-responder", agentSources: ["provisioned"] },
      async *invoke() {
        invoked = true;
        yield { protocolVersion: 2, type: "run.completed", payload: {} };
      }
    })
  );
  for (const mode of ["ask", "assisted"]) {
    const req = {
      ...request,
      invocationId: `responder-${mode}`,
      runId: `responder-run-${mode}`,
      agentEnv: withAgentEnvItems(request.agentEnv, [
        { namespace: "octo.security", name: "approval_policy", payload: { mode } }
      ])
    };
    const events = await Array.fromAsync(
      preparedTestInvoke((...args) => preparedFrames(host, ...args))("no-responder", req, {
        protocolMode: "canonical"
      })
    );
    assert.match(events.at(-1).payload.message, /APPROVAL_MODE_UNSUPPORTED/);
  }
  assert.equal(invoked, false);
  assert.equal((await host.shutdown()).cleanup, "complete");
});
test("host holds terminal until adapter stream cleanup succeeds", async () => {
  const host = new AgentExecutor();
  host.register({
    metadata: {
      protocolSupport: { protocol: "bad" + ".canonical", modes: ["canonical"], nativeMethods: [] },
      type: "bad",
      agentSources: ["provisioned"]
    },
    async *invoke(_fixtureRequest, _fixtureContext) {
      _fixtureContext?.configureRuntimeLimits?.(invocationRuntimeLimits(_fixtureRequest));
      yield { protocolVersion: 2, type: "run.completed", payload: {} };
      throw new Error("cleanup failed");
    }
  });
  const events = [];
  for await (const event of preparedTestInvoke((...args) => preparedFrames(host, ...args))(
    "bad",
    request,
    { protocolMode: "canonical" }
  )) {
    if (!event.type.startsWith("activity.")) events.push(event);
  }
  assert.deepEqual(
    events.map((x) => x.type),
    ["run.failed"]
  );
  assert.equal(events[0].payload.failure.code, "OH-ADP-3004");
  assert.equal(events[0].payload.failure.stage, "adapter.invoke");
  assert.equal(events[0].payload.message, "cleanup failed");
});
test("host reports failure when adapter exits without terminal", async () => {
  const host = new AgentExecutor();
  host.register({
    metadata: {
      protocolSupport: {
        protocol: "short" + ".canonical",
        modes: ["canonical"],
        nativeMethods: []
      },
      type: "short",
      agentSources: ["provisioned"]
    },
    async *invoke(_fixtureRequest, _fixtureContext) {
      _fixtureContext?.configureRuntimeLimits?.(invocationRuntimeLimits(_fixtureRequest));
      yield { protocolVersion: 2, type: "message.create", payload: {} };
    }
  });
  const events = [];
  for await (const event of preparedTestInvoke((...args) => preparedFrames(host, ...args))(
    "short",
    request,
    { protocolMode: "canonical" }
  )) {
    if (!event.type.startsWith("activity.")) events.push(event);
  }
  assert.equal(events.at(-1).type, "run.failed");
});
test("host classifies and redacts adapter-provided provider failures", async () => {
  const host = new AgentExecutor();
  host.register({
    metadata: {
      protocolSupport: {
        protocol: "provider-fixture" + ".canonical",
        modes: ["canonical"],
        nativeMethods: []
      },
      type: "provider-fixture",
      agentSources: ["provisioned"]
    },
    async *invoke(_fixtureRequest, _fixtureContext) {
      _fixtureContext?.configureRuntimeLimits?.(invocationRuntimeLimits(_fixtureRequest));
      yield {
        protocolVersion: 2,
        type: "run.failed",
        payload: {
          code: "invalid_api_key",
          message: "Authorization: Bearer provider-secret",
          providerError: { status: 401, token: "provider-secret" }
        }
      };
    }
  });
  const events = [];
  for await (const event of preparedTestInvoke((...args) => preparedFrames(host, ...args))(
    "provider-fixture",
    request,
    { protocolMode: "canonical" }
  )) {
    if (!event.type.startsWith("activity.")) events.push(event);
  }
  assert.equal(events.at(-1).payload.failure.reasonCode, "PROVIDER_HTTP_401");
  assert.equal(events.at(-1).payload.failure.code, "OH-PRV-4001");
  assert.equal(events.at(-1).payload.failure.source.adapter, "provider-fixture");
  assert.equal(events.at(-1).payload.message, "Authorization: Bearer [REDACTED]");
  assert.deepEqual(events.at(-1).payload.providerError, { status: 401, token: "[REDACTED]" });
  assert.doesNotMatch(JSON.stringify(events), /provider-secret/);
});
test("host normalizes unclassified analysis to an explicit fail-closed exposure", async () => {
  const host = new AgentExecutor();
  host.register({
    metadata: {
      protocolSupport: {
        protocol: "legacy" + ".canonical",
        modes: ["canonical"],
        nativeMethods: []
      },
      type: "legacy",
      agentSources: ["provisioned"]
    },
    async *invoke(_fixtureRequest, _fixtureContext) {
      _fixtureContext?.configureRuntimeLimits?.(invocationRuntimeLimits(_fixtureRequest));
      yield {
        protocolVersion: 2,
        type: "message.delta",
        payload: { channel: "analysis", text: "internal" }
      };
      yield { protocolVersion: 2, type: "run.completed", payload: {} };
    }
  });
  const events = [];
  for await (const event of preparedTestInvoke((...args) => preparedFrames(host, ...args))(
    "legacy",
    request,
    { protocolMode: "canonical" }
  )) {
    if (!event.type.startsWith("activity.")) events.push(event);
  }
  const analysis = events.filter((event) => event.type.startsWith("message."));
  assert.equal(analysis.length, 0);
  for (const event of analysis) {
    assert.equal(event.payload.exposure, "unknown");
    assert.deepEqual(event.payload.provenance, { provider: "legacy", nativeEvent: "unknown" });
  }
});
test("host keeps step-scoped analysis messages separate and closes each round", async () => {
  const host = new AgentExecutor();
  host.register({
    metadata: {
      protocolSupport: {
        protocol: "steps" + ".canonical",
        modes: ["canonical"],
        nativeMethods: []
      },
      type: "steps",
      agentSources: ["provisioned"]
    },
    async *invoke(_fixtureRequest, _fixtureContext) {
      _fixtureContext?.configureRuntimeLimits?.(invocationRuntimeLimits(_fixtureRequest));
      for (const stepId of ["step-1", "step-2"]) {
        yield { protocolVersion: 2, type: "model_step.started", payload: { stepId } };
        yield {
          protocolVersion: 2,
          type: "message.delta",
          payload: {
            channel: "analysis",
            messageId: `${stepId}:reasoning`,
            stepId,
            text: `${stepId} thought`,
            exposure: "public_reasoning",
            provenance: { provider: "steps", nativeEvent: "reasoning" }
          }
        };
        yield {
          protocolVersion: 2,
          type: "model_step.finished",
          payload: {
            stepId,
            status: "completed",
            finishReason: stepId === "step-1" ? "tool-calls" : "stop"
          }
        };
      }
      yield { protocolVersion: 2, type: "run.completed", payload: {} };
    }
  });
  const events = [];
  for await (const event of preparedTestInvoke((...args) => preparedFrames(host, ...args))(
    "steps",
    request,
    { protocolMode: "canonical" }
  )) {
    if (!event.type.startsWith("activity.")) events.push(event);
  }
  const analysisCreates = events.filter(
    (event) => event.type === "message.create" && event.payload.channel === "analysis"
  );
  const analysisUpdates = events.filter(
    (event) => event.type === "message.update" && event.payload.channel === "analysis"
  );
  assert.deepEqual(
    analysisCreates.map((event) => event.payload.messageId),
    ["step-1:reasoning", "step-2:reasoning"]
  );
  assert.deepEqual(
    analysisUpdates.map((event) => [event.payload.messageId, event.payload.stepId]),
    [
      ["step-1:reasoning", "step-1"],
      ["step-2:reasoning", "step-2"]
    ]
  );
  assert.ok(
    events.indexOf(analysisUpdates[0]) <
      events.findIndex((event) => event.type === "model_step.finished")
  );
});
test("host cancellation aborts provider and emits stopped once", async () => {
  const host = new AgentExecutor();
  host.register({
    metadata: {
      protocolSupport: { protocol: "slow" + ".canonical", modes: ["canonical"], nativeMethods: [] },
      type: "slow",
      agentSources: ["provisioned"]
    },
    async *invoke(req, _fixtureContext) {
      _fixtureContext?.configureRuntimeLimits?.(invocationRuntimeLimits(req));
      yield { protocolVersion: 2, type: "message.create", payload: {} };
      await new Promise((_, reject) =>
        req.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })
      );
    }
  });
  const events = [];
  const consume = (async () => {
    for await (const event of preparedTestInvoke((...args) => preparedFrames(host, ...args))(
      "slow",
      { ...request, invocationId: "cancel-me" },
      { protocolMode: "canonical" }
    )) {
      if (!event.type.startsWith("activity.")) events.push(event);
    }
  })();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(host.cancel("cancel-me", "test_cancel"), true);
  await consume;
  assert.equal(events.at(-1).type, "run.cancelled");
  assert.equal(events.filter((item) => item.type.startsWith("run.")).length, 1);
});
test("host watchdog fails a provider that never emits its first protocol frame", async () => {
  const host = new AgentExecutor();
  host.register({
    metadata: {
      protocolSupport: {
        protocol: "silent-start" + ".canonical",
        modes: ["canonical"],
        nativeMethods: []
      },
      type: "silent-start",
      agentSources: ["provisioned"]
    },
    async *invoke(_fixtureRequest, _fixtureContext) {
      _fixtureContext?.configureRuntimeLimits?.(invocationRuntimeLimits(_fixtureRequest));
      await new Promise(() => {});
    }
  });
  const events = [];
  for await (const event of preparedTestInvoke((...args) => preparedFrames(host, ...args))(
    "silent-start",
    {
      ...request,
      invocationId: "watchdog-start",
      agentEnv: withAgentEnvItems(request.agentEnv, [
        {
          namespace: "octo.execution",
          name: "limits",
          payload: {
            first_frame_timeout_ms: 100,
            model_idle_timeout_ms: 10000,
            tool_timeout_ms: 10000,
            run_timeout_ms: 10000,
            cancel_grace_ms: 100,
            enforcement: "enforce"
          }
        }
      ])
    },
    { protocolMode: "canonical" }
  )) {
    if (!event.type.startsWith("activity.")) events.push(event);
  }
  assert.equal(events.at(-1).type, "run.failed");
  assert.equal(events.at(-1).payload.failure.reasonCode, "ADAPTER_FIRST_FRAME_TIMEOUT");
  assert.equal(events.at(-1).payload.failure.code, "OH-ADP-3007");
  assert.equal(events.at(-1).payload.failure.stage, "adapter.invoke");
  assert.equal(events.at(-1).payload.failure.diagnosticId, "diag_35c4ffc5db9940c9be7ce3a894819ae3");
  const params = events.at(-1).payload.failure.params;
  assert.equal(params.timeoutStage, "starting");
  assert.equal(params.timeoutMs, 100);
  assert.equal(params.timeoutReason, "first_frame");
  assert.equal(params.configParameter, "octo.execution/limits.first_frame_timeout_ms");
});
test("host watchdog uses the tool budget while a canonical tool call is open", async () => {
  const host = new AgentExecutor();
  host.register({
    metadata: {
      protocolSupport: {
        protocol: "silent-tool" + ".canonical",
        modes: ["canonical"],
        nativeMethods: []
      },
      type: "silent-tool",
      agentSources: ["provisioned"]
    },
    async *invoke(_fixtureRequest, _fixtureContext) {
      _fixtureContext?.configureRuntimeLimits?.(invocationRuntimeLimits(_fixtureRequest));
      yield { protocolVersion: 2, type: "model_step.started", payload: { stepId: "step-1" } };
      yield {
        protocolVersion: 2,
        type: "tool_call.create",
        payload: { id: "tool-1", name: "exec", args: {}, status: "running" }
      };
      await new Promise(() => {});
    }
  });
  const events = [];
  for await (const event of preparedTestInvoke((...args) => preparedFrames(host, ...args))(
    "silent-tool",
    {
      ...request,
      invocationId: "watchdog-tool",
      agentEnv: withAgentEnvItems(request.agentEnv, [
        {
          namespace: "octo.execution",
          name: "limits",
          payload: {
            first_frame_timeout_ms: 1000,
            model_idle_timeout_ms: 10000,
            tool_timeout_ms: 100,
            run_timeout_ms: 10000,
            cancel_grace_ms: 100,
            enforcement: "enforce"
          }
        }
      ])
    },
    { protocolMode: "canonical" }
  )) {
    if (!event.type.startsWith("activity.")) events.push(event);
  }
  assert.deepEqual(
    events.slice(0, 2).map((event) => event.type),
    ["model_step.started", "tool_call.create"]
  );
  assert.equal(events.at(-1).type, "run.failed");
  assert.equal(events.at(-1).payload.failure.reasonCode, "ADAPTER_TOOL_IDLE_TIMEOUT");
  assert.equal(events.at(-1).payload.failure.code, "OH-ADP-3009");
  const params = events.at(-1).payload.failure.params;
  assert.equal(params.timeoutStage, "tool_active");
  assert.equal(params.timeoutMs, 100);
  assert.equal(params.timeoutReason, "tool_idle");
});
test("host shutdown aborts every active provider invocation before returning", async () => {
  const host = new AgentExecutor();
  let aborted = 0;
  let active = 0;
  const started = deferred();
  host.register({
    metadata: {
      protocolSupport: { protocol: "slow" + ".canonical", modes: ["canonical"], nativeMethods: [] },
      type: "slow",
      agentSources: ["provisioned"]
    },
    async *invoke(req, _fixtureContext) {
      _fixtureContext?.configureRuntimeLimits?.(invocationRuntimeLimits(req));
      yield { protocolVersion: 2, type: "message.create", payload: {} };
      await new Promise((_, reject) => {
        req.signal.addEventListener(
          "abort",
          () => {
            aborted += 1;
            reject(new Error("aborted"));
          },
          { once: true }
        );
        if (++active === 2) started.resolve();
      });
    }
  });
  const invocations = ["shutdown-1", "shutdown-2"].map((invocationId) =>
    (async () => {
      const events = [];
      for await (const event of preparedTestInvoke((...args) => preparedFrames(host, ...args))(
        "slow",
        { ...request, invocationId, runId: invocationId },
        { protocolMode: "canonical" }
      )) {
        if (!event.type.startsWith("activity.")) events.push(event);
      }
      return events;
    })()
  );
  await started.promise;
  await host.shutdown("parent disconnected");
  const results = await Promise.all(invocations);
  assert.equal(aborted, 2);
  assert.deepEqual(
    results.map((events) => events.at(-1).type),
    ["run.cancelled", "run.cancelled"]
  );
});
test(
  "RPC interaction responses resume the same active ask invocation",
  { timeout: 5000 },
  async (testContext) => {
    let resume;
    const response = new Promise((resolve) => {
      resume = resolve;
    });
    const adapter = {
      metadata: {
        protocolSupport: {
          protocol: "interactive" + ".canonical",
          modes: ["canonical"],
          nativeMethods: []
        },
        type: "interactive",
        agentSources: ["provisioned"]
      },
      async *invoke(invocation, _fixtureContext) {
        _fixtureContext?.configureRuntimeLimits?.(invocationRuntimeLimits(invocation));
        yield {
          protocolVersion: 2,
          type: "interaction.requested",
          payload: {
            interactionId: "approval-1",
            kind: "approval",
            executionInstanceId: invocation.invocationId,
            expiresAt: new Date(Date.now() + 60000).toISOString(),
            request: {
              schema: "octo.approval-request/v1",
              policy: {
                mode: agentEnvItem(invocation.agentEnv, "octo.security", "approval_policy").mode,
                hash: contextHash(invocation.agentEnv)
              },
              operation: { kind: "tool_execution", summary: "Proceed?" },
              requestedPermissions: [],
              allowedOutcomes: ["accepted", "declined", "cancelled"],
              grantScope: "request"
            }
          }
        };
        const answer = await response;
        yield {
          protocolVersion: 2,
          type: "interaction.resolved",
          payload: {
            interactionId: answer.interactionId,
            executionInstanceId: invocation.invocationId,
            status: "resolved",
            outcome: answer.outcome
          }
        };
        yield {
          protocolVersion: 2,
          type: "message.create",
          payload: { channel: "final", text: answer.outcome }
        };
        yield { protocolVersion: 2, type: "run.completed", payload: {} };
      },
      async respondInteraction(invocationId, answer) {
        assert.equal(invocationId, "rpc-interactive");
        resume(answer);
      }
    };
    const host = await nativeHost([adapter]);
    const client = host.client;
    testContext.after(() => host.close());
    const iterator = preparedTestInvoke((...args) => preparedFrames(client, ...args))(
      "interactive",
      {
        ...request,
        invocationId: "rpc-interactive",
        agentEnv: withAgentEnvItems(request.agentEnv, [
          { namespace: "octo.security", name: "approval_policy", payload: { mode: "ask" } }
        ])
      },
      { protocolMode: "canonical" }
    );
    let interaction;
    while (!interaction) {
      const next = await iterator.next();
      assert.equal(next.done, false);
      if (next.value.type === "interaction.requested") interaction = next.value;
    }
    assert.equal(interaction.payload.request.policy.mode, "ask");
    assert.equal(interaction.payload.executionInstanceId, "rpc-interactive");
    await assert.rejects(
      client.respondInteraction("wrong-invocation", {
        interactionId: "approval-1",
        outcome: "accepted"
      }),
      /INVALID_PARAMS|RUN_IDENTITY_MISMATCH|INVOCATION_NOT_TRACKED/
    );
    await client.respondInteraction("rpc-interactive", {
      interactionId: "approval-1",
      outcome: "accepted"
    });
    const remaining = [];
    for await (const event of iterator) {
      if (!event.type.startsWith("activity.")) remaining.push(event);
    }
    assert.deepEqual(
      remaining.map((event) => event.type),
      ["interaction.resolved", "message.create", "message.update", "run.completed"]
    );
    assert.deepEqual(remaining[0].payload, {
      interactionId: "approval-1",
      executionInstanceId: "rpc-interactive",
      status: "resolved",
      outcome: "accepted"
    });
    assert.equal(remaining[1].payload.text, "accepted");
  }
);
