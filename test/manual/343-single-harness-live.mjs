// Explicit non-gating native acceptance; no model turns or real credentials.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { createManagedCodexEngine } from "../../packages/octo-runtime-adapter-codex/dist/index.js";
import { codexEnvironmentConfig } from "../../packages/octo-runtime-adapter-codex/dist/environment.js";
import { invokeRequest } from "../runtime-fixture.js";
import { withAgentEnvItems } from "../../packages/octo-runtime-adapter-sdk/dist/index.js";
import { startMcpHttpServer } from "../../test-support/mcp/http-server.mjs";

if (!process.argv.includes("--live")) throw new Error("Explicit --live required");
const count = 100;
const home = await mkdtemp(join(tmpdir(), "octo343-native-"));
const http = await startMcpHttpServer();
const script = join(home, "mcp.cjs");
await writeFile(join(home, "config.toml"), "# isolated native acceptance\n");
await writeFile(
  script,
  `const fs=require('node:fs');
fs.writeFileSync(process.argv[2]+'.tmp',JSON.stringify({value:process.env.AGENT_VALUE,own:process.env.MCP_OWN}));
fs.renameSync(process.argv[2]+'.tmp',process.argv[2]);
require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
const m=JSON.parse(line);if(m.id===undefined)return;
const result=m.method==='initialize'?{protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'probe',version:'1'}}:m.method==='tools/list'?{tools:[]}:{};
console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));});`
);
const owner = createManagedCodexEngine({
  codexHome: home,
  env: { ...process.env, NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost" }
});
const leases = [];
let mainError;
let report;
try {
  const values = Array.from({ length: count }, () => randomUUID());
  const runs = await Promise.allSettled(
    values.map(async (value, i) => {
      const cwd = join(home, `agent-${i}`);
      await mkdir(cwd);
      const request = invokeRequest({
        invocationId: randomUUID(),
        runId: randomUUID(),
        agentEnv: withAgentEnvItems(undefined, [
          { namespace: "octo.execution", name: "workspace", payload: { path: cwd } },
          {
            namespace: "octo.execution",
            name: "envs",
            payload: { env_variables: [{ key: "AGENT_VALUE", value }] }
          },
          {
            namespace: "octo.execution",
            name: "mcp",
            payload: {
              mcpServers: {
                http_probe: {
                  type: "streamable_http",
                  url: http.url,
                  headers: { Authorization: "${AGENT_VALUE}" },
                  required: true
                },
                local_probe: {
                  type: "stdio",
                  command: process.execPath,
                  args: [script, join(cwd, "receipt.json")],
                  env: { MCP_OWN: `own-${i}` },
                  required: true
                }
              }
            }
          }
        ])
      });
      const lease = await owner.provider.acquire(request);
      leases.push(lease);
      const pending = new Map();
      lease.channel.onMessage = (m) => {
        const waiter = pending.get(m.id);
        if (!waiter) return;
        pending.delete(m.id);
        clearTimeout(waiter.timer);
        m.error
          ? waiter.reject(
              new Error(`NATIVE_RPC_FAILED: ${waiter.method}: ${JSON.stringify(m.error)}`)
            )
          : waiter.resolve(m.result);
      };
      lease.channel.onFailure = (error) => {
        for (const waiter of pending.values()) {
          clearTimeout(waiter.timer);
          waiter.reject(error);
        }
        pending.clear();
      };
      const rpc = (method, params) =>
        new Promise((resolve, reject) => {
          const id = lease.channel.reserveRequestId();
          const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error(`NATIVE_TIMEOUT: ${method}`));
          }, 30000);
          pending.set(id, { resolve, reject, timer, method });
          lease.channel.write({ id, method, params }, (error) => {
            clearTimeout(timer);
            pending.delete(id);
            reject(error);
          });
        });
      const { config } = await rpc("config/read", { includeLayers: false, cwd });
      const mcp = lease.configuration.mcpServers;
      const overrides = codexEnvironmentConfig(request, { ...config, mcp_servers: mcp });
      const started = await rpc("thread/start", {
        cwd,
        sandbox: "read-only",
        approvalPolicy: "untrusted",
        config: {
          ...overrides,
          mcp_servers: Object.fromEntries(
            Object.entries(mcp).map(([name, server]) => [
              name,
              { ...server, ...overrides.mcp_servers?.[name] }
            ])
          )
        }
      });
      assert.ok(started.thread.id);
      assert.equal(started.thread.cwd, cwd);
    })
  );
  const failures = runs.filter((r) => r.status === "rejected");
  if (failures.length)
    throw new AggregateError(
      failures.map((r) => r.reason),
      "NATIVE_THREADS_FAILED"
    );
  const deadline = performance.now() + 20000;
  let observed = [];
  while (performance.now() < deadline) {
    observed = await Promise.all(
      values.map(async (_, i) => {
        try {
          return JSON.parse(await readFile(join(home, `agent-${i}`, "receipt.json"), "utf8"));
        } catch (error) {
          if (error.code === "ENOENT") return undefined;
          throw error;
        }
      })
    );
    if (
      observed.every(Boolean) &&
      new Set(http.receipts.filter((r) => r.method === "tools/list").map((r) => r.authorization))
        .size === count
    )
      break;
    await delay(50);
  }
  observed.forEach((receipt, i) =>
    assert.deepEqual(receipt, { value: values[i], own: `own-${i}` })
  );
  assert.equal(
    new Set(http.receipts.filter((r) => r.method === "tools/list").map((r) => r.authorization))
      .size,
    count
  );
  assert.equal(owner.processes()[0].incarnation, 1);
  assert.equal(owner.processes().length, 1);
  assert.equal(await readFile(join(home, "config.toml"), "utf8"), "# isolated native acceptance\n");
  report = {
    nativeVersion: execFileSync("codex", ["--version"], { encoding: "utf8" }).trim(),
    concurrentThreads: count,
    appServerSpawns: owner.processes()[0].incarnation,
    pid: owner.processes()[0].pid,
    distinctHttpHeaders: count,
    isolatedStdioEnvironments: count,
    modelTurns: 0
  };
} catch (error) {
  mainError = error;
} finally {
  const results = await Promise.allSettled(leases.map((lease) => lease.channel.close()));
  const cleanup = await owner.close({ deadline: performance.now() + 10000 });
  await http.close();
  const cleanupErrors = results.filter((r) => r.status === "rejected").map((r) => r.reason);
  if (!cleanup.complete) cleanupErrors.push(new Error("OWNER_CLEANUP_INCOMPLETE"));
  if (cleanup.complete) {
    try {
      await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (mainError || cleanupErrors.length)
    throw new AggregateError(
      [...(mainError ? [mainError] : []), ...cleanupErrors],
      "NATIVE_ACCEPTANCE_FAILED"
    );
}
console.log(JSON.stringify({ ...report, ownerCleanup: true }));
