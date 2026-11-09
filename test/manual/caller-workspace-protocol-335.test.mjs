import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import Ajv from "ajv";
import {
  CONTEXT_SCHEMA,
  assertAgentEnv,
  assertContextEnvelope,
  assertFrozenContextPlan,
  assertHostControl,
  assertInvokeRequest,
  assertResolvedExecutionPlan,
  classifyFailure,
  failurePayload
} from "../../packages/octo-runtime-protocol/dist/index.js";

// Explicit manual suite; requires the full workspace build for removed Core export checks.
const root = resolve(import.meta.dirname, "../..");
const schema = JSON.parse(
  await readFile(
    resolve(root, "packages/octo-runtime-protocol/schema/protocol.schema.json"),
    "utf8"
  )
);
const ajv = new Ajv({ strict: false });
ajv.addSchema(schema);
const validator = (name) => ajv.compile({ $ref: `${schema.$id}#/definitions/${name}` });
const envelope = (payload) => ({
  schema: CONTEXT_SCHEMA,
  items: payload === undefined ? [] : [{ namespace: "octo.execution", name: "workspace", payload }]
});
const request = (path = "") => ({
  protocolVersion: 2,
  invocationId: "invocation-335",
  runId: "run-335",
  agentSessionId: "session-335",
  agentSource: "provisioned",
  context: envelope(),
  approvalMode: "ask",
  modelInput: "prompt",
  prompt: "prompt",
  workdir: path,
  agentConfig: {}
});

test("path-only workspace rejects every former mode and empty payload", () => {
  const validate = validator("ContextWorkspacePayload");
  assert.equal(validate({ path: "/caller/prepared" }), true);
  assert.doesNotThrow(() => assertContextEnvelope(envelope({ path: "/caller/prepared" })));
  for (const payload of [
    {},
    { path: "" },
    { mode: "fixed", path: "/caller/prepared" },
    { mode: "random" },
    { mode: "none" },
    { mode: null, path: "/caller/prepared" },
    { mode: "", path: "/caller/prepared" }
  ]) {
    assert.equal(validate(payload), false, JSON.stringify(payload));
    assert.throws(() => assertContextEnvelope(envelope(payload)), /CONTEXT_SCHEMA_INVALID/);
  }
});

test("pure protocol checks represent no cwd override and enforce explicit path agreement", () => {
  const plan = {
    agent_source: "provisioned",
    adapter_type: "codex",
    approval_mode: "ask",
    workdir: ""
  };
  assert.equal(validator("ResolvedExecutionPlan")(plan), true);
  assert.doesNotThrow(() => assertResolvedExecutionPlan(plan));
  assert.doesNotThrow(() => assertInvokeRequest(request()));
  const path = "/caller/prepared";
  const env = { ...envelope({ path }), workdir: path, agentConfig: { workdir: path } };
  assert.doesNotThrow(() => assertAgentEnv(env));
  assert.throws(() => assertAgentEnv({ ...env, workdir: "/other" }), /CONTEXT_PLAN_MISMATCH/);
  assert.throws(
    () => assertAgentEnv({ ...env, agentConfig: { workdir: "/other" } }),
    /CONTEXT_PLAN_MISMATCH/
  );
  assert.throws(
    () => assertInvokeRequest({ ...request(path), context: envelope({ path: "/other" }) }),
    /CONTEXT_PLAN_MISMATCH/
  );
  assert.throws(
    () => assertInvokeRequest({ ...request(path), agentConfig: { workdir: "/other" } }),
    /CONTEXT_PLAN_MISMATCH/
  );
  const context = {
    schema: CONTEXT_SCHEMA,
    items: [
      { namespace: "octo.execution", name: "adapter", payload: { type: "codex" } },
      { namespace: "octo.security", name: "approval_policy", payload: { mode: "ask" } }
    ]
  };
  assert.doesNotThrow(() => assertFrozenContextPlan(context, plan));
  const selected = { ...plan, workdir: path, workspace: { path } };
  const withWorkspace = { ...context, items: [...context.items, ...envelope({ path }).items] };
  assert.doesNotThrow(() => assertFrozenContextPlan(withWorkspace, selected));
  assert.throws(
    () => assertFrozenContextPlan(withWorkspace, { ...selected, workdir: "/other" }),
    /CONTEXT_PLAN_MISMATCH/
  );
  assert.throws(() => assertFrozenContextPlan(context, selected), /CONTEXT_PLAN_MISMATCH/);
});

test("workspace modes disappear from receipt and effective-view Schema", () => {
  const receipt = {
    context_hash: `sha256:${"0".repeat(64)}`,
    run_id: "run-335",
    lease_id: "lease-335",
    fencing_token: 1,
    workspace_path: "/caller/prepared",
    provider_state_dir: "",
    warnings: []
  };
  const validate = validator("ContextPreparationReceipt");
  assert.equal(validate(receipt), true);
  assert.equal(validate({ ...receipt, workspace_mode: "fixed" }), false);
  const execution = schema.definitions.RunContextProjection.properties.execution;
  const validateExecution = ajv.compile(execution);
  assert.equal(validateExecution({ adapter_type: "codex", approval_mode: "ask" }), true);
  assert.equal(
    validateExecution({ adapter_type: "codex", approval_mode: "ask", workspace_mode: "none" }),
    false
  );
});

test("specific workspace reasons win over errno and diagnostic text", () => {
  const context = {
    stage: "execution",
    defaultDomain: "adapter",
    source: { component: "octo-runtime" }
  };
  for (const code of [
    "WORKDIR_REQUIRED",
    "WORKDIR_INVALID",
    "WORKDIR_NOT_FOUND",
    "WORKDIR_NOT_DIRECTORY",
    "WORKDIR_UNAVAILABLE"
  ]) {
    const error = Object.assign(new TypeError("permission denied; command not found"), {
      code,
      cause: { code: "ENOENT" }
    });
    const failure = classifyFailure(error, context);
    assert.equal(failure.code, "OH-ADP-3004");
    assert.equal(failure.reasonCode, code);
    assert.equal(failure.cause.reasonCode, code);
    const payload = failurePayload(error, context);
    assert.equal(payload.code, code);
    assert.equal(payload.failure.reasonCode, code);
    const native = {
      type: "error",
      code,
      message: String(payload.message),
      failure: payload.failure
    };
    assert.doesNotThrow(() => assertHostControl(native));
    assert.equal(validator("HostControl")(native), true);
    assert.throws(
      () =>
        assertHostControl({
          ...native,
          failure: { ...native.failure, reasonCode: "WORKDIR_OTHER" }
        }),
      /HOST_CONTROL_INVALID/
    );
  }
});

test("package declarations reject removed workspace and instruction surfaces", () => {
  execFileSync(
    process.execPath,
    [
      resolve(root, "node_modules/typescript/bin/tsc"),
      "--ignoreConfig",
      "--noEmit",
      "--strict",
      "--skipLibCheck",
      "--target",
      "ES2023",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      resolve(root, "test/manual/fixtures/caller-workspace-types-335.mts")
    ],
    { cwd: root, stdio: "pipe", encoding: "utf8" }
  );
});
