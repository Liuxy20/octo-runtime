import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createKernelService } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { ImRuntime } from "@mininglamp-oss/octo-runtime-extra-channel-gateway";
import { MemoryImSessionStore } from "../packages/octo-runtime-extra-channel-gateway/dist/application/session-store.js";
import { getChannelMessages } from "../packages/octo-runtime-extra-channel-gateway/dist/transport/api/conversations.js";

// 仅向显式 QA 群发送合成消息，限定两个测试 Bot 的触发名单；Provider 与 IM 均为真实服务。
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
const receiver = accounts.find((v) => v.name === "orbtex-codebuddy");
const sender = accounts.find((v) => v.name === "orbtex-codex");
assert.ok(receiver && sender, "CodeBuddy receiver and Codex sender test accounts required");
for (const account of [receiver, sender])
  assert.equal(account.api, "https://im-test.deepminer.com.cn/api");
const execute = promisify(execFile);
async function cli(account, args, body) {
  const env = {
    ...process.env,
    OCTO_TOKEN: account.token,
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
  } catch {
    // CLI 原始异常可能包含凭据；公开证据只标记失败的命令。
    throw new Error(`QA CLI failed: ${args.slice(0, 2).join(" ")}`);
  }
}
for (const account of [receiver, sender]) assert.ok(await cli(account, ["config", "show"]));
const groupId = process.env.OCTO_CHANNEL_QA_GROUP;
assert.ok(groupId, "Set OCTO_CHANNEL_QA_GROUP to an existing isolated QA group");
for (const account of [receiver, sender]) {
  const groups = await cli(account, ["group", "list"]);
  assert.ok(
    groups.some((group) => group.group_no === groupId && /^Channel_QA_/.test(group.name)),
    "Both test bots must already belong to the QA group"
  );
}
const directory = await mkdtemp(join(tmpdir(), "oc217-"));
const sessions = new MemoryImSessionStore();
const report = {
  server: "https://im-test.deepminer.com.cn",
  groupId,
  platform: `${process.platform}/${process.arch}`,
  node: process.version,
  scenarios: [],
  native: [],
  providerRequests: []
};
let kernel, runtime;
const traces = [];
const history = () =>
  getChannelMessages({
    apiUrl: receiver.api,
    botToken: receiver.token,
    channelId: groupId,
    channelType: 2,
    limit: 50,
    pullMode: 0
  });
async function providerRequests() {
  const requests = [];
  const logRoot = join(homedir(), ".codebuddy", "logs");
  for (const day of await readdir(logRoot, { withFileTypes: true })) {
    if (!day.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(day.name)) continue;
    for (const name of await readdir(join(logRoot, day.name))) {
      if (!name.startsWith(basename(directory) + "__") || !name.endsWith(".log")) continue;
      let sessionId;
      for (const line of (await readFile(join(logRoot, day.name, name), "utf8")).split("\n")) {
        const config = line.match(/\[ModelConfig\] sessionId=([^,]+), resolved model=([^ ]+)/);
        if (config) sessionId = config[1];
        const sent = line.match(
          /\[ModelProvider\] Sending request: agent=cli, model=([^,]+), requestId=([^,]+)/
        );
        if (sent) requests.push({ sessionId, model: sent[1], requestId: sent[2] });
      }
    }
  }
  return requests;
}
try {
  const manifest = join(directory, "manifest.json");
  await writeFile(
    manifest,
    JSON.stringify({
      version: 1,
      adapters: [
        {
          type: "codebuddy",
          module: fileURLToPath(
            new URL("../test/fixtures/codebuddy-model-live-adapter.mjs", import.meta.url)
          )
        }
      ]
    })
  );
  kernel = createKernelService({
    endpoint: join(directory, "k.sock"),
    manifest,
    workerEntrypoint: fileURLToPath(
      new URL("../packages/octo-runtime-executor-kernel/dist/runner.js", import.meta.url)
    )
  });
  await kernel.initialize();
  const subscribe = kernel.client.subscribe.bind(kernel.client);
  // 旁观原订阅记录 Host 控制帧，执行、取消和登记继续走真实 KernelClient.invoke。
  kernel.client.subscribe = async function* (...args) {
    for await (const frame of subscribe(...args)) {
      if (frame.kind === "control") traces.at(-1).host.push(frame.control);
      yield frame;
    }
  };
  const tracedKernel = {
    async *invoke(input, environment) {
      const trace = { input, events: [], host: [] };
      traces.push(trace);
      for await (const event of kernel.client.invoke(input, environment)) {
        trace.events.push(event);
        yield event;
      }
    },
    cancelInvocation: (...args) => kernel.client.cancelInvocation(...args),
    respondInteraction: (...args) => kernel.client.respondInteraction(...args)
  };
  async function turn(name, model, expected) {
    if (runtime) await runtime.close();
    const marker = `OCTO217_${randomUUID().slice(0, 8)}`;
    const before = new Set((await history()).map((m) => m.message_id));
    const requestsBefore = new Set((await providerRequests()).map((v) => v.requestId));
    const previousCount = traces.length;
    runtime = new ImRuntime(
      {
        bot_id: receiver.id,
        bf_token: receiver.token,
        api_url: receiver.api,
        cards: false,
        typing: false,
        groups_enabled: true,
        group_ids: [groupId],
        allowed_sender_ids: [sender.id],
        adapter: { adapter_type: "codebuddy", ...(model ? { model } : {}), workdir: directory },
        approval_mode: "full_access",
        run_timeout_ms: 90000
      },
      { kernel: tracedKernel, sessions }
    );
    await runtime.start();
    assert.equal(runtime.status.connected, true, "QA Gateway must be online");
    await cli(sender, ["message", "send"], {
      channel_id: groupId,
      channel_type: 2,
      payload: {
        type: 1,
        content: `Reply exactly ${marker}. Do not use tools.`,
        mention: { uids: [receiver.id] }
      }
    });
    let delivered;
    const deadline = Date.now() + 100000;
    while (Date.now() < deadline) {
      const trace = traces[previousCount];
      const terminal = trace?.events.find((e) =>
        /^run\.(completed|failed|cancelled)$/.test(e.type)
      );
      if (terminal && runtime.status.sessions.length === 0) {
        const messages = (await history()).filter(
          (m) => m.from_uid === receiver.id && !before.has(m.message_id)
        );
        const needle = terminal.type === "run.completed" ? marker : terminal.payload.message;
        delivered = messages.find(
          (m) => typeof needle === "string" && needle.length > 0 && m.content.includes(needle)
        );
        if (delivered) break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.equal(traces.length, previousCount + 1, `${name}: exactly one invocation`);
    const trace = traces[previousCount];
    const terminals = trace.events.filter((e) =>
      /^run\.(completed|failed|cancelled)$/.test(e.type)
    );
    assert.equal(terminals.length, 1, `${name}: one canonical terminal`);
    const terminal = terminals[0];
    const hostTerminal = trace.host.at(-1)?.state;
    assert.equal(terminal.type, `run.${hostTerminal}`, `${name}: Host/canonical agree`);
    if (expected) assert.equal(hostTerminal, expected, `${name}: expected outcome`);
    assert.ok(delivered, `${name}: full final result must be read back from IM`);
    const receipt = trace.events.find((e) => e.type === "session.update")?.payload.providerSession;
    const outcome = {
      name,
      requested: model ?? null,
      resumedSessionId: trace.input.providerSession?.sessionId ?? null,
      receipt: receipt ?? null,
      terminal: terminal.type,
      hostTerminal,
      errorCode: terminal.payload.code ?? null,
      providerRequests: (await providerRequests()).filter((v) => !requestsBefore.has(v.requestId)),
      delivered: true
    };
    if (name === "fresh-unsupported" || name === "existing-unsupported") {
      assert.match(terminal.payload.message, new RegExp(model));
      assert.equal(
        outcome.providerRequests.length,
        0,
        `${name}: invalid selection must not prompt`
      );
    } else {
      assert.ok(outcome.providerRequests.length > 0, `${name}: actual provider request required`);
      assert.ok(
        outcome.providerRequests.every(
          (v) => v.sessionId === receipt?.sessionId && v.model === receipt?.model
        ),
        `${name}: every actual request must match native receipt`
      );
    }
    if (name === "subscription" && hostTerminal === "failed") {
      assert.equal(terminal.payload.code, "ACP_MODEL_REQUEST_FAILED");
      outcome.subscriptionRefusal = /企业订阅已到期/.test(terminal.payload.message);
    }
    report.scenarios.push(outcome);
    console.log(
      JSON.stringify({
        scenario: name,
        requested: model ?? null,
        confirmed: receipt?.model ?? null,
        terminal: terminal.type,
        hostTerminal,
        delivered: true
      })
    );
    return outcome;
  }
  const unsupported = `octo217-unsupported-${randomUUID().slice(0, 8)}`;
  await turn("fresh-unsupported", unsupported, "failed");
  const first = await turn("fresh-valid", "hy3", "completed");
  assert.equal(first.receipt.model, "hy3");
  const switched = await turn("existing-switch", "hy4-preview");
  assert.equal(switched.resumedSessionId, first.receipt.sessionId);
  assert.equal(switched.receipt.model, "hy4-preview");
  await turn("existing-unsupported", unsupported, "failed");
  const recovered = await turn("valid-after-unsupported", "hy3", "completed");
  assert.equal(recovered.resumedSessionId, first.receipt.sessionId);
  assert.equal(recovered.receipt.model, "hy3");
  await turn("subscription", "deepseek-v4.1-flash");
  await turn("omitted-model", undefined);
} finally {
  try {
    if (runtime) await runtime.close();
    if (kernel) assert.equal((await kernel.close()).complete, true);
    sessions.close();
    try {
      report.native = (await readFile(join(directory, "native-evidence.ndjson"), "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      // 原生日志只导出 session/model/requestId，不输出 URL、凭据、提示词或完整日志行。
      report.providerRequests = await providerRequests();
    } catch (error) {
      report.evidenceError = error.code ?? error.name;
    }
    if (process.env.OCTO_CODEBUDDY_LIVE_REPORT)
      await writeFile(
        process.env.OCTO_CODEBUDDY_LIVE_REPORT,
        JSON.stringify(report, null, 2) + "\n",
        { mode: 0o600 }
      );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
assert.equal(report.scenarios.length, 7);
for (const scenario of report.scenarios.filter((v) => v.receipt)) {
  assert.ok(
    report.providerRequests.some(
      (v) => v.sessionId === scenario.receipt.sessionId && v.model === scenario.receipt.model
    ),
    `${scenario.name}: native provider request evidence required`
  );
}
assert.equal(report.native.filter((v) => v.method === "close").length, 7);
console.log(
  JSON.stringify({
    completed: true,
    scenarios: report.scenarios.length,
    nativeRequests: report.providerRequests.length,
    cleanup: true
  })
);
