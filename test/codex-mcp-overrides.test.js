import { withAgentEnvItems } from "../packages/octo-runtime-adapter-sdk/dist/index.js";
import assert from "node:assert/strict";
import test from "node:test";
import { createScopedCodexAdapter as createCodexAdapter } from "../test-support/scoped-codex-adapter.mjs";
import { codexAppServerFixture, invokeRequest } from "./runtime-fixture.js";
const context = (servers, envs = {}) => ({
  schema: "octo.context-envelope/v3",
  items: [
    { namespace: "octo.execution", name: "mcp", payload: { mcpServers: servers } },
    {
      namespace: "octo.execution",
      name: "envs",
      payload: {
        env_variables: Object.entries(envs).map(([key, value]) => ({ key, value }))
      }
    }
  ]
});
for (const resume of [false, true]) {
  for (const forwardEnv of [false, true]) {
    test(`Codex only overrides new MCP and necessary env names: resume=${resume}, env=${forwardEnv}`, async () => {
      const config = {
        shell_environment_policy: { set: { EXISTING: "kept" }, include_only: ["PATH"] },
        mcp_servers: {
          local: { command: "node", env_vars: ["EXISTING"], tool_timeout_sec: null, cwd: null },
          http: { url: "https://example.invalid/native", tool_timeout_sec: null },
          disabled: { command: "node", enabled: false },
          remote: { command: "node", experimental_environment: "remote" }
        }
      };
      const original = structuredClone(config);
      const server = codexAppServerFixture({ config });
      const adapter = createCodexAdapter({
        command: process.execPath,
        spawnFn: server.spawnFn,
        env: {}
      });
      const events = [];
      for await (const event of adapter.invoke(
        invokeRequest({
          signal: AbortSignal.timeout(2000),
          ...(resume ? { providerSession: { sessionId: "old-thread" } } : {}),
          agentEnv: withAgentEnvItems(
            context(
              {
                added: {
                  type: "stdio",
                  command: "node",
                  args: ["tool.mjs"],
                  env: { SPECIFIC: "kept" }
                },
                business: {
                  type: "streamable_http",
                  url: "https://example.invalid/run",
                  headers: { Auth: "header-value" }
                }
              },
              forwardEnv ? { RUN_VALUE: "run-value" } : {}
            ),
            [
              {
                namespace: "octo.security",
                name: "approval_policy",
                payload: { mode: "full_access" }
              }
            ]
          )
        })
      )) {
        events.push(event);
        if (event.type === "session.update") server.complete();
      }
      assert.equal(events.at(-1).type, "run.completed");
      const thread = server.writes.find(
        (message) => message.method === (resume ? "thread/resume" : "thread/start")
      );
      const overrides = thread.params.config;
      const { business, ...otherServers } = overrides.mcp_servers;
      assert.deepEqual(otherServers, {
        ...(forwardEnv ? { local: { env: { RUN_VALUE: "run-value" } } } : {}),
        added: {
          command: "node",
          args: ["tool.mjs"],
          env: { ...(forwardEnv ? { RUN_VALUE: "run-value" } : {}), SPECIFIC: "kept" }
        }
      });
      assert.equal(business.url, "https://example.invalid/run");
      assert.equal(business.http_headers.Auth, "header-value");
      assert.doesNotMatch(
        JSON.stringify(server.writes),
        /tool_timeout_sec|experimental_environment/
      );
      assert.equal(
        overrides["shell_environment_policy.set"]?.RUN_VALUE,
        forwardEnv ? "run-value" : undefined
      );
      assert.deepEqual(config, original);
      assert.equal(server.writes.filter((message) => message.method === "config/read").length, 1);
    });
  }
}
const nativeServers = {
  stdio: { command: "node", tool_timeout_sec: null },
  http: { url: "https://example.invalid/native" },
  disabled: { command: "node", enabled: false },
  null_entry: null
};
for (const [name, native] of Object.entries(nativeServers)) {
  for (const type of ["stdio", "streamable_http"]) {
    for (const resume of [false, true]) {
      test(`Codex rejects native MCP name before any thread or prompt: ${name}/${type}/resume=${resume}`, async () => {
        const server = codexAppServerFixture({ config: { mcp_servers: { [name]: native } } });
        const adapter = createCodexAdapter({ command: process.execPath, spawnFn: server.spawnFn });
        const events = [];
        const request = invokeRequest({
          signal: AbortSignal.timeout(2000),
          ...(resume ? { providerSession: { sessionId: "old-thread" } } : {}),
          agentEnv: withAgentEnvItems(
            context({
              [name]:
                type === "stdio"
                  ? { type, command: "node" }
                  : { type, url: "https://example.invalid/new" }
            }),
            []
          )
        });
        for await (const event of adapter.invoke(request)) events.push(event);
        assert.equal(events.at(-1).type, "run.failed");
        assert.equal(events.at(-1).payload.code, "MCP_SERVER_NAME_CONFLICT");
        assert.deepEqual(
          server.writes.filter((message) => message.method).map((message) => message.method),
          ["initialize", "initialized", "config/read"]
        );
      });
    }
  }
}
test("Codex native mode returns the explicit MCP conflict code", async () => {
  const server = codexAppServerFixture({ config: { mcp_servers: nativeServers } });
  const adapter = createCodexAdapter({ command: process.execPath, spawnFn: server.spawnFn });
  await assert.rejects(
    async () => {
      for await (const _ of adapter.invoke(
        invokeRequest({
          signal: AbortSignal.timeout(2000),
          agentEnv: withAgentEnvItems(context({ stdio: { type: "stdio", command: "node" } }), [])
        }),
        { protocolMode: "native" }
      )) {
      }
    },
    { code: "MCP_SERVER_NAME_CONFLICT" }
  );
  assert.equal(
    server.writes.some((message) => /^(thread|turn)\//.test(message.method ?? "")),
    false
  );
});
test("Codex leaves provider configuration untouched without run MCP or env overrides", async () => {
  const server = codexAppServerFixture({ config: { mcp_servers: nativeServers } });
  const adapter = createCodexAdapter({ command: process.execPath, spawnFn: server.spawnFn });
  const events = [];
  for await (const event of adapter.invoke(
    invokeRequest({
      signal: AbortSignal.timeout(2000),
      agentEnv: withAgentEnvItems(undefined, [
        { namespace: "octo.security", name: "approval_policy", payload: { mode: "full_access" } }
      ])
    })
  )) {
    events.push(event);
    if (event.type === "session.update") server.complete();
  }
  assert.equal(events.at(-1).type, "run.completed");
  assert.equal(
    server.writes.some((message) => message.method === "config/read"),
    false
  );
  assert.equal(
    server.writes.find((message) => message.method === "thread/start").params.config,
    undefined
  );
});
