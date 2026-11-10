import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { AgentExecutor } from "../packages/octo-runtime-executor-core/dist/index.js";
import { reportVerificationStartup } from "./verification-startup.mjs";
import { createCliCodexAdapter } from "../apps/cli/dist/codex.js";
import {
  createCliClaudeCodeAdapter,
  createCliKimiCodeAdapter,
  createCliOpenCodeAdapter,
  createCliMcodeAdapter,
  createCliGrokBuildAdapter
} from "../apps/cli/dist/providers.js";

// 脚本复用 CLI 宿主的安装选择与环境快照；同时拥有 Executor 和 Codex owner，依次关闭。
async function createHost() {
  const host = new AgentExecutor();
  const context = { env: { ...process.env } };
  const codex = createCliCodexAdapter({}, context);
  async function shutdown() {
    try {
      return await host.shutdown();
    } finally {
      codex.beginShutdown?.();
      assert.equal((await codex.close(performance.now() + 5000)).complete, true);
    }
  }
  try {
    host.register(codex.adapter);
    for (const factory of [
      createCliClaudeCodeAdapter,
      createCliKimiCodeAdapter,
      createCliOpenCodeAdapter,
      createCliMcodeAdapter,
      createCliGrokBuildAdapter
    ])
      host.register(factory({}, context));
    return { host, shutdown };
  } catch (error) {
    await shutdown();
    throw error;
  }
}

if (process.argv.includes("--check-startup")) {
  const owned = await createHost();
  await reportVerificationStartup(
    { list: () => owned.host.list(), shutdown: owned.shutdown },
    import.meta.url,
    ["codex", "claude-code", "kimi-code", "opencode", "mcode", "grok-build"]
  );
  process.exit(0);
}

// 测试调用方显式选择模式与续接；不让 Runtime 决定产品策略。
const { host, shutdown } = await createHost();
try {
  const workdir = await mkdtemp(join(tmpdir(), "octo-actmode-live-"));
  const results = [];
  for (const type of (process.env.OCTO_ACTMODE_PROVIDERS ?? "codex,claude-code,opencode").split(
    ","
  )) {
    let providerSession;
    for (const mode of ["codex", "grok-build"].includes(type)
      ? ["plan", "default", undefined]
      : ["plan", undefined]) {
      const runId = `actmode_${randomUUID()}`;
      const result = {
        type,
        mode: mode ?? "omitted",
        runId,
        resumed: Boolean(providerSession),
        diagnostics: [],
        text: ""
      };
      try {
        for await (const event of host.invoke(
          {
            inputs: [
              {
                type: "text",
                text: "This is an execution protocol test. Reply exactly MODE_PASS. Do not use any tools, create a plan file, change files, or run commands."
              }
            ],
            agentEnv: {
              schema: "octo.context-envelope/v3",
              items: [
                { namespace: "octo.execution", name: "adapter", payload: { type } },
                {
                  namespace: "octo.execution",
                  name: "workspace",
                  payload: { path: workdir }
                },
                ...(type === "claude-code" && process.env.OCTO_ACTMODE_CC_MODEL
                  ? [
                      {
                        namespace: "octo.execution",
                        name: "model",
                        payload: { selection: { id: process.env.OCTO_ACTMODE_CC_MODEL } }
                      }
                    ]
                  : []),
                ...(mode
                  ? [
                      {
                        namespace: `adapter.${type}`,
                        name: "options",
                        payload:
                          type === "codex"
                            ? { collaborationMode: mode }
                            : type === "claude-code"
                              ? { permissionMode: mode }
                              : { modeId: mode }
                      }
                    ]
                  : [])
              ]
            },
            protocol_mode: "canonical",
            runId,
            ...(providerSession ? { providerSession, continuityMode: "continue" } : {})
          },
          { signal: AbortSignal.timeout(120000) }
        )) {
          if (event.type === "run.notice") result.diagnostics.push(event.payload);
          if (event.type === "session.update" && event.payload.providerSession)
            providerSession = event.payload.providerSession;
          if (event.type === "message.delta" && event.payload.channel !== "analysis")
            result.text += event.payload.text ?? "";
          if (event.type === "interaction.requested")
            throw new Error("Unexpected interaction in tool-free mode test");
          if (["run.completed", "run.failed", "run.cancelled"].includes(event.type)) {
            result.terminal = event.type;
            if (event.type !== "run.completed")
              result.failure = { code: event.payload.code, message: event.payload.message };
          }
        }
        result.providerSessionId = providerSession?.sessionId;
        assert.equal(result.terminal, "run.completed", JSON.stringify(result.failure));
        assert.match(result.text, /MODE_PASS/);
        // 终态和正文只证明执行成功；模式应用需结合所属 Provider 的原生输出核对。
        result.passed = true;
      } catch (error) {
        result.passed = false;
        result.error = error.message;
      }
      results.push(result);
      console.log(JSON.stringify(result));
      if (!result.passed) break;
    }
  }
  const output = resolve(".octospec/tasks/348-351-context-envelope/live-results.json");
  await mkdir(resolve(output, ".."), { recursive: true });
  await writeFile(output, `${JSON.stringify({ workdir, results }, null, 2)}\n`);
  assert.ok(
    results.every((result) => result.passed),
    "One or more real Provider cases failed; inspect recorded results"
  );
} finally {
  assert.equal((await shutdown()).cleanup, "complete");
}
