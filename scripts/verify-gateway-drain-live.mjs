import { execFile, spawn } from "node:child_process";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import {
  createExtraService,
  componentEndpoint
} from "../packages/octo-runtime-host-sdk/dist/index.js";
import { createKernelService } from "../packages/octo-runtime-executor-kernel/dist/index.js";
import { runCli } from "../apps/cli/dist/main.js";
import { kernelInput } from "../test/kernel-fixture.js";
import { selectReasoningTemplate } from "../packages/octo-runtime-extra-channel-gateway/dist/transport/cards.js";

// 凭据只进入测试子进程环境和权限为 0600 的临时 Extra 配置，不写入验收输出。
const directory = await mkdtemp(
  join(process.platform === "darwin" ? "/tmp" : tmpdir(), "od-live-")
);
const execute = promisify(execFile);
const absolute = (path) => fileURLToPath(new URL(path, import.meta.url));
const report = { endpoint: "https://im-test.deepminer.com.cn", platform: process.platform };
const cliMode = process.argv.includes("--cli");
const adapterType = process.argv.includes("--dsh") ? "dsh" : "codex";
const failDelivery = process.argv.includes("--fail-delivery");
const failCard = process.argv.includes("--fail-card");
const cards = failCard || process.argv.includes("--cards");
const instrumented = failDelivery || cards;
let kernel, gateway;
let stage = "accounts";
let dshFault = false;
const ensure = (condition, code) => {
  if (!condition) throw new Error(code);
};
async function waitFor(predicate, code, timeout = 30000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(code);
}
async function cli(account, args, body) {
  const env = {
    ...process.env,
    HOME: directory,
    XDG_CONFIG_HOME: directory,
    OCTO_BOT_TOKEN: account.token,
    OCTO_API_BASE_URL: report.endpoint
  };
  delete env.OCTO_BOT_ID;
  delete env.OCTO_PROFILE;
  try {
    const { stdout } = await execute(
      "octo-cli",
      [...args, ...(body ? ["--data", JSON.stringify(body)] : [])],
      { env, timeout: 20000, maxBuffer: 4 << 20 }
    );
    const result = JSON.parse(stdout);
    ensure(result.ok && result.identity.bot_kind === "user_bot", "QA_IDENTITY_INVALID");
    return result.data;
  } catch (error) {
    let code = "QA_CLI_FAILED";
    try {
      const candidate = JSON.parse(error.stdout || error.stderr).error.code;
      if (typeof candidate === "string" && /^[A-Za-z0-9_.-]+$/.test(candidate)) code = candidate;
      else if (Number.isSafeInteger(candidate)) code = `NATIVE_${candidate}`;
    } catch {}
    throw new Error(`${args.slice(0, 2).join(".")}:${code}`);
  }
}
try {
  ensure(!(failDelivery && failCard), "QA_FAULT_MODES_EXCLUSIVE");
  ensure(process.env.OCTO_CHANNEL_QA_ACCOUNTS, "QA_ACCOUNTS_REQUIRED");
  const text = await readFile(process.env.OCTO_CHANNEL_QA_ACCOUNTS, "utf8");
  const accounts = text
    .split(/(?=Bot Name:)/)
    .slice(1)
    .map((block) => {
      const value = (key) =>
        block
          .split("\n")
          .find((line) => line.startsWith(`${key}:`))
          ?.slice(key.length + 1)
          .trim();
      return { id: value("Bot ID"), token: value("Bot Token"), api: value("API Server") };
    })
    .filter((account) => account.token?.startsWith("bf_"));
  const [receiver, sender] = accounts;
  ensure(receiver && sender, "QA_TWO_USER_BOTS_REQUIRED");
  for (const account of [receiver, sender]) {
    ensure(account.api === `${report.endpoint}/api`, "QA_TEST_ONLY");
    await cli(account, ["config", "show"]);
  }
  if (cards) {
    const profile = await cli(receiver, [
      "api",
      "GET",
      "/v1/bot/card/profile",
      "--service",
      "dmworkim"
    ]);
    report.cardCapability = {
      enabled: profile.config?.card_enabled === true,
      reasoning: profile.config?.reasoning_enabled === true,
      templating: profile.templating?.supported === true
    };
    report.cardCapability.compatibleTemplate = !!selectReasoningTemplate({
      ...profile,
      available: true
    });
    if (!process.argv.includes("--inspect"))
      ensure(Object.values(report.cardCapability).every(Boolean), "QA_CARD_CAPABILITY_DISABLED");
  }
  stage = "group";
  const data = await cli(receiver, ["group", "list"]);
  const groups = Array.isArray(data) ? data : (data.groups ?? []);
  const candidates = groups.filter((group) =>
    process.env.OCTO_CHANNEL_QA_GROUP
      ? group.group_no === process.env.OCTO_CHANNEL_QA_GROUP
      : /^Channel_QA_/.test(group.name)
  );
  let group;
  for (const candidate of candidates.reverse()) {
    const data = await cli(receiver, ["group", "members", candidate.group_no]);
    const members = Array.isArray(data) ? data : (data.members ?? []);
    if (
      [receiver, sender].every((account) => members.some((member) => member.uid === account.id))
    ) {
      group = candidate;
      break;
    }
  }
  ensure(group, "QA_SHARED_TEST_GROUP_REQUIRED");
  report.groupFingerprint = createHash("sha256").update(group.group_no).digest("hex").slice(0, 12);
  const history = async (channelId = group.group_no, channelType = 2) => {
    const data = await cli(receiver, ["message", "sync"], {
      channel_id: channelId,
      channel_type: channelType,
      limit: 100
    });
    return (data.messages ?? []).map((message) => ({
      ...message,
      message_id: String(message.message_idstr ?? message.message_id),
      payload:
        typeof message.payload === "string"
          ? JSON.parse(Buffer.from(message.payload, "base64").toString("utf8"))
          : message.payload
    }));
  };
  if (process.argv.includes("--inspect")) {
    report.ready = true;
  } else {
    const send = (content, channelId = group.group_no, channelType = 2, mentioned = true) =>
      cli(sender, ["message", "send"], {
        channel_id: channelId,
        channel_type: channelType,
        payload: { type: 1, content, ...(mentioned ? { mention: { uids: [receiver.id] } } : {}) }
      });
    stage = "kernel";
    const manifest = join(directory, "adapters.json");
    await writeFile(
      manifest,
      JSON.stringify({
        version: 1,
        adapters: [
          {
            type: "dsh",
            module: absolute("../packages/octo-runtime-adapter-dsh/dist/index.js"),
            export: "dshAdapter"
          },
          {
            type: "codex",
            module: absolute("../packages/octo-runtime-adapter-codex/dist/index.js"),
            export: "createCodexAdapter",
            factory: true
          },
          {
            type: "test",
            module: absolute("../test/fixtures/test-adapter.js"),
            export: "testAdapter"
          }
        ]
      }),
      { mode: 0o600 }
    );
    const endpoint = componentEndpoint(directory);
    kernel = createKernelService({
      endpoint,
      manifest,
      configurations: () =>
        dshFault ? { dsh: { providerOptions: { command: join(directory, "absent-dsh") } } } : {},
      workerEntrypoint: absolute("../packages/octo-runtime-executor-kernel/dist/runner.js")
    });
    await kernel.initialize();
    const sibling = await kernel.client.submit(kernelInput("wait-for-host-exit"));
    const attemptsFile = join(directory, "send-attempts.ndjson");
    const cardAcks = join(directory, "card-acks.ndjson");
    const preload = join(directory, "delivery-observer.mjs");
    if (instrumented) {
      const source = [
        `import { appendFile } from 'node:fs/promises';
import { ImSendError } from ${JSON.stringify(new URL("../packages/octo-runtime-extra-channel-gateway/dist/delivery/text-send.js", import.meta.url).href)};
`
      ];
      if (failDelivery)
        source.push(`import { WukongConnection } from ${JSON.stringify(new URL("../packages/octo-runtime-extra-channel-gateway/dist/transport/wukong.js", import.meta.url).href)};
WukongConnection.prototype.sendText = async function () {
  await appendFile(${JSON.stringify(attemptsFile)}, 'attempt;');
  throw new ImSendError('IM_SEND_REJECTED_TEST', 'failed');
};\n`);
      if (cards)
        source.push(`import { OctoConnector } from ${JSON.stringify(new URL("../packages/octo-runtime-extra-channel-gateway/dist/transport/connector.js", import.meta.url).href)};
const originalCard = OctoConnector.prototype.card;
OctoConnector.prototype.card = async function (...args) {
  const frame = args[2];
  if (${failCard} && ['completed', 'stopped', 'error'].includes(frame.state)) {
    await appendFile(${JSON.stringify(attemptsFile)}, 'attempt;');
    throw new ImSendError('IM_CARD_REJECTED_TEST', 'failed');
  }
  const messageId = await originalCard.apply(this, args);
  await appendFile(${JSON.stringify(cardAcks)}, JSON.stringify({run: frame.reasoningId, messageId, state: frame.state, collapsed: frame.traceCollapsed}) + '\\n', {mode: 0o600});
  return messageId;
};\n`);
      await writeFile(preload, source.join("\n"), { mode: 0o600 });
      if (!cliMode) await import(pathToFileURL(preload).href);
    }
    let contexts = 0;
    const open = async () => {
      const options = {
        endpoint,
        declaration: {
          name: "channel-gateway",
          module: absolute("../packages/octo-runtime-extra-channel-gateway/dist/index.js"),
          config: {
            bots: [
              {
                bot_id: receiver.id,
                bf_token: receiver.token,
                api_url: receiver.api,
                group_ids: [group.group_no],
                allowed_sender_ids: [sender.id],
                cards,
                typing: false,
                approval_mode: "full_access",
                codex_retry: { enabled: false },
                adapter: { adapter_type: adapterType, workdir: directory }
              }
            ]
          }
        },
        dependencies: {
          loadContexts: async () => {
            contexts++;
            return [
              {
                namespace: "extra.qa",
                name: "shutdown-verification",
                guidance:
                  "Follow the explicit test prompt. Never read account or credential files.",
                payload: {}
              }
            ];
          }
        }
      };
      if (!cliMode) {
        // SDK 模式直接在验证进程构造服务；故障注入也在同一进程加载。
        const service = createExtraService({
          endpoint,
          module: await import(pathToFileURL(options.declaration.module).href),
          config: options.declaration.config,
          dependencies: options.dependencies
        });
        await service.initialize();
        return {
          close: () => service.close(),
          status: async () => (await service.status()).plugin
        };
      }
      ensure(
        (await runCli(["--home", directory, "extraset", "channel-gateway"], {
          input: Readable.from([
            JSON.stringify({
              config: options.declaration.config
            })
          ]),
          output() {}
        })) === 0,
        "QA_CLI_CONFIG_FAILED"
      );
      const entrypoint = absolute("../apps/cli/dist/index.js");
      const child = spawn(
        process.execPath,
        [entrypoint, "--home", directory, "--json", "channel-gateway", "run"],
        {
          stdio: ["ignore", "pipe", "pipe"],
          ...(instrumented
            ? {
                env: {
                  ...process.env,
                  NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${pathToFileURL(preload).href}`
                }
              }
            : {})
        }
      );
      let output = "",
        closing;
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr = (stderr + chunk).slice(-8192);
      });
      const exited = new Promise((resolve, reject) => {
        child.once("exit", resolve);
        child.once("error", reject);
      });
      void exited.catch(() => undefined);
      child.stdout.on("data", (chunk) => {
        output = (output + chunk).slice(-8192);
      });
      const stop = () =>
        (closing ??= (async () => {
          if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
          let timer;
          try {
            const code = await Promise.race([
              exited,
              new Promise((_, reject) => {
                timer = setTimeout(() => {
                  child.kill("SIGKILL");
                  reject(new Error("QA_CLI_STOP_TIMEOUT"));
                }, 8000);
              })
            ]);
            return { complete: code === 0 };
          } finally {
            clearTimeout(timer);
          }
        })());
      try {
        await waitFor(() => {
          const failure = output
            .split("\n")
            .flatMap((line) => {
              try {
                return [JSON.parse(line)];
              } catch {
                return [];
              }
            })
            .find((value) => value.error)?.error;
          const code =
            failure?.cause_code ??
            failure?.code ??
            output.match(/"code":\s*"([A-Z0-9_]+)"/)?.[1] ??
            stderr.match(/\b(?:ERR_|[A-Z]+_)[A-Z_]{3,}\b/)?.[0];
          ensure(
            child.exitCode === null,
            typeof code === "string" && /^[A-Z0-9_]+$/.test(code)
              ? `QA_CLI_EARLY_EXIT:${code}`
              : "QA_CLI_EARLY_EXIT"
          );
          return output.includes('"state":"ready"');
        }, "QA_CLI_START_TIMEOUT");
      } catch (error) {
        await stop();
        throw error;
      }
      return {
        async status() {
          const { stdout } = await execute(
            process.execPath,
            [entrypoint, "--home", directory, "status", "--json"],
            {
              timeout: 10000,
              maxBuffer: 1 << 20
            }
          );
          return JSON.parse(stdout)["channel-gateway"].runtime.status;
        },
        close: stop
      };
    };
    stage = "gateway";
    gateway = await open();
    await waitFor(
      async () => (await gateway.status()).bots?.[0]?.state === "online",
      "QA_GATEWAY_OFFLINE"
    );
    if (adapterType === "dsh") {
      stage = "admission";
      const previousMessages = new Set((await history()).map((message) => message.message_id));
      const previousContexts = contexts;
      const groupMarker = `GROUP_${randomUUID().replaceAll("-", "")}`;
      await send("Reply DENIED_MISSING_MENTION", group.group_no, 2, false);
      await send(`Remember ${groupMarker}. Reply with exactly ${groupMarker}. Do not use tools.`);
      await waitFor(
        async () =>
          (await history()).some(
            (message) =>
              message.from_uid === receiver.id && message.payload?.content?.includes(groupMarker)
          ),
        "QA_GROUP_REPLY_MISSING",
        90000
      );
      await waitFor(
        async () => (await gateway.status()).bots[0].workingTasks === 0,
        "QA_GROUP_STILL_ACTIVE"
      );
      const replies = (await history()).filter(
        (message) =>
          !previousMessages.has(message.message_id) &&
          message.from_uid === receiver.id &&
          message.payload?.type === 1
      );
      ensure(
        replies.length === 1 && (cliMode || contexts === previousContexts + 1),
        "QA_MISSING_MENTION_INVOKED"
      );
      const followupMarker = `FOLLOWUP_${randomUUID().replaceAll("-", "")}`;
      await send(
        `Reply with exactly ${followupMarker} followed by the marker I asked you to remember in my previous message.`
      );
      await waitFor(
        async () =>
          (await history()).some(
            (message) =>
              message.from_uid === receiver.id &&
              message.payload?.content?.includes(followupMarker) &&
              message.payload.content.includes(groupMarker)
          ),
        "QA_GROUP_RESUME_MISSING",
        90000
      );
      await waitFor(
        async () => (await gateway.status()).bots[0].workingTasks === 0,
        "QA_GROUP_FOLLOWUP_ACTIVE"
      );
      const dmMarker = `DM_${randomUUID().replaceAll("-", "")}`;
      if (!process.argv.includes("--skip-dm")) {
        await send(`Reply with exactly ${dmMarker}. Do not use tools.`, receiver.id, 1, false);
        await waitFor(
          async () =>
            (await history(sender.id, 1)).some(
              (message) =>
                message.from_uid === receiver.id && message.payload?.content?.includes(dmMarker)
            ),
          "QA_DM_REPLY_MISSING",
          90000
        );
        await waitFor(
          async () => (await gateway.status()).bots[0].workingTasks === 0,
          "QA_DM_STILL_ACTIVE"
        );
      }
      report.admission = {
        dm: process.argv.includes("--skip-dm") ? "BLOCKED: QA peers are not friends" : true,
        groupMention: true,
        missingMentionDenied: true,
        groupSessionResumed: true
      };
      stage = "provider-failure";
      const failureBefore = new Set((await history()).map((message) => message.message_id));
      dshFault = true;
      try {
        await send("Reply SHOULD_NOT_EXECUTE. Do not use tools.");
        await waitFor(
          async () =>
            (await history()).some(
              (message) =>
                !failureBefore.has(message.message_id) &&
                message.from_uid === receiver.id &&
                message.payload?.content?.includes("OH-ADP-3002")
            ),
          "QA_COMMON_FAILURE_REPLY_MISSING"
        );
        await waitFor(
          async () => (await gateway.status()).bots[0].workingTasks === 0,
          "QA_FAILED_TASK_ACTIVE"
        );
        if (cards) {
          ensure(
            (await readFile(cardAcks, "utf8"))
              .trim()
              .split("\n")
              .map(JSON.parse)
              .some((frame) => frame.state === "error"),
            "QA_FAILURE_CARD_MISSING"
          );
        }
      } finally {
        dshFault = false;
      }
      report.providerFailure = { commonCode: "OH-ADP-3002", ...(cards ? { errorCard: true } : {}) };
    }
    const before = new Set((await history()).map((message) => message.message_id));
    const marker = `DRAIN_QA_${randomUUID().replaceAll("-", "")}`;
    stage = "invoke";
    await send(
      `Use the shell tool to run sleep 60. After it finishes, reply exactly ${marker}. Do not modify files or send messages through any tool.`
    );
    const task = await waitFor(async () => {
      const bot = (await gateway.status()).bots?.[0];
      return bot?.workingTasks === 1 && bot.tasks?.[0];
    }, "QA_INVOCATION_NOT_ACCEPTED");
    const attempt = task.attempts.at(-1);
    const session = (await gateway.status()).bots[0].sessions.find(
      (session) => session.runId === task.runId
    );
    ensure(attempt && session, "QA_RUN_IDENTITY_MISSING");
    const key = {
      agent_session_id: session.sessionId,
      session_generation: session.generation,
      run_id: attempt.runId,
      invocation_id: attempt.invocationId,
      protocol_mode: "canonical"
    };
    const { ref } = await waitFor(async () => {
      try {
        return await kernel.client.get(key);
      } catch (error) {
        if (error.code === "RUN_NOT_AVAILABLE") return undefined;
        throw error;
      }
    }, "QA_KERNEL_ACCEPTANCE_MISSING");
    const observed = [];
    const observing = (async () => {
      for await (const frame of kernel.client.subscribe(ref)) {
        observed.push(frame);
      }
    })();
    void observing.catch(() => undefined);
    await waitFor(
      () => {
        const failure = observed.find((frame) => frame.event?.type === "run.failed")?.event.payload
          .failure;
        ensure(!failure, failure?.reasonCode ?? "QA_MODEL_FAILED");
        return observed.some((frame) => frame.event?.type === "tool_call.create");
      },
      "QA_REAL_TOOL_NOT_STARTED",
      90000
    );
    const progressCard = cards
      ? await waitFor(
          async () =>
            (await history()).find(
              (message) =>
                message.from_uid === receiver.id &&
                message.payload?.type === 17 &&
                !before.has(message.message_id)
            ),
          "QA_PROGRESS_CARD_MISSING"
        )
      : undefined;
    stage = "stop";
    const started = performance.now();
    const stopped = await gateway.close();
    report.stopMs = Math.round(performance.now() - started);
    ensure(
      stopped.complete === !(failDelivery || failCard),
      failDelivery || failCard ? "QA_SEND_FAILURE_HIDDEN" : "QA_STOP_INCOMPLETE"
    );
    ensure((await gateway.close()).complete === stopped.complete, "QA_REPEATED_STOP_CHANGED");
    gateway = undefined;
    await observing;
    ensure((await kernel.client.get(ref)).terminal, "QA_TERMINAL_MISSING");
    ensure(!(await kernel.client.get(sibling.ref)).terminal, "QA_SIBLING_INTERRUPTED");
    ensure((await kernel.client.status()).execution_ready, "QA_KERNEL_INTERRUPTED");
    const stoppedHistory = await history();
    const finals = stoppedHistory.filter(
      (message) =>
        !before.has(message.message_id) &&
        message.from_uid === receiver.id &&
        message.payload?.type === 1
    );
    ensure(finals.length === (failDelivery ? 0 : 1), "QA_UNIQUE_FINAL_MISSING");
    if (cards) {
      const acknowledged = (await readFile(cardAcks, "utf8"))
        .trim()
        .split("\n")
        .map(JSON.parse)
        .filter((frame) => frame.run === task.runId);
      const terminal = observed.findLast((frame) =>
        ["run.completed", "run.cancelled", "run.failed"].includes(frame.event?.type)
      )?.event.type;
      const state = {
        "run.completed": "completed",
        "run.cancelled": "stopped",
        "run.failed": "error"
      }[terminal];
      ensure(
        acknowledged.length > 0 &&
          acknowledged.every((frame) => frame.messageId === progressCard.message_id),
        "QA_CARD_ID_CHANGED"
      );
      if (!failCard)
        ensure(
          state && acknowledged.some((frame) => frame.state === state && frame.collapsed),
          "QA_TERMINAL_CARD_NOT_ACKNOWLEDGED"
        );
    }
    const sendAttempts =
      failDelivery || failCard
        ? (await readFile(attemptsFile, "utf8")).split(";").filter(Boolean).length
        : 0;
    if (failDelivery || failCard) ensure(sendAttempts === 1, "QA_FAULT_SEND_REPEATED");
    const result = {
      [adapterType === "dsh" ? "realDshTool" : "realCodexTool"]: true,
      terminal: true,
      ...(cards && !failCard
        ? { terminalCardAcknowledgedAtStop: true, sameCardMessage: true }
        : {}),
      ...(failCard
        ? {
            injectedTerminalCardFailure: true,
            incompleteReported: true,
            finalPresentAtStop: true,
            cardSendAttempts: sendAttempts
          }
        : {}),
      ...(failDelivery
        ? {
            injectedSendFailure: true,
            incompleteReported: true,
            sendAttempts
          }
        : { finalPresentAtStop: true }),
      siblingPreserved: true,
      kernelPreserved: true,
      ...(cliMode ? {} : { contextsLoaded: contexts > 0 })
    };
    if (!failDelivery && !failCard) {
      stage = "restart";
      gateway = await open();
      await waitFor(
        async () => (await gateway.status()).bots?.[0]?.state === "online",
        "QA_RESTART_OFFLINE"
      );
      const completed = `RESTART_QA_${randomUUID().replaceAll("-", "")}`;
      await send(`Reply with exactly ${completed}. Do not use any tools.`);
      await waitFor(
        async () =>
          (await history()).some(
            (message) =>
              message.from_uid === receiver.id && message.payload?.content?.includes(completed)
          ),
        "QA_RESTART_REPLY_MISSING",
        90000
      );
      await waitFor(
        async () => (await gateway.status()).bots?.[0]?.workingTasks === 0,
        "QA_RESTART_TURN_ACTIVE"
      );
      ensure((await gateway.close()).complete, "QA_RESTART_STOP_INCOMPLETE");
      gateway = undefined;
      result.restartedAndReplied = true;
    }
    report[cliMode ? "cli" : "sdk"] = result;
    await kernel.client.cancel(sibling.ref);
  }
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  const code = /^[A-Za-z0-9_.:-]+$/.test(error.message) ? error.message : "QA_VERIFICATION_FAILED";
  console.error(JSON.stringify({ stage, error: code }));
  process.exitCode = 1;
} finally {
  if (gateway) await gateway.close().catch(() => undefined);
  if (kernel) await kernel.close().catch(() => undefined);
  await rm(directory, { recursive: true, force: true });
}
