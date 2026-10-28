import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createKernelService } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { ImRuntime } from "@mininglamp-oss/octo-runtime-extra-channel-gateway";
import { getCardProfile } from "../packages/octo-runtime-extra-channel-gateway/dist/transport/api/cards.js";
import { parseOctoJson } from "../packages/octo-runtime-extra-channel-gateway/dist/transport/api/client.js";
import {
  fetchBotGroups,
  getChannelMessages
} from "../packages/octo-runtime-extra-channel-gateway/dist/transport/api/conversations.js";

// 仅指定 QA 账号及既有 Channel_QA 群；默认可控故障注入，可选真实 Codex 正常回复。
const origin = "https://im-test.deepminer.com.cn";
const execute = promisify(execFile);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const realModel = process.env.OCTO_MODEL_WAIT_REAL_MODEL === "1";
const modes = realModel
  ? ["normal"]
  : (process.env.OCTO_MODEL_WAIT_MODES ?? "silent,recover,stop").split(",");
assert.ok(modes.every((mode) => ["normal", "silent", "recover", "stop"].includes(mode)));
const report = {
  environment: "im-test",
  realWebSocket: true,
  realKernelIpc: true,
  realModel,
  scenarios: []
};
let stage = "accounts",
  directory,
  runtime,
  kernel;
const originalFetch = globalThis.fetch;
const frames = [],
  finals = [],
  invocations = [],
  cancellations = [],
  diagnostics = [];
let scenario = "setup";
async function wait(predicate, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(200);
  }
  throw new Error("QA_WAIT_TIMEOUT");
}
try {
  assert.ok(process.env.OCTO_CHANNEL_QA_ACCOUNTS, "QA_ACCOUNTS_REQUIRED");
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
  const receiver = accounts.find(
    (a) => a.name === (process.env.OCTO_MODEL_WAIT_RECEIVER ?? "orbtex-codebuddy")
  );
  const sender = accounts.find(
    (a) => a.name === (process.env.OCTO_MODEL_WAIT_SENDER ?? "orbtex-codex")
  );
  for (const bot of [receiver, sender]) {
    assert.equal(bot?.api, `${origin}/api`, "QA_ENVIRONMENT_REQUIRED");
    assert.ok(bot.token?.startsWith("bf_"), "QA_BOT_REQUIRED");
  }
  const profile = await getCardProfile({ apiUrl: receiver.api, botToken: receiver.token });
  assert.ok(profile.config?.reasoning_enabled, "QA_CARD_POLICY_DISABLED");
  const groups = await fetchBotGroups({ apiUrl: receiver.api, botToken: receiver.token });
  const senderGroups = await fetchBotGroups({ apiUrl: sender.api, botToken: sender.token });
  const group = groups.find(
    (g) =>
      g.name.startsWith("Channel_QA_") &&
      senderGroups.some((other) => other.group_no === g.group_no)
  );
  assert.ok(group, "QA_SHARED_GROUP_REQUIRED");
  const history = () =>
    getChannelMessages({
      apiUrl: receiver.api,
      botToken: receiver.token,
      channelId: group.group_no,
      channelType: 2,
      limit: 100,
      pullMode: 0
    });
  async function send(text) {
    const env = { ...process.env, OCTO_TOKEN: sender.token, OCTO_API_BASE_URL: origin };
    for (const key of [
      "OCTO_BOT_ID",
      "OCTO_PROFILE",
      "OCTO_CREDENTIAL_MODE",
      "OCTO_SPACE_ID",
      "OCTO_BOT_TOKEN"
    ])
      delete env[key];
    try {
      const { stdout } = await execute(
        "octo-cli",
        [
          "message",
          "send",
          "--data",
          JSON.stringify({
            channel_id: group.group_no,
            channel_type: 2,
            payload: { type: 1, content: text, mention: { uids: [receiver.id] } }
          })
        ],
        { env, timeout: 20000 }
      );
      assert.equal(JSON.parse(stdout).ok, true);
    } catch {
      throw new Error("QA_SEND_FAILED");
    }
  }
  globalThis.fetch = async (url, options) => {
    const path = String(url);
    const body =
      typeof options?.body === "string" && /\/v1\/bot\/(sendMessage|message\/edit)$/.test(path)
        ? JSON.parse(options.body)
        : undefined;
    const response = await originalFetch(url, options);
    if (body && response.ok) {
      const data = body.data ?? body.payload?.data;
      if (body.template_ref || body.payload?.template_ref) {
        const receipt = path.endsWith("/sendMessage")
          ? parseOctoJson(await response.clone().text())
          : undefined;
        frames.push({
          scenario,
          at: Date.now(),
          messageId: body.message_id ?? String(receipt?.message_id),
          seq: body.card_seq ?? 1,
          state: body.state ?? body.payload.state,
          footer: data?.progressText,
          status: data?.statusLabel,
          created: !body.message_id
        });
      } else if (body.payload?.type === 1) {
        const receipt = parseOctoJson(await response.clone().text());
        finals.push({ scenario, id: String(receipt.message_id), text: body.payload.content });
      }
    }
    return response;
  };
  directory = await mkdtemp(join(tmpdir(), "octo-wait-"));
  const manifest = join(directory, "manifest.json");
  await writeFile(
    manifest,
    JSON.stringify({
      version: 1,
      adapters: [
        {
          type: realModel ? "codex" : "model-wait-fixture",
          module: fileURLToPath(
            new URL(
              realModel
                ? "../packages/octo-runtime-adapter-codex/dist/index.js"
                : "../test/fixtures/model-wait-adapter.js",
              import.meta.url
            )
          ),
          export: realModel ? "codexAdapter" : "modelWaitAdapter"
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
  runtime = new ImRuntime(
    {
      bot_id: receiver.id,
      bf_token: receiver.token,
      api_url: receiver.api,
      adapter: { adapter_type: realModel ? "codex" : "model-wait-fixture", workdir: directory },
      groups_enabled: true,
      group_ids: [group.group_no],
      allowed_sender_ids: [sender.id],
      run_timeout_ms: 600000,
      typing: false
    },
    {
      kernel: {
        async *invoke(input, environment) {
          const entry = { scenario, at: Date.now(), terminal: undefined, firstOutputMs: undefined };
          invocations.push(entry);
          for await (const event of kernel.client.invoke(input, environment)) {
            if (
              event.type === "message.delta" &&
              ["final", "commentary"].includes(event.payload.channel) &&
              event.payload.text?.trim()
            )
              entry.firstOutputMs ??= Date.now() - entry.at;
            if (["run.completed", "run.failed", "run.cancelled"].includes(event.type))
              entry.terminal = event.type;
            yield event;
          }
        },
        async cancelInvocation(...args) {
          cancellations.push({ scenario, at: Date.now() });
          return kernel.client.cancelInvocation(...args);
        },
        respondInteraction: (...args) => kernel.client.respondInteraction(...args)
      },
      onDiagnostic: (code) => diagnostics.push(code)
    }
  );
  stage = "connect";
  await runtime.start();
  await wait(() => runtime.status.connected);
  for (const mode of modes) {
    scenario = mode;
    stage = mode;
    const baseline = new Set((await history()).map((message) => message.message_id));
    await send(
      realModel
        ? "Reply with exactly MODEL_WAIT_NORMAL_OK. Do not use tools, send messages, or create files."
        : `MODEL_WAIT_QA:${mode}`
    );
    await wait(() => invocations.some((entry) => entry.scenario === mode));
    const invocation = invocations.find((entry) => entry.scenario === mode);
    if (!realModel)
      await wait(
        () => frames.some((frame) => frame.scenario === mode && /30 秒/.test(frame.footer)),
        40000
      );
    const first = frames.find((frame) => frame.scenario === mode && /30 秒/.test(frame.footer));
    if (!realModel)
      assert.ok(
        first.at - invocation.at >= 30000 && first.at - invocation.at < 35000,
        "QA_FIRST_NOTICE_TIMING"
      );
    if (!realModel)
      console.log(
        JSON.stringify({
          stage: mode,
          firstNoticeMs: first.at - invocation.at,
          footer: first.footer
        })
      );
    if (mode === "stop") await send("/stop");
    await wait(
      () => invocation.terminal && runtime.status.sessions.length === 0,
      mode === "silent" ? 285000 : realModel ? 120000 : 60000
    );
    const updates = frames.filter((frame) => frame.scenario === mode);
    assert.equal(updates.filter((frame) => frame.created).length, 1, "QA_DUPLICATE_CARD");
    assert.equal(new Set(updates.map((frame) => frame.messageId)).size, 1, "QA_CARD_MOVED");
    for (let i = 1; i < updates.length; i++)
      assert.ok(updates[i].seq > updates[i - 1].seq, "QA_CARD_SEQUENCE");
    assert.equal(invocations.filter((entry) => entry.scenario === mode).length, 1, "QA_REPLAY");
    const final = updates.at(-1);
    let received;
    await wait(async () => {
      received = await history();
      return received.some(
        (message) =>
          !baseline.has(message.message_id) &&
          message.from_uid === receiver.id &&
          message.type === 1
      );
    });
    const reply = received
      .filter(
        (message) =>
          !baseline.has(message.message_id) &&
          message.from_uid === receiver.id &&
          message.type === 1
      )
      .map((message) => message.content)
      .join("\n");
    if (mode === "normal") {
      assert.equal(final.state, "completed", "QA_NORMAL_STATE");
      assert.match(reply, /MODEL_WAIT_NORMAL_OK/, "QA_NORMAL_FINAL");
      assert.equal(
        cancellations.filter((entry) => entry.scenario === mode).length,
        0,
        "QA_NORMAL_CANCELLED"
      );
    } else if (mode === "silent") {
      const seconds = updates
        .map((frame) => frame.footer?.match(/连续等待 (\d+) 秒/)?.[1])
        .filter(Boolean)
        .map(Number);
      assert.deepEqual(seconds, [30, 60, 90, 120, 150, 180, 210, 240, 270], "QA_CADENCE");
      assert.equal(
        cancellations.filter((entry) => entry.scenario === mode).length,
        1,
        "QA_CANCEL_COUNT"
      );
      assert.ok(
        cancellations.find((entry) => entry.scenario === mode).at - invocation.at >= 299900,
        "QA_CANCEL_TIMING"
      );
      assert.equal(final.state, "error", "QA_TIMEOUT_STATE");
      assert.equal(final.status, "请求超时", "QA_TIMEOUT_STATUS");
      assert.match(reply, /5 分钟.*已确认执行结束/, "QA_TIMEOUT_FINAL");
    } else if (mode === "recover") {
      assert.equal(
        updates.filter((frame) => /连续等待/.test(frame.footer)).length,
        1,
        "QA_TOOL_WARNING"
      );
      assert.ok(
        updates.some(
          (frame) =>
            frame.at > first.at && frame.state === "reasoning" && !/连续等待/.test(frame.footer)
        ),
        "QA_NOTICE_NOT_CLEARED"
      );
      assert.equal(final.state, "completed");
      assert.equal(cancellations.filter((entry) => entry.scenario === mode).length, 0);
    } else assert.equal(final.state, "stopped");
    assert.equal(
      received.filter((message) => message.message_id === final.messageId).length,
      1,
      "QA_CARD_HISTORY"
    );
    assert.ok(
      finals
        .filter((entry) => entry.scenario === mode)
        .every((entry) => received.some((message) => message.message_id === entry.id)),
      "QA_FINAL_HISTORY"
    );
    const summary = {
      mode,
      durationMs: Date.now() - invocation.at,
      edits: updates.length - 1,
      sameCard: true,
      terminal: invocation.terminal,
      cardState: final.state,
      firstNoticeMs: first ? first.at - invocation.at : undefined,
      firstOutputMs: invocation.firstOutputMs
    };
    report.scenarios.push(summary);
    console.log(JSON.stringify(summary));
  }
  assert.ok(
    !diagnostics.some((code) => /CARD_FAILED|PRESENTATION_FAILED|RESULT_UNKNOWN/.test(code)),
    "QA_PRESENTATION_FAILURE"
  );
  console.log(JSON.stringify({ ...report, passed: true }));
} catch (error) {
  console.error(
    JSON.stringify({
      stage,
      failed: true,
      reason:
        typeof error.message === "string" && /^QA_[A-Z_]+/.test(error.message)
          ? error.message.match(/^QA_[A-Z_]+/)[0]
          : (error.code ?? "QA_ASSERTION_FAILED"),
      location: error.stack
        ?.split("\n")
        .find((line) => line.includes("verify-model-wait-im-live.mjs:")),
      cardStates: frames
        .filter((frame) => frame.scenario === scenario)
        .map((frame) => ({
          seq: frame.seq,
          state: frame.state,
          status: frame.status,
          footer: frame.footer
        })),
      terminal: invocations.find((entry) => entry.scenario === scenario)?.terminal,
      observedIds: frames
        .filter((frame) => frame.scenario === scenario)
        .map((frame) => frame.messageId),
      cancelAfterMs:
        cancellations.find((entry) => entry.scenario === scenario)?.at -
        invocations.find((entry) => entry.scenario === scenario)?.at
    })
  );
  process.exitCode = 1;
} finally {
  const failures = [];
  let gatewayClosed = !runtime,
    kernelCleanup = { complete: !kernel, errors: [], pendingResources: [] };
  try {
    await runtime?.close();
    gatewayClosed = true;
  } catch {
    failures.push("QA_GATEWAY_CLOSE_FAILED");
  }
  try {
    if (kernel) kernelCleanup = await kernel.close();
    if (!kernelCleanup.complete) failures.push("QA_KERNEL_CLOSE_FAILED");
  } catch {
    kernelCleanup = {
      complete: false,
      errors: [{ resource: "kernel", code: "QA_KERNEL_CLOSE_THROWN" }],
      pendingResources: ["kernel"]
    };
    failures.push("QA_KERNEL_CLOSE_FAILED");
  }
  globalThis.fetch = originalFetch;
  // 关闭未确认时保留所属工作目录和清理事实，不能用删目录代替退出确认。
  if (directory && gatewayClosed && kernelCleanup.complete)
    await rm(directory, { recursive: true, force: true });
  if (failures.length) {
    console.error(
      JSON.stringify({ failures, gatewayClosed, kernelCleanup, retainedDirectory: directory })
    );
    process.exitCode = 1;
  }
}
