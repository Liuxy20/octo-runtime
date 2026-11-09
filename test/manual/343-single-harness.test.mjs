// Explicit manual validation only: node --test test/manual/343-single-harness.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  createCodexAdapter,
  createManagedCodexEngine
} from "../../packages/octo-runtime-adapter-codex/dist/index.js";
import { loadCliAdapters } from "../../apps/cli/dist/adapters.js";
import { invokeRequest } from "../runtime-fixture.js";
import { withAgentEnvItems } from "../../packages/octo-runtime-adapter-sdk/dist/index.js";

const fixture = fileURLToPath(new URL("./fixtures/codex-single-343.mjs", import.meta.url));
const request = (extra = {}) =>
  invokeRequest({
    invocationId: randomUUID(),
    runId: randomUUID(),
    modelInput: "hello",
    ...extra,
    agentEnv: withAgentEnvItems(
      withAgentEnvItems(undefined, [
        { namespace: "octo.execution", name: "workspace", payload: { path: process.cwd() } },
        { namespace: "octo.security", name: "approval_policy", payload: { mode: "full_access" } }
      ]),
      extra.agentEnv?.items ?? []
    )
  });
async function setup(t, count = 1, options = {}) {
  const home = await mkdtemp(join(tmpdir(), "octo343-"));
  const log = join(home, "rpc.ndjson");
  const launches = [];
  const owner = createManagedCodexEngine({
    codexHome: home,
    command: process.execPath,
    appServerArgs: [fixture, log, String(count)],
    env: { ...process.env },
    spawnFn(command, args, spec) {
      launches.push({ command, args, spec });
      return spawn(command, args, { ...spec, stdio: ["pipe", "pipe", "pipe"] });
    },
    ...options
  });
  const scope = createCodexAdapter({ engine: owner.provider }).createExecutionScope({
    log: () => {}
  });
  t.after(async () => {
    await scope.close({ deadline: performance.now() + 2000 });
    assert.equal((await owner.close({ deadline: performance.now() + 2500 })).complete, true);
    await rm(home, { recursive: true, force: true });
  });
  return { home, log, owner, scope, launches };
}

test("a missing CODEX_HOME does not become the app-server startup cwd", async (t) => {
  const codexHome = join(tmpdir(), `octo343-absent-${randomUUID()}`);
  await assert.rejects(stat(codexHome), { code: "ENOENT" });
  const { owner, scope, launches } = await setup(t, 1, { codexHome });
  const events = await Array.fromAsync(scope.invoke(request(), { protocolMode: "canonical" }));
  assert.equal(events.at(-1).type, "run.completed");
  assert.equal(launches.length, 1);
  assert.equal(Object.hasOwn(launches[0].spec, "cwd"), false);
  assert.equal(launches[0].spec.env.CODEX_HOME, codexHome);
  assert.equal(owner.provider.codexHome, codexHome);
  // fake Provider 不管理数据目录，验证 Runtime 没有用创建目录掩盖 spawn 前提错误。
  await assert.rejects(stat(codexHome), { code: "ENOENT" });
});

test(
  "100 simultaneously active agents with distinct workdirs/configs share one PID",
  { timeout: 20000 },
  async (t) => {
    const { home, log, owner, scope, launches } = await setup(t, 100);
    const requests = await Promise.all(
      Array.from({ length: 100 }, async (_, i) => {
        const cwd = join(home, `agent-${i}`);
        await mkdir(cwd);
        return request({
          modelInput: `command-${i}`,
          runMetadata: {
            contextCapacity: {
              management: "provider_native",
              contextWindow: 8192 + i,
              outputReserveTokens: 1024
            }
          },
          agentEnv: withAgentEnvItems(undefined, [
            { namespace: "octo.execution", name: "workspace", payload: { path: cwd } },
            {
              namespace: "octo.execution",
              name: "model",
              payload: { selection: { id: `model-${i}` } }
            },
            {
              namespace: "octo.execution",
              name: "envs",
              payload: {
                env_variables: [
                  { key: "AGENT_VALUE", value: randomUUID() },
                  { key: "MCP_OWN", value: "run" }
                ]
              }
            },
            {
              namespace: "octo.execution",
              name: "mcp",
              payload: {
                mcpServers: {
                  business: {
                    type: "streamable_http",
                    url: "https://example.invalid/mcp",
                    headers: { Authorization: "${AGENT_VALUE}" }
                  },
                  local: {
                    type: "stdio",
                    command: process.execPath,
                    env: { MCP_OWN: `own-${i}` }
                  }
                }
              }
            }
          ])
        });
      })
    );
    const outputs = await Promise.all(
      requests.map((req, i) =>
        Array.fromAsync(
          scope.invoke(req, {
            protocolMode: "canonical",
            streamLimits: { rawMessageMaxBytes: 1024 * 1024 + i }
          })
        )
      )
    );
    assert.equal(launches.length, 1);
    assert.equal(owner.processes().length, 1);
    assert.equal(owner.processes()[0].state, "ready");
    assert.equal(Object.hasOwn(launches[0].spec, "cwd"), false);
    assert.equal(launches[0].spec.env.AGENT_VALUE, undefined);
    assert.equal(launches[0].args.includes("-c"), false);
    assert.ok(outputs.every((events) => events.at(-1).type === "run.completed"));
    for (let i = 0; i < outputs.length; i++) {
      assert.deepEqual(
        outputs[i]
          .filter(
            (event) => event.type === "message.update" && event.payload.status === "completed"
          )
          .map((event) => event.payload.text),
        [`command-${i}`]
      );
    }
    const messages = (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
    assert.equal(messages.filter((m) => m.method === "initialize").length, 1);
    const starts = messages.filter((m) => m.method === "turn/start");
    const firstUnsubscribe = messages.findIndex((m) => m.method === "thread/unsubscribe");
    assert.equal(starts.length, 100);
    // The provider barrier does not finish any turn until all 100 turn/start calls arrive.
    assert.equal(
      messages.slice(0, firstUnsubscribe).filter((m) => m.method === "turn/start").length,
      100
    );
    assert.equal(new Set(starts.map((m) => m.params.threadId)).size, 100);
    for (const { params } of messages.filter((m) => m.method === "thread/start")) {
      const i = Number(params.cwd.split("agent-").at(-1));
      const value = requests[i].agentEnv.items.find((item) => item.name === "envs").payload
        .env_variables[0].value;
      assert.equal(params.model, `model-${i}`);
      assert.equal(params.config.model_context_window, 8192 + i);
      assert.equal(params.config["shell_environment_policy.set"].AGENT_VALUE, value);
      assert.equal(params.config.mcp_servers.business.http_headers.Authorization, value);
      assert.equal(params.config.mcp_servers.local.env.MCP_OWN, `own-${i}`);
      assert.equal(params.config.mcp_servers.native.env.MCP_OWN, "native");
      assert.equal(params.config.mcp_servers.native.env.AGENT_VALUE, value);
    }
  }
);

test("unclaimed early notifications are discarded after their last possible thread-start reply", async (t) => {
  const { scope, log, launches } = await setup(t, 1, {
    env: { ...process.env, OCTO_343_ROUTE_PROBE: "1" }
  });
  for (let i = 0; i < 2; i++) {
    const events = await Array.fromAsync(scope.invoke(request()));
    assert.equal(
      events.at(-1).type,
      "run.completed",
      `invocation ${i}: ${JSON.stringify(events.at(-1))}`
    );
  }
  const messages = (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(messages.find((m) => m.id === "orphan-request")?.error?.code, -32000);
  assert.equal(launches.length, 1);
});

test("concurrent lease acquisition has no local agent-count or estimated-byte admission limit", async (t) => {
  const { owner, launches } = await setup(t);
  const leases = await Promise.all(
    Array.from({ length: 2200 }, () => owner.provider.acquire(request()))
  );
  assert.equal(leases.length, 2200);
  await Promise.all(leases.map((lease) => lease.channel.close()));
  assert.equal(launches.length, 1);
});

test("concurrent approval replies stay on their own thread and owner", async (t) => {
  const { scope, launches } = await setup(t, 100);
  const events = await Promise.all(
    Array.from({ length: 100 }, (_, i) => {
      const req = request({
        modelInput: `approval-${i}`,
        agentEnv: withAgentEnvItems(undefined, [
          { namespace: "octo.security", name: "approval_policy", payload: { mode: "ask" } }
        ])
      });
      return Array.fromAsync(scope.invoke(req), async (event) => {
        if (event.type === "interaction.requested") {
          await assert.rejects(
            scope.respondInteraction("wrong-owner", {
              interactionId: event.payload.interactionId,
              outcome: "accepted"
            }),
            /INTERACTION_NOT_ACTIVE/
          );
          await scope.respondInteraction(req.invocationId, {
            interactionId: event.payload.interactionId,
            outcome: "accepted"
          });
        }
        return event;
      });
    })
  );
  assert.ok(events.every((frames) => frames.at(-1).type === "run.completed"));
  assert.equal(launches.length, 1);
});

test("CLI rejects duplicate declared harness types before any factory invocation", async (t) => {
  const { home } = await setup(t);
  const module = join(home, "factory.mjs");
  const marker = join(home, "called");
  await writeFile(
    module,
    `import {writeFileSync} from 'node:fs';export function factory(){writeFileSync(${JSON.stringify(marker)},'called');throw Error('FACTORY_MUST_NOT_RUN');}`
  );
  const entry = {
    type: "fixture",
    module,
    export: "factory",
    factory: true,
    options: {},
    sourceManifest: join(home, "manifest.json")
  };
  await assert.rejects(loadCliAdapters([entry, entry]), (error) => {
    assert.match(String(error.cause ?? error), /CLI_HARNESS_TYPE_DUPLICATE/);
    return true;
  });
  await assert.rejects(readFile(marker), { code: "ENOENT" });
});

test(
  "cancelling 100 active turns does not overflow a fixed-eight control queue",
  { timeout: 10000 },
  async (t) => {
    const { scope, launches, owner } = await setup(t, 100);
    const controllers = Array.from({ length: 100 }, () => new AbortController());
    let started = 0;
    const events = await Promise.all(
      controllers.map((controller) =>
        Array.fromAsync(
          scope.invoke(
            request({
              modelInput: "hang",
              signal: controller.signal
            })
          ),
          (event) => {
            if (event.type === "session.update" && ++started === 100)
              controllers.forEach((value) => value.abort("batch-cancel"));
            return event;
          }
        )
      )
    );
    assert.equal(started, 100);
    assert.ok(events.every((frames) => frames.at(-1).type === "run.cancelled"));
    assert.equal(launches.length, 1);
    assert.equal(owner.processes()[0].state, "ready");
  }
);

test("explicitly separate owners use separate instances", async (t) => {
  const a = await setup(t),
    b = await setup(t);
  await Promise.all([a, b].map(({ scope }) => Array.fromAsync(scope.invoke(request()))));
  assert.notEqual(a.owner.processes()[0].pid, b.owner.processes()[0].pid);
});
