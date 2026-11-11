import {
  withAgentEnvItems,
  assertAdapterAgentEnv
} from "../../packages/octo-runtime-adapter-sdk/dist/index.js";
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
  assertHostControl,
  assertInvokeRequest,
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
  modelInput: "prompt",
  prompt: "prompt",
  agentEnv: withAgentEnvItems(envelope(), [
    { namespace: "octo.execution", name: "workspace", payload: { path: path } },
    { namespace: "octo.security", name: "approval_policy", payload: { mode: "ask" } }
  ])
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
    if (payload.path !== "")
      assert.throws(
        () => assertAdapterAgentEnv({ ...request(), agentEnv: envelope(payload) }),
        /WORKDIR_INVALID/
      );
  }
});
test("AgentEnv has one workspace item and no duplicate path entrance", () => {
  const env = envelope({ path: "/caller/prepared" });
  assert.doesNotThrow(() => assertAgentEnv(env));
  assert.doesNotThrow(() => assertInvokeRequest({ ...request(), agentEnv: env }));
  assert.throws(() => assertAgentEnv({ ...env, workdir: "/other" }), /CONTEXT_SCHEMA_INVALID/);
  assert.throws(() => assertInvokeRequest({ ...request(), workdir: "/other" }), /unknown field/);
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
