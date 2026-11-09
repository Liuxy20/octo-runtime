import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentExecutor, prepareInvokeInput } from "@mininglamp-oss/octo-runtime/executor-core";
import { withAgentEnvItems } from "@mininglamp-oss/octo-runtime/adapter-sdk";
import { createOpenCodeAdapter } from "@mininglamp-oss/octo-runtime-adapter-opencode";
import { createGrokBuildAdapter } from "@mininglamp-oss/octo-runtime-adapter-grok-build";
import {
  createCodexAdapter,
  createManagedCodexEngine
} from "@mininglamp-oss/octo-runtime-adapter-codex";

// 手动专项直接使用实际 Harness，不依赖会补配置的通用测试 builder。
const item = (namespace, name, payload) => ({ namespace, name, payload });
const input = (type, extra = []) => ({
  inputs: [{ type: "text", text: "hello" }],
  agentEnv: withAgentEnvItems(
    withAgentEnvItems(undefined, [
      item("octo.execution", "adapter", { type }),
      item("octo.execution", "workspace", { path: process.cwd() }),
      item("octo.security", "approval_policy", { mode: "full_access" })
    ]),
    extra
  ),
  protocol_mode: "canonical",
  invocationId: randomUUID(),
  runId: randomUUID(),
  sessionId: randomUUID()
});

for (const name of [
  "antigravity",
  "claude-code",
  "codebuddy",
  "codex",
  "dsh",
  "grok-build",
  "hermes",
  "kimi-code",
  "mcode",
  "openclaw",
  "opencode",
  "qodercli",
  "qoderclicn"
]) {
  test(`${name}: each defaultAgentEnv read owns its complete object graph`, async (t) => {
    let adapter;
    if (name === "codex") {
      const owner = createManagedCodexEngine({ codexHome: process.cwd() });
      t.after(async () => {
        assert.equal((await owner.close({ deadline: performance.now() + 1000 })).complete, true);
      });
      adapter = createCodexAdapter({ engine: owner.provider });
    } else {
      ({ default: adapter } = await import(`@mininglamp-oss/octo-runtime-adapter-${name}`));
    }
    const first = adapter.defaultAgentEnv;
    const original = structuredClone(first);
    first.items[0].payload.type = "mutated";
    first.items.push(item("host.private", "extra", { nested: [false] }));
    const second = adapter.defaultAgentEnv;
    assert.notStrictEqual(first, second);
    assert.deepEqual(second, original);
    second.items[0].payload.type = "another mutation";
    assert.deepEqual(adapter.defaultAgentEnv, original);
  });
}

async function assertPreparationFailure(adapter, value, pattern) {
  const host = new AgentExecutor();
  host.register(adapter);
  try {
    const events = await Array.fromAsync(host.invoke(value));
    assert.equal(events.at(-1).type, "run.failed");
    assert.match(JSON.stringify(events.at(-1).payload), pattern);
  } finally {
    assert.equal((await host.shutdown()).cleanup, "complete");
  }
}

test("OpenCode rejects missing cwd before a version probe and confirms cleanup", async () => {
  await assertPreparationFailure(
    createOpenCodeAdapter({ command: process.execPath }),
    input("opencode", [
      item("octo.execution", "workspace", {
        path: join(tmpdir(), `octo-missing-341-${randomUUID()}`)
      })
    ]),
    /WORKDIR_NOT_FOUND/
  );
});

test("OpenCode rejects malformed private configuration before a version probe", async () => {
  await assertPreparationFailure(
    createOpenCodeAdapter({ command: process.execPath }),
    input("opencode", [
      item("octo.execution", "envs", {
        env_variables: [{ key: "OPENCODE_CONFIG_CONTENT", value: "invalid JSON" }]
      })
    ]),
    /OPENCODE_CONFIG_INVALID/
  );
});

for (const [name, options, pattern] of [
  [
    "sandbox",
    item("adapter.grok-build", "options", { sandbox: "workspace-write" }),
    /SANDBOX_UNSUPPORTED/
  ],
  [
    "MCP literal",
    item("octo.execution", "mcp", {
      mcpServers: { literal: { type: "stdio", command: "echo", args: ["$${LITERAL}"] } }
    }),
    /MCP_LITERAL_UNSUPPORTED/
  ]
]) {
  test(`Grok rejects ${name} before Provider allocation and confirms cleanup`, async () => {
    let spawns = 0;
    const adapter = createGrokBuildAdapter({
      acpClientFactory() {
        spawns++;
        throw new Error("must not allocate Provider");
      }
    });
    await assertPreparationFailure(adapter, input("grok-build", [options]), pattern);
    assert.equal(spawns, 0);
  });
}

test("Grok preserves inner SDK preparation evidence while sanitizing errors", async () => {
  let spawns = 0;
  const adapter = createGrokBuildAdapter({
    acpClientFactory() {
      spawns++;
      throw new Error("must not allocate Provider");
    }
  });
  await assertPreparationFailure(
    adapter,
    input("grok-build", [item("octo.execution", "agent", { source: "preset" })]),
    /AGENT_SOURCE_UNSUPPORTED/
  );
  assert.equal(spawns, 0);
});

test(
  "OpenCode configures budgets before its probe and emits reasoning notice once",
  {
    skip: process.platform === "win32" ? "POSIX executable fixture" : false
  },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "octo-preparation-341-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const command = join(directory, "opencode");
    const configured = join(directory, "configured");
    await writeFile(
      command,
      `#!${process.execPath}
if(process.argv[2]==="--version"){
 if(!require("node:fs").existsSync(${JSON.stringify(configured)}))process.exit(1);
 console.log("opencode v2.1.3");process.exit(0);
}
process.stdin.resume();process.stdin.on("end",()=>{
 console.log(JSON.stringify({type:"text",sessionID:"ses_341",part:{type:"text",id:"text",text:"ok"}}));
 console.log(JSON.stringify({type:"step_finish",part:{type:"step-finish",reason:"stop"}}));
});`,
      { mode: 0o755 }
    );
    const value = input("opencode", [
      item("octo.execution", "model", { reasoning: { effort: "xhigh" } }),
      item("octo.execution", "limits", { run_timeout_ms: 1000 })
    ]);
    const configurations = [];
    const events = await Array.fromAsync(
      createOpenCodeAdapter({ command }).invoke(prepareInvokeInput(value).request, {
        configureRuntimeLimits(limits) {
          configurations.push(structuredClone(limits));
          writeFileSync(configured, "configured");
        }
      })
    );
    assert.equal(events.at(-1).type, "run.completed");
    assert.equal(configurations.length, 2);
    assert.equal(configurations[0].runTimeoutMs, 1000);
    assert.deepEqual(configurations[0], configurations[1]);
    assert.equal(
      events.filter(
        (event) =>
          event.type === "run.notice" &&
          event.payload.params?.warningCode === "REASONING_EFFORT_NOT_APPLIED"
      ).length,
      1
    );
  }
);
