import { withAgentEnvItems } from "../packages/octo-runtime-adapter-sdk/dist/index.js";
import assert from "node:assert/strict";
import test from "node:test";
import { assertInvokeRequest, assertMcpServers } from "@mininglamp-oss/octo-runtime-protocol";
import * as protocol from "@mininglamp-oss/octo-runtime-protocol";
import * as browserProtocol from "../packages/octo-runtime-protocol/dist/browser.js";
const baseRequest = {
  protocolVersion: 2,
  invocationId: "invoke-1",
  agentSessionId: "session-1",
  runId: "run-1",
  prompt: "work",
  modelInput: "work",
  agentEnv: withAgentEnvItems({ schema: "octo.context-envelope/v3", items: [] }, [
    { namespace: "octo.execution", name: "workspace", payload: { path: "/workspace" } },
    { namespace: "octo.security", name: "approval_policy", payload: { mode: "full_access" } },
    { namespace: "octo.execution", name: "agent", payload: { source: "provisioned" } }
  ])
};
test("local transports validate while remote execution cannot configure MCP", () => {
  const mcpServers = {
    local: {
      type: "stdio",
      command: "node",
      args: ["server.mjs"],
      env: { MODE: "test" },
      cwd: "/workspace",
      required: true,
      startupTimeoutMs: 10000,
      toolTimeoutMs: 60000
    },
    remote: {
      type: "streamable_http",
      url: "https://mcp.example.test/rpc",
      headers: { Authorization: "Bearer run-scoped-value" }
    }
  };
  assert.doesNotThrow(() => assertMcpServers(mcpServers));
  assert.throws(() => assertInvokeRequest({ ...baseRequest, mcpServers }), /unknown field/);
  for (const [key, value] of [
    ["skills", []],
    ["skillRoots", []],
    ["providerStateDir", "/tmp"]
  ]) {
    assert.throws(() => assertInvokeRequest({ ...baseRequest, [key]: value }), /unknown field/);
  }
});
test("Node and browser protocol exports contain no Adapter feature catalogue", () => {
  for (const exported of [protocol, browserProtocol]) {
    assert.equal(Object.hasOwn(exported, "executionFeatures"), false);
    assert.equal(Object.hasOwn(exported, "adapterApprovalModes"), false);
  }
});
test("dynamic MCP contract rejects unknown transports, fields, names, and malformed URLs", () => {
  const invalid = [
    { bad: { type: "sse", url: "https://mcp.example.test" } },
    { bad: { type: "stdio", command: "node", token: "must-not-pass" } },
    { "bad/name": { type: "stdio", command: "node" } },
    { bad: { type: "streamable_http", url: "file:///tmp/socket" } },
    { bad: { type: "streamable_http", url: "not-a-url" } },
    { bad: { type: "stdio", command: "" } },
    { bad: { type: "stdio", command: "node", args: ["ok", 1] } }
  ];
  for (const value of invalid) assert.throws(() => assertMcpServers(value), TypeError);
});
test("InvokeRequest accepts the mandatory new contract when dynamic MCP is absent", () => {
  assert.doesNotThrow(() => assertInvokeRequest(baseRequest));
});
test("InvokeRequest without dynamic MCP rejects legacy contracts and missing mandatory inputs", () => {
  assert.throws(
    () => assertInvokeRequest({ ...baseRequest, appendInstructions: "" }),
    /LEGACY_RUN_CONTRACT_REJECTED/
  );
  assert.throws(() => assertInvokeRequest({ ...baseRequest, context: {} }), /unknown field/);
  for (const [field, reason] of [
    ["agentEnv", /CONTEXT_REQUIRED/],
    ["modelInput", /modelInput must be a non-empty string/]
  ]) {
    const incomplete = { ...baseRequest };
    delete incomplete[field];
    assert.throws(() => assertInvokeRequest(incomplete), reason);
  }
});
