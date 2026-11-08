import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lstat, mkdtemp, open, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { reportVerificationStartup } from "./verification-startup.mjs";

const endpoint = "https://im.deepminer.com.cn/";

// endpoint 子命令不加载执行器；真实执行与离线检查复用此 Core 装配，调用方负责 shutdown。
async function createHost() {
  const { AgentExecutor } = await import("../packages/octo-runtime-executor-core/dist/index.js");
  const { default: codex } = await import("../packages/octo-runtime-adapter-codex/dist/index.js");
  const host = new AgentExecutor();
  host.register(codex);
  return host;
}

const args = process.argv.slice(2);
const checkStartup = args.includes("--check-startup");
assert.ok(
  !(checkStartup && args.includes("--check-endpoint")),
  "QA_STARTUP_ENDPOINT_CONFLICT: choose startup or endpoint verification"
);
assert.ok(
  args.length === 0 ||
    (args.length === 1 && args[0] === "--check-startup") ||
    (args.length === 2 && args[0] === "--check-endpoint" && !args[1].startsWith("--")),
  "QA_FORWARDING_ARGS: expected no arguments, --check-startup, or --check-endpoint <receiptPath>"
);
if (checkStartup) {
  await reportVerificationStartup(await createHost(), import.meta.url, ["codex"]);
  process.exit(0);
}

// The native tool performs one fixed, read-only request; no credentials are used.
if (args[0] === "--check-endpoint") {
  // 父进程创建私有临时目录并将其设为工具 cwd；子命令只可新建其中固定的回执。
  const receiptPath = args[1];
  const directory = await realpath(process.cwd());
  const temporaryRoot = await realpath(tmpdir());
  const metadata = await lstat(directory);
  assert.ok(
    isAbsolute(receiptPath) &&
      receiptPath === join(directory, "receipt.json") &&
      dirname(directory) === temporaryRoot &&
      /^octo-codex-forwarding-[A-Za-z0-9]+$/.test(basename(directory)) &&
      metadata.isDirectory() &&
      (process.platform === "win32" ||
        ((metadata.mode & 0o077) === 0 && metadata.uid === process.getuid())),
    "QA_FORWARDING_RECEIPT: expected receipt.json in the caller's private forwarding temporary cwd"
  );
  // 先独占打开回执，再联网；已有文件/符号链接均失败，错误路径不能触发请求。
  const receiptFile = await open(receiptPath, "wx", 0o600);
  try {
    const response = await fetch(endpoint, {
      signal: AbortSignal.timeout(15000),
      redirect: "error"
    });
    assert.equal(response.status, 200);
    await response.body?.cancel();
    const receipt = { endpoint, status: response.status, marker: `FORWARDING_${randomUUID()}` };
    await receiptFile.writeFile(JSON.stringify(receipt));
    console.log(receipt.marker);
  } finally {
    await receiptFile.close();
  }
} else {
  const host = await createHost();
  const directory = await realpath(await mkdtemp(join(tmpdir(), "octo-codex-forwarding-")));
  const receiptPath = join(directory, "receipt.json");
  const shellQuote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
  const command = [
    process.execPath,
    fileURLToPath(import.meta.url),
    "--check-endpoint",
    receiptPath
  ]
    .map(shellQuote)
    .join(" ");
  let terminal,
    failureCode,
    text = "",
    completedTools = 0;
  try {
    assert.equal(Object.hasOwn(host.list()[0], "executionFeatures"), false);
    for await (const event of host.invoke(
      {
        inputs: [
          {
            type: "text",
            text: `Run this exact read-only test command once: ${command}\nThen reply exactly with the marker it prints. Do not run other commands, modify other files, or send messages.`
          }
        ],
        agentEnv: {
          schema: "octo.context-envelope/v3",
          items: [
            { namespace: "octo.execution", name: "adapter", payload: { type: "codex" } },
            {
              namespace: "octo.execution",
              name: "workspace",
              payload: { mode: "fixed", path: directory }
            },
            {
              namespace: "octo.security",
              name: "approval_policy",
              payload: { mode: "full_access" }
            }
          ]
        },
        protocol_mode: "canonical",
        runId: `forwarding_${randomUUID()}`
      },
      { signal: AbortSignal.timeout(120000) }
    )) {
      if (event.type === "message.delta" && event.payload.channel !== "analysis")
        text += event.payload.text ?? "";
      if (event.type === "tool_call.update" && event.payload.status === "completed")
        completedTools++;
      if (["run.completed", "run.failed", "run.cancelled"].includes(event.type)) {
        terminal = event.type;
        failureCode = event.payload.code;
      }
    }
    assert.equal(terminal, "run.completed", failureCode);
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    assert.equal(receipt.endpoint, endpoint);
    assert.equal(receipt.status, 200);
    assert.ok(text.includes(receipt.marker));
    assert.ok(completedTools > 0);
    console.log(
      JSON.stringify({
        provider: "codex",
        endpoint,
        terminal,
        completedTools,
        nativeCommandCalled: true,
        markerReturned: true,
        executionFeatureField: false
      })
    );
  } finally {
    await host.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
}
