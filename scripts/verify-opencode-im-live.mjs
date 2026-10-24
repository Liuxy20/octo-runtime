import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createKernelService } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { ImRuntime } from "@mininglamp-oss/octo-runtime-extra-channel-gateway";
import { getChannelMessages } from "../packages/octo-runtime-extra-channel-gateway/dist/transport/api/conversations.js";

// 只连接显式测试账号。消息与凭据不写入报告；发送方名单限定到测试 Bot。
assert.ok(process.env.OCTO_CHANNEL_QA_ACCOUNTS, "Set OCTO_CHANNEL_QA_ACCOUNTS");
const accounts = (await readFile(process.env.OCTO_CHANNEL_QA_ACCOUNTS, "utf8"))
  .split(/(?=Bot Name:)/)
  .slice(1)
  .map((block) => {
    const value = (key) => block.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]?.trim();
    return {
      name: value("Bot Name"),
      id: value("Bot ID"),
      token: value("Bot Token"),
      api: value("API Server")
    };
  });
const receiver = accounts.find((a) => a.name === "orbtex-opencode");
const sender = accounts.find((a) => a.name === "orbtex-codex");
assert.ok(receiver && sender);
const group = process.env.OCTO_CHANNEL_QA_GROUP;
const execute = promisify(execFile);
async function cli(account, args, body) {
  assert.equal(account.api, "https://im-test.deepminer.com.cn/api");
  const env = {
    ...process.env,
    OCTO_BOT_TOKEN: account.token,
    OCTO_API_BASE_URL: "https://im-test.deepminer.com.cn"
  };
  delete env.OCTO_BOT_ID;
  delete env.OCTO_PROFILE;
  try {
    const { stdout } = await execute(
      "octo-cli",
      [...args, ...(body ? ["--data", JSON.stringify(body)] : [])],
      { env, timeout: 20000, maxBuffer: 1 << 20 }
    );
    const result = JSON.parse(stdout);
    assert.equal(result.ok, true);
    return result.data;
  } catch (error) {
    let detail = "CLI_FAILED";
    try {
      const failure = JSON.parse(error.stderr).error;
      detail = `${failure.code}: ${failure.message}`.replace(
        /(?:bf_|app_|uk_)[A-Za-z0-9]+/g,
        "[redacted]"
      );
    } catch {}
    throw new Error(`Test CLI failed: ${args.slice(0, 2).join(" ")}: ${detail}`);
  }
}
for (const account of [receiver, sender]) {
  const config = await cli(account, ["config", "show"]);
  assert.ok(config);
}
const directory = await mkdtemp(join(tmpdir(), "octo-opencode-im-"));
let kernel, runtime;
const calls = [],
  diagnostics = [];
try {
  const manifest = join(directory, "manifest.json");
  await writeFile(
    manifest,
    JSON.stringify({
      version: 1,
      adapters: [
        {
          type: "opencode",
          module: fileURLToPath(
            new URL("../test/fixtures/opencode-v2-live-adapter.mjs", import.meta.url)
          )
        }
      ]
    })
  );
  kernel = createKernelService({
    endpoint: join(directory, "kernel.sock"),
    manifest,
    workerEntrypoint: fileURLToPath(
      new URL("../packages/octo-runtime-executor-kernel/dist/runner.js", import.meta.url)
    )
  });
  await kernel.initialize();
  runtime = new ImRuntime(
    {
      bot_id: receiver.id,
      bf_token: receiver.token,
      api_url: receiver.api,
      cards: false,
      typing: false,
      groups_enabled: Boolean(group),
      ...(group ? { group_ids: [group] } : {}),
      allowed_sender_ids: [sender.id],
      adapter: {
        adapter_type: "opencode",
        model: process.env.OCTO_OPENCODE_MODEL ?? "deepseek/deepseek-flash",
        workdir: directory
      },
      approval_mode: "full_access",
      run_timeout_ms: 120000
    },
    {
      kernel: {
        async *invoke(input, environment) {
          const trace = { terminals: [], text: "", sessions: [] };
          calls.push(trace);
          for await (const event of kernel.client.invoke(input, environment)) {
            if (["run.completed", "run.failed", "run.cancelled"].includes(event.type))
              trace.terminals.push(event.type);
            if (event.type === "message.delta" && event.payload.channel !== "analysis")
              trace.text += event.payload.text ?? "";
            if (event.type === "session.update")
              trace.sessions.push(event.payload.providerSession.sessionId);
            yield event;
          }
        },
        cancelInvocation: (...args) => kernel.client.cancelInvocation(...args),
        respondInteraction: (...args) => kernel.client.respondInteraction(...args)
      },
      onDiagnostic: (code) => diagnostics.push(code)
    }
  );
  await runtime.start();
  assert.equal(runtime.status.connected, true, runtime.status.error);
  const marker = `OCTO_V2_IM_${randomUUID().slice(0, 8)}`;
  await cli(sender, ["message", "send"], {
    channel_id: group ?? receiver.id,
    channel_type: group ? 2 : 1,
    payload: {
      type: 1,
      content: `Reply exactly ${marker}. Do not use tools.`,
      ...(group ? { mention: { uids: [receiver.id] } } : {})
    }
  });
  const deadline = Date.now() + 120000;
  let delivered = false;
  while (Date.now() < deadline) {
    if (calls[0]?.terminals.length) {
      const history = await getChannelMessages({
        apiUrl: receiver.api,
        botToken: receiver.token,
        channelId: group ?? sender.id,
        channelType: group ? 2 : 1,
        limit: 30,
        pullMode: 0
      });
      delivered = history.some(
        (message) => message.from_uid === receiver.id && message.content.includes(marker)
      );
      if (delivered && runtime.status.sessions.length === 0) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.equal(
    calls.length,
    1,
    `invocations=${calls.length}; diagnostic codes=${diagnostics.join(",")}`
  );
  assert.deepEqual(calls[0].terminals, ["run.completed"]);
  assert.match(calls[0].text, new RegExp(marker));
  assert.ok(delivered);
  console.log(
    JSON.stringify({
      endpoint: receiver.api,
      liveIm: true,
      realModel: true,
      independentWorker: true,
      invocations: calls.length,
      terminal: calls[0].terminals[0],
      delivered
    })
  );
} finally {
  if (runtime) await runtime.close();
  if (kernel) assert.equal((await kernel.close()).complete, true);
  await rm(directory, { recursive: true, force: true });
}
