import {
  withAgentEnvItems,
  assertAdapterAgentEnv
} from "../packages/octo-runtime-adapter-sdk/dist/index.js";
import test from "node:test";
import assert from "node:assert/strict";
import {
  assertCanonicalEvent,
  assertInteractionResponse,
  assertContextEnvelope,
  assertInvokeRequest,
  messageExposure
} from "../packages/octo-runtime-protocol/dist/index.js";
import {
  approvalPayload,
  contextEnvelope,
  continuityItem,
  invokeRequest
} from "./runtime-fixture.js";
test("interaction contracts require a stable request id and bounded response outcome", () => {
  assert.doesNotThrow(() =>
    assertCanonicalEvent({
      protocolVersion: 2,
      type: "interaction.requested",
      payload: approvalPayload("invoke-approval")
    })
  );
  assert.doesNotThrow(() =>
    assertInteractionResponse({
      interactionId: "approval-1",
      outcome: "accepted"
    })
  );
  assert.throws(
    () =>
      assertCanonicalEvent({
        protocolVersion: 2,
        type: "interaction.requested",
        payload: { kind: "approval", request: {} }
      }),
    /payload\.interactionId/
  );
  assert.throws(
    () => assertInteractionResponse({ interactionId: "approval-1", outcome: "maybe" }),
    /outcome is unsupported/
  );
});
test("InvokeRequest requires AgentEnv and model input; Adapter validates approval", () => {
  const request = invokeRequest();
  assert.doesNotThrow(() => assertInvokeRequest(request));
  for (const [field, error] of [
    ["agentEnv", /CONTEXT_REQUIRED/],
    ["modelInput", /modelInput must be a non-empty string/]
  ]) {
    const incomplete = { ...request };
    delete incomplete[field];
    assert.throws(() => assertInvokeRequest(incomplete), error);
  }
  for (const modelInput of ["", null, 42]) {
    assert.throws(
      () => assertInvokeRequest({ ...request, modelInput }),
      /modelInput must be a non-empty string/
    );
  }
  for (const controlInstructions of [undefined, null, 42, "", "old prompt"]) {
    assert.throws(
      () => assertInvokeRequest({ ...request, controlInstructions }),
      /CONTROL_INSTRUCTIONS_REMOVED/
    );
  }
  assert.doesNotThrow(() => assertInvokeRequest({ ...request }));
  for (const approvalMode of ["ask", "assisted", "full_access"]) {
    assert.doesNotThrow(() =>
      assertInvokeRequest({
        ...request,
        agentEnv: withAgentEnvItems(request.agentEnv, [
          { namespace: "octo.security", name: "approval_policy", payload: { mode: approvalMode } }
        ])
      })
    );
  }
  for (const approvalMode of ["auto", "never", "", null]) {
    assert.throws(
      () =>
        assertAdapterAgentEnv({
          ...request,
          agentEnv: withAgentEnvItems(request.agentEnv, [
            { namespace: "octo.security", name: "approval_policy", payload: { mode: approvalMode } }
          ])
        }),
      /APPROVAL_MODE_UNSUPPORTED/
    );
  }
});
test("InvokeRequest rejects legacy instruction and permission fields rather than falling back", () => {
  const request = invokeRequest();
  for (const appendInstructions of ["legacy", "", undefined]) {
    assert.throws(
      () => assertInvokeRequest({ ...request, appendInstructions }),
      /LEGACY_RUN_CONTRACT_REJECTED/
    );
  }
  for (const key of ["autoApprove", "dangerouslyBypassPermissions", "permissionMode"]) {
    assert.throws(() => assertInvokeRequest({ ...request, [key]: true }), /unknown field/);
  }
});
test("audit metadata belongs in runMetadata and is not an alternate Context contract", () => {
  const runMetadata = {
    namespace: "im",
    agentId: "agent-1",
    profile: "work",
    runtimeId: "runtime-1"
  };
  assert.doesNotThrow(() =>
    assertInvokeRequest(
      invokeRequest({ runMetadata, agentEnv: withAgentEnvItems(contextEnvelope(), []) })
    )
  );
  for (const context of [{}, runMetadata, { ...contextEnvelope(), ...runMetadata }]) {
    assert.throws(
      () => assertInvokeRequest(invokeRequest({ agentEnv: withAgentEnvItems(context, []) })),
      /CONTEXT_SCHEMA_INVALID/
    );
  }
});
test("opaque payloads pass envelope checks while removed instructions reject", () => {
  const items = [
    {
      namespace: "octo.content",
      name: "inline",
      payload: { entries: [{ resource_ref: "octo://messages/selected", text: "Selected message" }] }
    }
  ];
  assert.doesNotThrow(() => assertContextEnvelope(contextEnvelope(items)));
  for (const entry of [
    {},
    { source: "revision" },
    { text: "control", source: 42 },
    { text: "control", source: "revision", command: "legacy" }
  ]) {
    assert.throws(
      () =>
        assertContextEnvelope(
          contextEnvelope([
            {
              namespace: "octo.control",
              name: "instructions",
              payload: { entries: [entry] }
            }
          ])
        ),
      /CONTROL_INSTRUCTIONS_REMOVED/
    );
  }
  for (const entry of [{}, { text: 42 }, { resource_ref: "octo://selected", messages: [] }]) {
    assert.doesNotThrow(() =>
      assertContextEnvelope(
        contextEnvelope([
          {
            namespace: "octo.content",
            name: "references",
            payload: { entries: [entry] }
          }
        ])
      )
    );
  }
});
test("canonical interactions carry instance-scoped expiry and distinct resolved lifecycle events", () => {
  const payload = approvalPayload("invoke-approval");
  assert.doesNotThrow(() =>
    assertCanonicalEvent({ protocolVersion: 2, type: "interaction.requested", payload })
  );
  for (const status of ["resolved", "expired", "invalidated"]) {
    assert.doesNotThrow(() =>
      assertCanonicalEvent({
        protocolVersion: 2,
        type: "interaction.resolved",
        payload: {
          interactionId: payload.interactionId,
          executionInstanceId: payload.executionInstanceId,
          status,
          ...(status === "resolved"
            ? { outcome: "accepted" }
            : { reasonCode: status === "expired" ? "approval_timeout" : "execution_lost" })
        }
      })
    );
  }
});
test("every requested interaction requires a bounded execution instance and finite expiry", () => {
  for (const kind of ["approval", "question", "elicitation"]) {
    const payload = { ...approvalPayload("invoke-contract"), kind };
    assert.doesNotThrow(() =>
      assertCanonicalEvent({ protocolVersion: 2, type: "interaction.requested", payload })
    );
    for (const expiresAt of ["2030-10-06T12:00:00.123456789Z", "2030-10-06T12:00:00+08:00"]) {
      assert.doesNotThrow(() =>
        assertCanonicalEvent({
          protocolVersion: 2,
          type: "interaction.requested",
          payload: { ...payload, expiresAt }
        })
      );
    }
    for (const field of ["interactionId", "executionInstanceId", "expiresAt"]) {
      const incomplete = { ...payload };
      delete incomplete[field];
      assert.throws(
        () =>
          assertCanonicalEvent({
            protocolVersion: 2,
            type: "interaction.requested",
            payload: incomplete
          }),
        new RegExp(`payload\\.${field}`)
      );
      assert.throws(
        () =>
          assertCanonicalEvent({
            protocolVersion: 2,
            type: "interaction.requested",
            payload: { ...payload, [field]: "" }
          }),
        new RegExp(`payload\\.${field}`)
      );
    }
    for (const invalid of [
      { interactionId: "x".repeat(192) },
      { executionInstanceId: "x".repeat(192) },
      ...[
        "forever",
        "October 6, 2030",
        "2030-10-06",
        "2030-02-30T12:00:00Z",
        "2030-10-06T24:00:00Z",
        "2030-10-06T12:00:00+24:00"
      ].map((expiresAt) => ({ expiresAt }))
    ]) {
      assert.throws(
        () =>
          assertCanonicalEvent({
            protocolVersion: 2,
            type: "interaction.requested",
            payload: { ...payload, ...invalid }
          }),
        /instance or expiry is invalid/
      );
    }
  }
});
test("approval requests reject legacy flat objects and incomplete typed requests", () => {
  const payload = approvalPayload("invoke-contract");
  assert.throws(
    () =>
      assertCanonicalEvent({
        protocolVersion: 2,
        type: "interaction.requested",
        payload: {
          ...payload,
          request: { title: "Run tests", command: "pnpm test" }
        }
      }),
    /INVALID_APPROVAL_REQUEST/
  );
  for (const field of [
    "schema",
    "policy",
    "operation",
    "requestedPermissions",
    "allowedOutcomes",
    "grantScope"
  ]) {
    const request = structuredClone(payload.request);
    delete request[field];
    const error =
      field === "grantScope" ? /APPROVAL_GRANT_SCOPE_UNSUPPORTED/ : /INVALID_APPROVAL_REQUEST/;
    assert.throws(
      () =>
        assertCanonicalEvent({
          protocolVersion: 2,
          type: "interaction.requested",
          payload: { ...payload, request }
        }),
      error,
      field
    );
  }
});
test("provider approval options require string identifiers and kinds", () => {
  const payload = approvalPayload("invoke-provider-options");
  payload.request.grantScope = "provider";
  payload.request.providerDetails = {
    provider: "openclaw",
    method: "exec.approval.resolve",
    options: [
      { optionId: "allow-once", kind: "allow_once" },
      { optionId: "allow-always", kind: "allow_always" },
      { optionId: "deny", kind: "reject_once" }
    ]
  };
  const event = { protocolVersion: 2, type: "interaction.requested", payload };
  assert.doesNotThrow(() => assertCanonicalEvent(event));
  for (const option of [
    { optionId: 42, kind: "allow_once" },
    { optionId: "allow-once", kind: null },
    { optionId: { value: "allow-once" }, kind: "allow_once" },
    { optionId: "allow-once", kind: ["allow_once"] }
  ]) {
    payload.request.providerDetails.options[0] = option;
    assert.throws(() => assertCanonicalEvent(event), /APPROVAL_GRANT_SCOPE_UNSUPPORTED/);
  }
});
test("resolved interactions require instance identity and either an outcome or an invalidation reason", () => {
  const payload = {
    interactionId: "interaction-contract",
    executionInstanceId: "invoke-contract",
    status: "resolved",
    outcome: "accepted"
  };
  for (const field of ["interactionId", "executionInstanceId"]) {
    const incomplete = { ...payload };
    delete incomplete[field];
    assert.throws(
      () =>
        assertCanonicalEvent({
          protocolVersion: 2,
          type: "interaction.resolved",
          payload: incomplete
        }),
      new RegExp(`payload\\.${field}`)
    );
  }
  for (const status of [undefined, "pending", "completed"]) {
    assert.throws(
      () =>
        assertCanonicalEvent({
          protocolVersion: 2,
          type: "interaction.resolved",
          payload: { ...payload, status }
        }),
      /payload\.status is invalid/
    );
  }
  for (const outcome of [undefined, "maybe"]) {
    assert.throws(
      () =>
        assertCanonicalEvent({
          protocolVersion: 2,
          type: "interaction.resolved",
          payload: { ...payload, outcome }
        }),
      /payload\.outcome is invalid/
    );
  }
  for (const status of ["expired", "invalidated"]) {
    assert.throws(
      () =>
        assertCanonicalEvent({
          protocolVersion: 2,
          type: "interaction.resolved",
          payload: { ...payload, status }
        }),
      /payload\.reasonCode/
    );
  }
});
test("analysis exposure defaults closed and public classifications require provenance", () => {
  const legacy = {
    protocolVersion: 2,
    type: "message.delta",
    payload: { channel: "analysis", text: "unclassified" }
  };
  assert.doesNotThrow(() => assertCanonicalEvent(legacy));
  assert.equal(messageExposure(legacy), "unknown");
  const summary = {
    protocolVersion: 2,
    type: "message.delta",
    payload: {
      channel: "analysis",
      text: "Checked the source.",
      exposure: "public_summary",
      provenance: { provider: "codex", nativeEvent: "item/reasoning/summaryTextDelta" }
    }
  };
  assert.doesNotThrow(() => assertCanonicalEvent(summary));
  assert.equal(messageExposure(summary), "public_summary");
  const publicReasoning = {
    protocolVersion: 2,
    type: "message.delta",
    payload: {
      channel: "analysis",
      text: "Inspecting the requested data.",
      exposure: "public_reasoning",
      provenance: { provider: "opencode", nativeEvent: "reasoning" }
    }
  };
  assert.doesNotThrow(() => assertCanonicalEvent(publicReasoning));
  assert.equal(messageExposure(publicReasoning), "public_reasoning");
  assert.throws(
    () =>
      assertCanonicalEvent({
        protocolVersion: 2,
        type: "message.delta",
        payload: { channel: "analysis", text: "unsafe", exposure: "public_summary" }
      }),
    /requires payload\.provenance/
  );
  assert.throws(
    () =>
      assertCanonicalEvent({
        protocolVersion: 2,
        type: "message.delta",
        payload: {
          channel: "analysis",
          text: "unsafe",
          exposure: "public_thought",
          provenance: { provider: "test", nativeEvent: "thought" }
        }
      }),
    /payload\.exposure is invalid/
  );
});
test("canonical message channels distinguish reasoning, progress, and answer content", () => {
  for (const channel of ["analysis", "commentary", "final"]) {
    const payload =
      channel === "analysis"
        ? {
            channel,
            exposure: "public_summary",
            provenance: { provider: "test", nativeEvent: "summary" }
          }
        : { channel };
    assert.doesNotThrow(() =>
      assertCanonicalEvent({ protocolVersion: 2, type: "message.update", payload })
    );
  }
  assert.throws(
    () =>
      assertCanonicalEvent({
        protocolVersion: 2,
        type: "message.update",
        payload: { channel: "provider-specific" }
      }),
    /payload\.channel/
  );
});
test("model step lifecycle requires stable identity and valid timestamps", () => {
  assert.doesNotThrow(() =>
    assertCanonicalEvent({
      protocolVersion: 2,
      type: "model_step.started",
      payload: { stepId: "message-1", startedAtMs: 1788793000000 }
    })
  );
  assert.doesNotThrow(() =>
    assertCanonicalEvent({
      protocolVersion: 2,
      type: "model_step.finished",
      payload: {
        stepId: "message-1",
        status: "completed",
        finishReason: "tool-calls",
        endedAtMs: 1788793002000
      }
    })
  );
  assert.throws(
    () => assertCanonicalEvent({ protocolVersion: 2, type: "model_step.started", payload: {} }),
    /payload\.stepId/
  );
  assert.throws(
    () =>
      assertCanonicalEvent({
        protocolVersion: 2,
        type: "model_step.finished",
        payload: { stepId: "message-1", status: "completed", endedAtMs: -1 }
      }),
    /payload\.endedAtMs/
  );
  assert.throws(
    () =>
      assertCanonicalEvent({
        protocolVersion: 2,
        type: "model_step.finished",
        payload: { stepId: "message-1", status: "completed", publicText: 42 }
      }),
    /payload\.publicText/
  );
});
test("tool call protocol preserves complete and streamed command inputs", () => {
  const codex = {
    protocolVersion: 2,
    type: "tool_call.create",
    payload: {
      status: "running",
      id: "tool-codex",
      name: "exec_command",
      args: { command: "pwd", cwd: "/repo" }
    }
  };
  assert.doesNotThrow(() => assertCanonicalEvent(codex));
  assert.equal(codex.payload.args.command, "pwd");
  const claude = [
    {
      protocolVersion: 2,
      type: "tool_call.create",
      payload: { status: "running", id: "tool-claude", name: "Bash", args: {} }
    },
    {
      protocolVersion: 2,
      type: "tool_call.delta",
      payload: { id: "tool-claude", argsDelta: '{"command":"printf ' }
    },
    {
      protocolVersion: 2,
      type: "tool_call.delta",
      payload: { id: "tool-claude", argsDelta: 'octo-runtime-ok"}' }
    },
    {
      protocolVersion: 2,
      type: "tool_call.update",
      payload: { id: "tool-claude", status: "completed", output: "octo-runtime-ok" }
    }
  ];
  for (const event of claude) assert.doesNotThrow(() => assertCanonicalEvent(event));
  const streamedArgs = claude
    .filter((event) => event.type === "tool_call.delta")
    .map((event) => event.payload.argsDelta)
    .join("");
  assert.equal(JSON.parse(streamedArgs).command, "printf octo-runtime-ok");
});
test("tool call protocol rejects events that cannot reconstruct a command lifecycle", () => {
  assert.throws(
    () =>
      assertCanonicalEvent({
        protocolVersion: 2,
        type: "tool_call.create",
        payload: { status: "running", id: "tool-1", name: "Bash" }
      }),
    /payload\.args must be an object/
  );
  assert.throws(
    () =>
      assertCanonicalEvent({
        protocolVersion: 2,
        type: "tool_call.delta",
        payload: { id: "tool-1" }
      }),
    /requires argsDelta, outputDelta or outputSnapshot/
  );
  assert.throws(
    () =>
      assertCanonicalEvent({
        protocolVersion: 2,
        type: "tool_call.update",
        payload: { id: "tool-1" }
      }),
    /payload\.status must be a non-empty string/
  );
});
test("protocol v2 rejects old roots and validates experience frames", () => {
  assert.throws(
    () => assertCanonicalEvent({ protocolVersion: 1, type: "run.completed", payload: {} }),
    /protocolVersion/
  );
  assert.throws(
    () => assertCanonicalEvent({ protocolVersion: 2, type: "run.finished", payload: {} }),
    /unsupported/
  );
  assert.doesNotThrow(() =>
    assertCanonicalEvent({
      protocolVersion: 2,
      type: "activity.started",
      payload: {
        activityId: "a",
        kind: "thinking",
        source: "provider",
        subject: { type: "run" },
        info: {}
      }
    })
  );
  assert.throws(() =>
    assertCanonicalEvent({
      protocolVersion: 2,
      type: "tool_call.progress",
      payload: { id: "t", progress: { completed: 2, total: 1, unit: "steps" } }
    })
  );
  assert.throws(() =>
    assertCanonicalEvent({
      protocolVersion: 2,
      type: "plan.updated",
      payload: { planId: "p", revision: 0, explanation: null, steps: [] }
    })
  );
  assert.throws(() =>
    assertCanonicalEvent({
      protocolVersion: 2,
      type: "run.notice",
      payload: {
        noticeId: "n",
        code: "retry_scheduled",
        severity: "warning",
        params: { attempt: 2, error: "secret" }
      }
    })
  );
});
