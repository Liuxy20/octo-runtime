import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createKernelService } from "../../../packages/octo-runtime-executor-kernel/dist/index.js";
import { ImRuntime } from "../../../packages/octo-runtime-extra-channel-gateway/dist/index.js";
import { getChannelMessages } from "../../../packages/octo-runtime-extra-channel-gateway/dist/transport/api/conversations.js";
import { createOpenClawDeviceIdentity } from "../../../packages/octo-runtime-adapter-openclaw/dist/gateway.js";

// 仅显式运行：专用测试 Bot、已存在 QA 群、真实 Kernel/OpenClaw；不改持久配置。
assert.ok(process.env.OCTO_CHANNEL_QA_ACCOUNTS);
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
const receiver = accounts.find((account) => account.name === "orbtex-openclaw");
const sender = accounts.find((account) => account.name === "orbtex-codex");
assert.ok(receiver && sender);
for (const account of [receiver, sender]) {
  assert.equal(account.api, "https://im-test.deepminer.com.cn/api");
  assert.ok(account.token.startsWith("bf_"));
}
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
      { env, timeout: 20_000, maxBuffer: 1 << 20 }
    );
    const result = JSON.parse(stdout);
    assert.equal(result.ok, true);
    return result.data;
  } catch {
    throw new Error(`QA CLI failed: ${args.slice(0, 2).join(" ")}`);
  }
}
for (const account of [receiver, sender]) await cli(account, ["config", "show"]);
const receiverGroups = await cli(receiver, ["group", "list"]);
const senderGroups = await cli(sender, ["group", "list"]);
const group = receiverGroups.find(
  (group) =>
    /^Channel_QA_/.test(group.name) &&
    senderGroups.some((other) => other.group_no === group.group_no)
);
assert.ok(group, "Both bots must already belong to an isolated Channel_QA_ group");
const config = JSON.parse(await readFile(join(homedir(), ".openclaw/openclaw.json"), "utf8"));
const device = createOpenClawDeviceIdentity();
const directory = await mkdtemp(join(tmpdir(), "oc224-im-"));
const kernel = createKernelService({
  endpoint: join(directory, "k.sock"),
  workerEntrypoint: fileURLToPath(
    new URL("../../../packages/octo-runtime-executor-kernel/dist/runner.js", import.meta.url)
  ),
  adapterModules: [
    {
      type: "openclaw",
      module: fileURLToPath(
        new URL("../../../packages/octo-runtime-adapter-openclaw/dist/index.js", import.meta.url)
      )
    }
  ],
  adapterConfigurations: {
    openclaw: {
      providerOptions: {
        OPENCLAW_GATEWAY_URL: `ws://127.0.0.1:${config.gateway?.port ?? 18789}`,
        OPENCLAW_GATEWAY_TOKEN: config.gateway.auth.token,
        OPENCLAW_GATEWAY_DEVICE_ID: device.deviceId,
        OPENCLAW_GATEWAY_PUBLIC_KEY: device.publicKey,
        OPENCLAW_GATEWAY_PRIVATE_KEY: device.privateKey
      }
    }
  }
});
const traces = [],
  results = [];
let runtime;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function wait(predicate, timeout = 90_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await sleep(300);
  }
  throw new Error("QA IM timeout");
}
async function history(channelId, channelType) {
  return getChannelMessages({
    apiUrl: receiver.api,
    botToken: receiver.token,
    channelId,
    channelType,
    limit: 30,
    pullMode: 0
  });
}
async function send(channelId, channelType, text) {
  await cli(sender, ["message", "send"], {
    channel_id: channelId,
    channel_type: channelType,
    payload: {
      type: 1,
      content: text,
      ...(channelType !== 1 ? { mention: { uids: [receiver.id] } } : {})
    }
  });
}
try {
  await kernel.initialize();
  runtime = new ImRuntime(
    {
      bot_id: receiver.id,
      bf_token: receiver.token,
      api_url: receiver.api,
      cards: false,
      typing: false,
      group_ids: [group.group_no],
      allowed_sender_ids: [sender.id],
      approval_mode: "full_access",
      adapter: { adapter_type: "openclaw", provider_agent_id: "main" }
    },
    {
      kernel: {
        async *invoke(input, environment) {
          const trace = { input, events: [] };
          traces.push(trace);
          for await (const event of kernel.client.invoke(input, environment)) {
            trace.events.push(event);
            yield event;
          }
        },
        cancelInvocation: (...args) => kernel.client.cancelInvocation(...args),
        respondInteraction: (...args) => kernel.client.respondInteraction(...args)
      }
    }
  );
  await runtime.start();
  assert.equal(runtime.status.connected, true);
  const topic = await cli(sender, ["thread", "create", group.group_no], {
    name: `Channel_QA_224_${randomUUID().slice(0, 8)}`
  });
  const shortId = topic.short_id ?? topic.thread?.short_id;
  assert.ok(shortId);
  await cli(receiver, ["thread", "join", group.group_no, shortId]);
  for (const [kind, channelId, channelType, prefix] of [
    ["dm", receiver.id, 1, `octo-dm-${sender.id}-`],
    ["group", group.group_no, 2, `octo-group-${group.group_no}-`],
    [
      "topic",
      `${group.group_no}____${shortId}`,
      5,
      `octo-group-${group.group_no}-topic-${shortId}-`
    ]
  ]) {
    const sessions = [],
      names = [];
    for (let index = 0; index < 3; index++) {
      if (index === 2) {
        const before = new Set(
          (await history(channelId, channelType)).map((message) => message.message_id)
        );
        await send(channelId, channelType, kind === "group" ? "/new" : "/reset");
        await wait(async () =>
          (await history(channelId, channelType)).some(
            (message) =>
              message.from_uid === receiver.id &&
              !before.has(message.message_id) &&
              message.content === "会话已经重置"
          )
        );
      }
      const marker = `OCTO224_${randomUUID().replaceAll("-", "")}`;
      const count = traces.length;
      await send(
        channelId,
        channelType,
        `Reply exactly ${marker}. Do not call tools or mention anyone.`
      );
      await wait(async () => {
        const trace = traces[count];
        const terminal = trace?.events.find((event) =>
          /^run\.(completed|failed|cancelled)$/.test(event.type)
        );
        if (terminal && terminal.type !== "run.completed")
          throw new Error(`QA native failure: ${terminal.type}`);
        return (
          terminal &&
          runtime.status.sessions.length === 0 &&
          (await history(channelId, channelType)).some(
            (message) => message.from_uid === receiver.id && message.content.includes(marker)
          )
        );
      });
      assert.equal(traces.length, count + 1);
      const trace = traces[count];
      assert.ok(trace.input.sessionName.startsWith(prefix));
      sessions.push(
        trace.events.find((event) => event.type === "session.update").payload.providerSession
          .sessionId
      );
      names.push(trace.input.sessionName);
    }
    assert.equal(sessions[1], sessions[0]);
    assert.notEqual(sessions[2], sessions[0]);
    assert.equal(names[1], names[0]);
    assert.notEqual(names[2], names[0]);
    results.push({ kind, sessions, names, readBack: true });
    console.log(JSON.stringify(results.at(-1)));
  }
  assert.equal(
    new Set(results.flatMap((result) => [result.sessions[0], result.sessions[2]])).size,
    6
  );
} finally {
  await runtime?.close();
  assert.equal((await kernel.close()).complete, true);
  if (process.env.OCTO_SESSION_IM_REPORT)
    await writeFile(
      process.env.OCTO_SESSION_IM_REPORT,
      JSON.stringify({ server: "im-test", results }, null, 2),
      { mode: 0o600 }
    );
  await rm(directory, { recursive: true, force: true });
}
