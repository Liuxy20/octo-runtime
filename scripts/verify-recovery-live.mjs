import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  createKernelService,
  createExtraService,
  componentEndpoint
} from "@mininglamp-oss/octo-runtime/host";
import { attachKernel } from "@mininglamp-oss/octo-runtime/executor-kernel";
import { invocationInput } from "@mininglamp-oss/octo-runtime-protocol";
import * as gatewayModule from "@mininglamp-oss/octo-runtime/extras/channel-gateway";
import { invokeRequest } from "../test/runtime-fixture.js";
import { recoveryLiveFaults } from "../test-support/recovery-live-faults.mjs";
import {
  waitFor as waitForProbe,
  inspectStatus,
  historyMessages,
  childEnvironment,
  octoEnvironment
} from "../test-support/recovery-live-probes.mjs";

const execute = promisify(execFile);
const absolute = (name) => fileURLToPath(new URL(name, import.meta.url));
const endpointOrigin = "https://im-test.deepminer.com.cn";
const mode = process.argv.includes("--cli") ? "cli" : "sdk";
const directory = await mkdtemp("/tmp/or-recovery-live-");
await chmod(directory, 0o700);
const reportFile = join(directory, "report.json");
const cliDirectory = join(directory, "octo-cli");
const report = {
  mode,
  endpoint: endpointOrigin,
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  started: new Date().toISOString(),
  localFaultInjection: true,
  checks: []
};
const children = [];
let kernel,
  extra,
  restoreFaults,
  client,
  stage = "preflight";
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const marker = (kind) => `RECOVERY_${kind}_${randomUUID().replaceAll("-", "")}`;
const check = (condition, reason) => {
  if (!condition) throw new Error(reason);
};
const safeCode = (error) => {
  const code = error?.code ?? error?.message;
  return typeof code === "string" && /^[A-Za-z0-9_.:-]{1,160}$/.test(code)
    ? code
    : "QA_UNCLASSIFIED_ERROR";
};
async function waitFor(predicate, reason, timeout = 30000) {
  return waitForProbe(predicate, reason, timeout, {
    beforeAttempt: () => {
      for (const entry of children)
        check(entry.child.exitCode === null && entry.child.signalCode === null, "QA_CHILD_EXITED");
    }
  });
}
async function octo(token, args, body) {
  const env = octoEnvironment(process.env, { token, configDirectory: cliDirectory });
  try {
    const { stdout } = await execute(
      "octo-cli",
      [...args, ...(body ? ["--data", JSON.stringify(body)] : [])],
      { env, timeout: 20000, maxBuffer: 4 << 20 }
    );
    const result = JSON.parse(stdout);
    check(result.ok, "QA_CLI_NOT_OK");
    return result;
  } catch (error) {
    let code = "QA_CLI_FAILED",
      retryable = error.code === "ETIMEDOUT" || error.killed === true;
    try {
      const detail = JSON.parse(error.stderr).error;
      code = safeCode(detail);
      retryable =
        ["network", "rate_limited"].includes(detail.type) ||
        (detail.type === "api_error" && ["INTERNAL_ERROR", "UPSTREAM_UNAVAILABLE"].includes(code));
    } catch {}
    throw Object.assign(new Error(`${args.slice(0, 2).join(".")}:${code}`), { retryable });
  }
}
async function launch(
  component,
  args = [],
  env = childEnvironment(process.env, { provider: component === "executor-kernel" })
) {
  const child = spawn(
    process.execPath,
    [
      absolute("../apps/cli/dist/index.js"),
      component,
      "run",
      "--home",
      directory,
      "--json",
      ...args
    ],
    { env, stdio: ["ignore", "pipe", "pipe"] }
  );
  const entry = {
    child,
    exited: new Promise((resolve, reject) => {
      child.once("exit", (code, signal) => resolve({ code, signal }));
      child.once("error", reject);
    })
  };
  void entry.exited.catch(() => undefined);
  children.push(entry);
  // CLI 的原始输出可能带环境诊断，不写入报告，也不回显。
  child.stdout.resume();
  child.stderr.resume();
  return entry;
}
async function stopChild(entry) {
  const waitExit = async (ms) => {
    let timer;
    try {
      return await Promise.race([
        entry.exited,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("QA_CHILD_CLEANUP_TIMEOUT")), ms);
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  if (entry.child.exitCode === null && entry.child.signalCode === null) entry.child.kill("SIGTERM");
  try {
    return await waitExit(10000);
  } catch (error) {
    if (entry.child.exitCode === null && entry.child.signalCode === null) {
      entry.child.kill("SIGKILL");
      await waitExit(3000);
    }
    throw error;
  }
}
async function browser(js) {
  const script = `tell application "Google Chrome"\nrepeat with w in windows\nrepeat with t in tabs of w\nif URL of t starts with "${endpointOrigin}/" then\nreturn execute t javascript ${JSON.stringify(js)}\nend if\nend repeat\nend repeat\nerror "QA_TEST_TAB_MISSING"\nend tell`;
  const { stdout } = await execute("osascript", ["-e", script], {
    timeout: 10000,
    maxBuffer: 1 << 20
  });
  return JSON.parse(stdout.trim());
}
async function browserEnter() {
  const script = `tell application "Google Chrome"
repeat with w in windows
repeat with i from 1 to count of tabs of w
set t to tab i of w
if URL of t starts with "${endpointOrigin}/" then
set active tab index of w to i
set index of w to 1
activate
execute t javascript "document.querySelector('[contenteditable=true][role=textbox]').focus()"
tell application "System Events" to key code 36
return
end if
end repeat
end repeat
error "QA_TEST_TAB_MISSING"
end tell`;
  await execute("osascript", ["-e", script], { timeout: 10000 });
}
try {
  check(process.platform !== "win32", "QA_POSIX_RUNNER_REQUIRED");
  await mkdir(cliDirectory, { mode: 0o700 });
  check(
    process.env.OCTO_CHANNEL_QA_ACCOUNTS && process.env.OCTO_CHANNEL_QA_USER,
    "QA_ACCOUNT_PATHS_REQUIRED"
  );
  report.baseline = (
    await execute("git", ["rev-parse", "HEAD"], { cwd: absolute("..") })
  ).stdout.trim();
  report.dirty = !!(await execute("git", ["status", "--porcelain"], { cwd: absolute("..") }))
    .stdout;
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
    });
  const [receiver, sender] = accounts;
  for (const account of [receiver, sender]) {
    check(
      account?.api === `${endpointOrigin}/api` && account.token?.startsWith("bf_"),
      "QA_TEST_ACCOUNTS_REQUIRED"
    );
    check(
      (await octo(account.token, ["config", "show"])).identity.bot_kind === "user_bot",
      "QA_BOT_IDENTITY"
    );
  }
  const user = JSON.parse(await readFile(process.env.OCTO_CHANNEL_QA_USER, "utf8"));
  check(user.api_key?.startsWith("uk_"), "QA_USER_KEY_REQUIRED");
  check(
    (await octo(user.api_key, ["config", "show"])).identity.bot_kind === "user_key",
    "QA_USER_IDENTITY"
  );
  const groupsResult = (await octo(receiver.token, ["group", "list"])).data;
  const groups = Array.isArray(groupsResult) ? groupsResult : (groupsResult.groups ?? []);
  let group;
  for (const candidate of groups.filter((item) => /^Channel_QA_/.test(item.name)).reverse()) {
    const data = (await octo(receiver.token, ["group", "members", candidate.group_no])).data;
    const members = Array.isArray(data) ? data : (data.members ?? []);
    if (
      [receiver, sender].every((account) => members.some((member) => member.uid === account.id))
    ) {
      group = candidate;
      break;
    }
  }
  check(group, "QA_SHARED_GROUP_REQUIRED");
  report.groupFingerprint = createHash("sha256").update(group.group_no).digest("hex").slice(0, 12);
  const browserUser = process.argv.includes("--browser")
    ? await browser(
        "JSON.stringify({uid:localStorage.getItem('uid75hfzi'),ready:!!document.querySelector('[contenteditable=true]')})"
      )
    : undefined;
  if (browserUser) check(browserUser.uid && browserUser.ready, "QA_BROWSER_NOT_READY");
  const history = async (channelId = group.group_no, channelType = 2) => {
    const data = (
      await octo(receiver.token, ["message", "sync"], {
        channel_id: channelId,
        channel_type: channelType,
        limit: 100
      })
    ).data;
    return historyMessages(data.messages ?? []);
  };
  const send = (content) =>
    octo(sender.token, ["message", "send"], {
      channel_id: group.group_no,
      channel_type: 2,
      payload: { type: 1, content, mention: { uids: [receiver.id] } }
    });
  const controlFile = join(directory, "fault.json"),
    eventsFile = join(directory, "fault-events.ndjson");
  let fault = { blocked: true, drop: 0 };
  const setFault = async (patch) => {
    fault = { ...fault, ...patch };
    await writeFile(`${controlFile}.tmp`, JSON.stringify(fault), { mode: 0o600 });
    await rename(`${controlFile}.tmp`, controlFile);
  };
  await setFault({});
  await writeFile(eventsFile, "", { mode: 0o600 });
  const faults = async () =>
    (await readFile(eventsFile, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  const endpoint = componentEndpoint(directory),
    extraEndpoint = componentEndpoint(directory, "channel-gateway");
  const config = {
    bots: [
      {
        bot_id: receiver.id,
        bf_token: receiver.token,
        api_url: receiver.api,
        group_ids: [group.group_no],
        allowed_sender_ids: [sender.id, ...(browserUser ? [browserUser.uid] : [])],
        cards: false,
        typing: false,
        approval_mode: "full_access",
        codex_retry: { enabled: false },
        adapter: { adapter_type: "codex", workdir: directory }
      }
    ]
  };
  stage = "services";
  if (mode === "sdk") {
    restoreFaults = recoveryLiveFaults({ controlFile, eventsFile });
    kernel = createKernelService({
      endpoint,
      workerEntrypoint: absolute("../test-support/recovery-live-worker.mjs")
    });
    extra = createExtraService({
      endpoint,
      controlEndpoint: extraEndpoint,
      module: gatewayModule,
      config,
      dependencies: {}
    });
    await kernel.initialize();
    await extra.initialize();
  } else {
    await mkdir(join(directory, "extras", "channel-gateway"), { recursive: true });
    await writeFile(
      join(directory, "extras", "channel-gateway", "config.json"),
      JSON.stringify({ config }),
      { mode: 0o600 }
    );
    await launch("executor-kernel");
    client = attachKernel({ endpoint });
    await waitFor(async () => (await client.status()).execution_ready, "QA_KERNEL_START_FAILED");
    await launch("channel-gateway", [], {
      ...childEnvironment(process.env),
      NODE_OPTIONS: `--import=${pathToFileURL(absolute("../test-support/recovery-live-faults.mjs")).href}`,
      OCTO_RECOVERY_QA_CONTROL: controlFile,
      OCTO_RECOVERY_QA_EVENTS: eventsFile
    });
  }
  client ??= attachKernel({ endpoint });
  const extraStatus = () => inspectStatus(extraEndpoint);
  const ready = async () => (await extraStatus()).status.bots[0].state === "online";
  await waitFor(
    async () => (await faults()).filter((e) => e.event === "blocked_auth").length >= 2,
    "QA_STARTUP_RETRIES_MISSING",
    20000
  );
  check((await extraStatus()).status.bots[0].state === "retrying", "QA_STARTUP_NOT_RETRYING");
  const startupReadyAt = Date.now();
  await setFault({ blocked: false });
  await waitFor(ready, "QA_OFFLINE_STARTUP_RECOVERY_FAILED", 20000);
  const before = await client.status(),
    gatewayBefore = await extraStatus();
  check((before.pid === process.pid) === (mode === "sdk"), "QA_KERNEL_OWNERSHIP");
  check((gatewayBefore.pid === process.pid) === (mode === "sdk"), "QA_GATEWAY_OWNERSHIP");
  const imProbe = async (name) => {
    const value = marker(name),
      started = Date.now();
    await send(`Reply with exactly ${value}. Do not use tools.`);
    const reply = await waitFor(
      async () =>
        (await history()).find(
          (message) =>
            message.from_uid === receiver.id &&
            message.payload?.type === 1 &&
            message.payload.content?.trim() === value
        ),
      "QA_IM_REPLY_MISSING",
      120000
    );
    await waitFor(
      async () => (await extraStatus()).status.bots[0].workingTasks === 0,
      "QA_IM_TASK_STUCK"
    );
    check(
      (await history()).filter(
        (message) => message.from_uid === receiver.id && message.payload?.content?.trim() === value
      ).length === 1,
      "QA_DUPLICATE_REPLY"
    );
    report.checks.push({ name, pass: true, replyReadback: true, ms: Date.now() - started });
    console.error(`PASS ${mode}: ${name}`);
    return { value, id: reply.id };
  };
  stage = "startup-im";
  await imProbe("INITIAL_OFFLINE");
  report.startupRecoveryMs = Date.now() - startupReadyAt;
  check(report.startupRecoveryMs <= 180000, "QA_STARTUP_RECOVERY_OVER_BUDGET");
  const remembered = marker("MEMORY"),
    logicalSession = randomUUID();
  const direct = async (observer, name, providerSession, sessionId = logicalSession) => {
    const prompt = providerSession
      ? "Reply with only the exact marker I asked you to remember, without punctuation, quotes, formatting, or explanation. Do not use tools."
      : `Remember this exact marker:\n${remembered}\nReply with only that marker, without punctuation, quotes, formatting, or explanation. Do not use tools.`;
    const input = invocationInput(
      invokeRequest({
        invocationId: randomUUID(),
        runId: randomUUID(),
        agentSessionId: sessionId,
        prompt,
        modelInput: prompt,
        controlInstructions: "Follow only this test prompt. Never read credentials or other files.",
        approvalMode: "full_access",
        workdir: directory,
        ...(providerSession ? { providerSession } : {})
      }),
      "canonical",
      "codex"
    );
    let answer = "",
      actualSession,
      terminal;
    const deadline = AbortSignal.timeout(120000);
    for await (const event of observer.invoke(input, { signal: deadline })) {
      if (event.type === "session.update" && event.payload.providerSession)
        actualSession = event.payload.providerSession;
      if (event.type === "message.delta" && event.payload.channel === "final")
        answer += event.payload.text ?? "";
      if (["run.completed", "run.failed", "run.cancelled"].includes(event.type))
        terminal = event.type;
    }
    if (!(
      terminal === "run.completed" &&
      answer.trim() === remembered &&
      actualSession?.sessionId
    )) {
      report.directFailure = {
        name,
        terminal: terminal ?? "missing",
        exactMarkerMatch: answer.trim() === remembered,
        containsMarker: answer.includes(remembered),
        providerSessionPresent: !!actualSession?.sessionId
      };
      throw new Error("QA_DIRECT_RESULT_INVALID");
    }
    if (providerSession)
      check(
        actualSession.sessionId === providerSession.sessionId &&
          actualSession.resumeOutcome === "resumed",
        "QA_PROVIDER_SESSION_NOT_RESUMED"
      );
    report.checks.push({ name, pass: true, highLevelInvoke: true, resumed: !!providerSession });
    console.error(`PASS ${mode}: ${name}`);
    return actualSession;
  };
  stage = "direct-baseline";
  const existingSession = await direct(client, "DIRECT_BASELINE");
  stage = "ws-recovery";
  const blockedBefore = (await faults()).filter((e) => e.event === "blocked_auth").length;
  await setFault({ blocked: true, drop: 1 });
  await waitFor(
    async () => (await extraStatus()).status.bots[0].state === "retrying",
    "QA_DROP_NOT_DETECTED"
  );
  await waitFor(
    async () =>
      (await faults()).filter((e) => e.event === "blocked_auth").length >= blockedBefore + 2,
    "QA_RETRY_NOT_OBSERVED",
    25000
  );
  const networkReadyAt = Date.now();
  await setFault({ blocked: false });
  await waitFor(ready, "QA_WS_RECOVERY_FAILED", 25000);
  const recovered = await imProbe("AFTER_WS_LOSS");
  await direct(client, "DIRECT_AFTER_WS_LOSS", existingSession);
  report.wsRecoveryMs = Date.now() - networkReadyAt;
  check(report.wsRecoveryMs <= 180000, "QA_WS_RECOVERY_OVER_BUDGET");
  stage = "user-readback";
  // 搜索索引晚于消息同步可见；以同一回复 ID 和发送者确认，不重新发探针消息。
  await waitFor(
    async () => {
      const result = await octo(user.api_key, [
        "message",
        "search",
        "--chat-id",
        group.group_no,
        "--channel-type",
        "2",
        "--keyword",
        recovered.value
      ]);
      return (
        Array.isArray(result.data) &&
        result.data.some(
          (message) =>
            String(message.message_id) === recovered.id && message.sender_id === receiver.id
        )
      );
    },
    "QA_USER_SEARCH_REPLY_MISSING",
    60000
  );
  report.userKeyReplyReadback = true;
  stage = "active-worker-loss";
  const prompt =
    "Use the shell tool to run sleep 45. After it finishes reply DONE. Do not modify any files or send messages with tools.";
  const activeInput = invocationInput(
    invokeRequest({
      invocationId: randomUUID(),
      runId: randomUUID(),
      agentSessionId: randomUUID(),
      prompt,
      modelInput: prompt,
      controlInstructions: "Execute only the test command. Never read credentials or other files.",
      approvalMode: "full_access",
      workdir: directory
    }),
    "canonical",
    "codex"
  );
  let toolStarted = false;
  const activeResult = (async () => {
    try {
      let terminal;
      for await (const event of client.invoke(activeInput, {
        signal: AbortSignal.timeout(90000)
      })) {
        if (event.type === "tool_call.create") toolStarted = true;
        if (["run.completed", "run.failed", "run.cancelled"].includes(event.type))
          terminal = event.type;
      }
      return { terminal };
    } catch (error) {
      return { error: safeCode(error) };
    }
  })();
  await waitFor(() => toolStarted, "QA_REAL_TOOL_NOT_STARTED", 60000);
  const activeStatus = await client.status();
  process.kill(activeStatus.worker.pid, "SIGKILL");
  const oldResult = await activeResult;
  check(oldResult.error === "RUN_OUTCOME_UNKNOWN", "QA_OLD_RUN_NOT_LOST");
  await waitFor(
    async () => {
      const s = await client.status();
      return s.execution_ready && s.worker.generation > activeStatus.worker.generation;
    },
    "QA_WORKER_RECOVERY_FAILED",
    20000
  );
  report.oldRun = { ...oldResult, resubmitted: false };
  await imProbe("AFTER_WORKER_LOSS");
  stage = "four-direct-combinations";
  const fresh = attachKernel({ endpoint });
  try {
    for (const [label, observer] of [
      ["EXISTING_CLIENT", client],
      ["FRESH_CLIENT", fresh]
    ]) {
      await direct(observer, `${label}_EXISTING_PROVIDER_SESSION`, existingSession);
      await direct(observer, `${label}_FRESH_PROVIDER_SESSION`, undefined, randomUUID());
    }
  } finally {
    fresh.close();
  }
  if (browserUser) {
    stage = "browser-dm";
    const value = marker("BROWSER");
    const prompt = `Reply exactly ${value}. Do not use tools.`;
    check(
      await browser(
        `(()=>{const e=[...document.querySelectorAll('*')].find(e=>e.childElementCount===0&&e.textContent==='orbtex-codex');e?.click();return JSON.stringify(!!e)})()`
      ),
      "QA_BROWSER_CONVERSATION_MISSING"
    );
    await pause(500);
    const entered = await browser(
      `(()=>{const e=document.querySelector('[contenteditable=true][role=textbox]');if(!e||e.innerText.trim())return JSON.stringify(false);e.focus();document.execCommand('insertText',false,${JSON.stringify(prompt)});e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:${JSON.stringify(prompt)}}));return JSON.stringify(e.innerText.trim()===${JSON.stringify(prompt)})})()`
    );
    check(entered, "QA_BROWSER_COMPOSER_NOT_EMPTY");
    await browserEnter();
    await waitFor(
      async () =>
        (await history(browserUser.uid, 1)).some(
          (message) =>
            message.from_uid === receiver.id && message.payload?.content?.trim() === value
        ),
      "QA_BROWSER_REPLY_MISSING",
      120000
    );
    const dom = await browser(
      `JSON.stringify({reply:[...document.querySelectorAll('*')].some(e=>e.childElementCount===0&&e.textContent.trim()===${JSON.stringify(value)}),composerEmpty:!document.querySelector('[contenteditable=true][role=textbox]')?.innerText.trim()})`
    );
    check(dom.reply && dom.composerEmpty, "QA_BROWSER_DOM_NOT_CONFIRMED");
    report.browser = {
      actualComposerSend: true,
      botHistoryReplyReadback: true,
      domReplyPresent: true,
      screenshot: false
    };
    console.error(`PASS ${mode}: BROWSER_DM`);
  }
  const after = await client.status(),
    gatewayAfter = await extraStatus();
  check(
    after.pid === before.pid &&
      after.kernel_instance_id === before.kernel_instance_id &&
      gatewayAfter.pid === gatewayBefore.pid,
    "QA_SERVICE_RECREATED"
  );
  check(gatewayAfter.status.bots[0].workingTasks === 0, "QA_TASKS_REMAIN");
  report.servicesPreserved = true;
  report.workerGenerationAdvanced = after.worker.generation > before.worker.generation;
  report.faultEvents = await faults();
  report.pass = true;
} catch (error) {
  report.pass = false;
  report.failure = { stage, code: safeCode(error) };
  console.error(`FAIL ${mode}: ${stage}: ${safeCode(error)}`);
} finally {
  client?.close();
  const cleanup = [];
  if (extra) {
    try {
      cleanup.push({ component: "extra", ...(await extra.close()) });
    } catch (error) {
      cleanup.push({ component: "extra", complete: false, code: safeCode(error) });
    }
  }
  for (const entry of [...children].reverse()) {
    try {
      const result = await stopChild(entry);
      cleanup.push({ component: "cli", complete: result.code === 0, ...result });
    } catch (error) {
      cleanup.push({ component: "cli", complete: false, code: safeCode(error) });
    }
  }
  if (kernel) {
    try {
      cleanup.push({ component: "kernel", ...(await kernel.close()) });
    } catch (error) {
      cleanup.push({ component: "kernel", complete: false, code: safeCode(error) });
    }
  }
  restoreFaults?.();
  report.cleanup = cleanup;
  if (cleanup.some((entry) => !entry.complete)) report.pass = false;
  await rm(join(directory, "extras"), { recursive: true, force: true });
  await rm(cliDirectory, { recursive: true, force: true });
  report.cliConfigRemoved = true;
  report.finished = new Date().toISOString();
  await writeFile(reportFile, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  console.log(
    JSON.stringify({
      pass: report.pass,
      mode,
      report: reportFile,
      checks: report.checks.length,
      failure: report.failure,
      cleanupComplete: cleanup.every((entry) => entry.complete)
    })
  );
  if (!report.pass) process.exitCode = 1;
}
