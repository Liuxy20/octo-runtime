import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import {
  contextHash,
  resolveContextConfiguration
} from "../packages/octo-runtime-protocol/dist/index.js";
import { resolveLocalContext } from "../packages/octo-runtime-executor-core/dist/context.js";
import {
  assertFrozenContextPlan,
  contextControlInstructions
} from "../packages/octo-runtime-protocol/dist/index.js";
import { renderModelContexts } from "../packages/octo-runtime-executor-core/dist/model-input.js";
import {
  createJsonCliAdapter,
  invocationEnvironment,
  invocationEnvs,
  spawnJsonLines
} from "../packages/octo-runtime-adapter-sdk/dist/index.js";
import { buildCodexCommand } from "../packages/octo-runtime-adapter-codex/dist/index.js";
import { codexEnvironmentConfig } from "../packages/octo-runtime-adapter-codex/dist/environment.js";
import { buildZcodeCommand } from "../packages/octo-runtime-adapter-zcode-gui/dist/index.js";
import { buildOpenClawGatewayInvocation } from "../packages/octo-runtime-adapter-openclaw/dist/index.js";
import { invokeRequest } from "./runtime-fixture.js";

const envPayload = (values) => ({
  env_variables: Object.entries(values).map(([key, value]) => ({ key, value }))
});
const envContext = (values) => ({
  schema: "octo.context-envelope/v3",
  items: [{ namespace: "octo.execution", name: "envs", payload: envPayload(values) }]
});
const request = (envs) => invokeRequest({ context: envContext(envs) });

for (const platform of ["win32", "linux"]) {
  test(`${platform} environment identity respects every precedence layer without mutation`, (t) => {
    const original = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { ...original, value: platform });
    t.after(() => Object.defineProperty(process, "platform", original));
    const inherited = { PATH: "inherited", Empty: "base" };
    const run = request({ path: "context" });
    run.executionEnvOverrides = envPayload({ PaTh: "execution", empty: "" });
    const before = structuredClone(run);
    const envs = invocationEnvs(run);
    const merged = invocationEnvironment(run, { pAtH: "adapter" }, inherited);
    assert.deepEqual(run, before);
    assert.deepEqual(inherited, { PATH: "inherited", Empty: "base" });
    if (platform === "win32") {
      assert.deepEqual(envs, { PaTh: "execution", empty: "" });
      assert.deepEqual(merged, { pAtH: "adapter", empty: "" });
      merged.pAtH = "changed";
      assert.equal(invocationEnvironment(run, {}, inherited).PaTh, "execution");
    } else {
      assert.deepEqual(merged, {
        PATH: "inherited",
        Empty: "base",
        path: "context",
        PaTh: "execution",
        empty: "",
        pAtH: "adapter"
      });
    }
  });
}

test(
  "Windows child receives mixed-case invocation override after the final spawn merge",
  {
    skip: process.platform !== "win32"
  },
  async () => {
    const env = invocationEnvironment(request({ path: "run-path" }), {}, { PATH: "parent-path" });
    const direct = spawnSync(process.execPath, ["-p", "process.env.PATH"], {
      env,
      encoding: "utf8"
    });
    assert.equal(direct.status, 0, direct.stderr);
    assert.equal(direct.stdout.trim(), "run-path");
    const run = async (value) =>
      Array.fromAsync(
        spawnJsonLines({
          command: process.execPath,
          args: ["-e", "console.log(JSON.stringify({path:process.env.PATH}))"],
          env: invocationEnvironment(request({ path: value })),
          parseLine: JSON.parse
        })
      );
    assert.deepEqual(await Promise.all([run("left-path"), run("right-path")]), [
      [{ path: "left-path" }],
      [{ path: "right-path" }]
    ]);
  }
);

test("envs freezes into local execution plan without becoming prompt or instructions", () => {
  const defaults = {
    schema: "octo.context-envelope/v3",
    items: [
      { namespace: "octo.execution", name: "adapter", payload: { type: "codex" } },
      {
        namespace: "octo.execution",
        name: "workspace",
        payload: { mode: "fixed", path: process.cwd() }
      }
    ]
  };
  const { effectiveContext, resolvedExecutionPlan } = resolveLocalContext(
    defaults,
    envContext({ ARBITRARY: "private-test-value" }),
    "provisioned"
  );
  assert.deepEqual(resolvedExecutionPlan.envs, envPayload({ ARBITRARY: "private-test-value" }));
  assertFrozenContextPlan(effectiveContext, resolvedExecutionPlan);
  for (const envs of [
    undefined,
    { ARBITRARY: "different" },
    { ARBITRARY: "private-test-value", EXTRA: "v" }
  ]) {
    const changed = {
      ...resolvedExecutionPlan,
      ...(envs === undefined ? {} : { envs: envPayload(envs) })
    };
    if (envs === undefined) delete changed.envs;
    assert.throws(
      () => assertFrozenContextPlan(effectiveContext, changed),
      /CONTEXT_PLAN_MISMATCH/
    );
  }
  assert.equal(renderModelContexts(effectiveContext), "");
  assert.equal(contextControlInstructions(effectiveContext), "");
  assert.notEqual(contextHash(envContext({ A: "1" })), contextHash(envContext({ A: "2" })));
});

test("mandatory matches list entries by key, including prototype-like names", () => {
  const payload = JSON.parse('{"__proto__":"literal","constructor":"literal"}');
  const result = resolveContextConfiguration(
    { defaults: envContext({ A: "base" }), mandatory: envContext(payload) },
    envContext({})
  );
  assert.deepEqual(result.items[0].payload, envPayload({ A: "base", ...payload }));
  assert.deepEqual(
    resolveContextConfiguration(
      { defaults: envContext({}), mandatory: envContext({ toString: "locked" }) },
      envContext({})
    ).items[0].payload,
    envPayload({ toString: "locked" })
  );
});

test("per-run environment preserves empty/literal values and adapter-owned overrides", () => {
  const base = { BASE: "parent", A: "parent" };
  const env = invocationEnvironment(
    request({ A: "run", EMPTY: "", LITERAL: "${BASE}" }),
    { INTERNAL: "fixed" },
    base
  );
  assert.deepEqual(env, {
    BASE: "parent",
    A: "run",
    EMPTY: "",
    LITERAL: "${BASE}",
    INTERNAL: "fixed"
  });
  assert.equal(
    invocationEnvironment(request({ INTERNAL: "run" }), { INTERNAL: "fixed" }, {}).INTERNAL,
    "fixed"
  );
  assert.deepEqual(base, { BASE: "parent", A: "parent" });
  assert.equal(
    buildCodexCommand(request({ OCTO_ENVS_TEST: "codex" }), process.execPath, [], {}).env
      .OCTO_ENVS_TEST,
    "codex"
  );
  assert.equal(
    buildZcodeCommand(request({ OCTO_ENVS_TEST: "zcode" }), process.execPath).env.OCTO_ENVS_TEST,
    "zcode"
  );
});

test("concurrent CLI invocations and their child tools inherit isolated envs", async () => {
  const key = "OCTO_ENVS_ISOLATION_TEST";
  const previous = process.env[key];
  const child = `process.stdout.write(JSON.stringify({value:process.env.${key}}))`;
  const source = `const {execFileSync}=require('node:child_process'); console.log(execFileSync(process.execPath,['-e',${JSON.stringify(child)}],{encoding:'utf8'}));`;
  const adapter = createJsonCliAdapter({
    metadata: { type: "env-test", agentSources: ["provisioned"] },
    buildCommand: () => ({ command: process.execPath, args: ["-e", source] }),
    normalize: (native) => [
      { protocolVersion: 2, type: "run.completed", payload: { result: native.value } }
    ]
  });
  const run = async (value) => {
    const events = [];
    for await (const event of adapter.invoke(request({ [key]: value }))) events.push(event);
    return events.at(-1).payload.result;
  };
  assert.deepEqual(await Promise.all([run("private-left-123"), run("private-right-456")]), [
    "private-left-123",
    "private-right-456"
  ]);
  assert.equal(process.env[key], previous);
});

test("Codex whitelists env names for local MCP and supplies shell env without changing other policies", () => {
  const config = {
    shell_environment_policy: { set: { EXISTING: "kept" }, include_only: ["PATH"] },
    mcp_servers: {
      "local.mcp": { command: "node", env_vars: ["EXISTING"], env: { A: "server" } },
      http: { url: "https://example.invalid/mcp" },
      disabled: { command: "node", enabled: false },
      remote: { command: "node", experimental_environment: "remote" }
    }
  };
  const original = structuredClone(config);
  assert.deepEqual(codexEnvironmentConfig(request({ A: "run" }), config), {
    "shell_environment_policy.set": { EXISTING: "kept", A: "run" },
    "shell_environment_policy.include_only": ["PATH", "A"],
    mcp_servers: { "local.mcp": { env_vars: ["EXISTING", "A"] } }
  });
  assert.deepEqual(config, original);
  assert.deepEqual(codexEnvironmentConfig(request({}), config), {});
});
