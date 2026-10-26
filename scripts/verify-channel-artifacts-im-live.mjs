import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import { createKernelService } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { ImRuntime } from "@mininglamp-oss/octo-runtime-extra-channel-gateway";
import { getChannelMessages } from "../packages/octo-runtime-extra-channel-gateway/dist/transport/api/conversations.js";
import { artifactImage } from "../test-support/channel-artifact-samples.mjs";

// 显式 QA：测试 Bot 私聊或显式指定的测试群，真实模型；不输出消息正文或凭据。
const execute = promisify(execFile);
const gatewayRequire = createRequire(
  new URL("../packages/octo-runtime-extra-channel-gateway/package.json", import.meta.url)
);
const { fromMarkdown } = await import(gatewayRequire.resolve("mdast-util-from-markdown"));
const origin = "https://im-test.deepminer.com.cn";
let stage = "accounts",
  directory,
  runtime,
  kernel,
  group;
const diagnostics = [],
  calls = [];
const originalFetch = globalThis.fetch;
let gatewayUploads = 0;
globalThis.fetch = async (url, options) => {
  if (String(url).includes("/v1/bot/upload/presigned")) gatewayUploads++;
  return originalFetch(url, options);
};
async function cli(account, args, body) {
  const env = { ...process.env, OCTO_TOKEN: account.token, OCTO_API_BASE_URL: origin };
  delete env.OCTO_BOT_ID;
  delete env.OCTO_PROFILE;
  try {
    const { stdout } = await execute(
      "octo-cli",
      [...args, ...(body ? ["--data", JSON.stringify(body)] : [])],
      { env, timeout: 20000, maxBuffer: 1 << 20 }
    );
    const result = JSON.parse(stdout);
    assert.equal(result.ok, true, "CLI_REJECTED");
    return result.data;
  } catch (error) {
    let code = "QA_CLI_FAILED";
    try {
      const value = JSON.parse(error.stderr).error.code;
      if (typeof value === "string" && /^[a-zA-Z0-9_.-]+$/.test(value))
        code = `QA_CLI_${value.replace(/[.-]/g, "_").toUpperCase()}`;
    } catch {}
    throw new Error(code);
  }
}
async function wait(predicate, timeout = 240000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("QA_WAIT_TIMEOUT");
}
function links(text) {
  const output = [];
  const visit = (node) => {
    if (["link", "image"].includes(node.type)) output.push({ type: node.type, url: node.url });
    for (const child of node.children ?? []) visit(child);
  };
  visit(fromMarkdown(text));
  return output;
}
try {
  assert.ok(
    process.env.OCTO_CHANNEL_QA_ACCOUNTS && process.env.OCTO_CHANNEL_QA_USER,
    "QA_ACCOUNTS_REQUIRED"
  );
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
    (a) => a.name === (process.env.OCTO_ARTIFACT_QA_RECEIVER ?? "orbtex-opencode")
  );
  const sender = accounts.find(
    (a) => a.name === (process.env.OCTO_ARTIFACT_QA_SENDER ?? "orbtex-codex")
  );
  assert.ok(receiver && sender, "QA_BOTS_REQUIRED");
  for (const bot of [receiver, sender]) {
    assert.equal(bot.api, `${origin}/api`, "QA_ENVIRONMENT_REQUIRED");
    assert.ok(bot.token?.startsWith("bf_"), "QA_USER_BOT_REQUIRED");
    await cli(bot, ["config", "show"]);
  }
  const user = JSON.parse(await readFile(process.env.OCTO_CHANNEL_QA_USER, "utf8"));
  assert.equal(user.server_url, origin, "QA_USER_ENVIRONMENT_REQUIRED");
  stage = "user-identity";
  const verified = await fetch(`${origin}/api/v1/auth/verify-api-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: user.api_key }),
    signal: AbortSignal.timeout(15000)
  });
  assert.equal(verified.status, 200, "QA_USER_IDENTITY_FAILED");
  const owner = await verified.json();
  assert.ok(owner.uid, "QA_OWNER_REQUIRED");
  if (process.env.OCTO_CHANNEL_QA_GROUP) {
    group = { group_no: process.env.OCTO_CHANNEL_QA_GROUP };
    const result = await cli(receiver, ["group", "members", group.group_no]);
    const members = Array.isArray(result) ? result : result.members;
    assert.ok(
      members.some((member) => member.uid === sender.id),
      "QA_SENDER_NOT_IN_GROUP"
    );
    assert.ok(
      members.some((member) => member.uid === receiver.id),
      "QA_RECEIVER_NOT_IN_GROUP"
    );
    assert.ok(
      members
        .filter((member) => member.robot !== 1 && member.robot !== true)
        .every((member) => member.uid === owner.uid),
      "QA_GROUP_HAS_OTHER_HUMANS"
    );
  }
  directory = await mkdtemp(join(tmpdir(), "octo-artifact-im-"));
  await writeFile(join(directory, "image.png"), artifactImage());
  const manifest = join(directory, "manifest.json");
  await writeFile(
    manifest,
    JSON.stringify({
      version: 1,
      adapters: [
        {
          type: "codex",
          module: fileURLToPath(
            new URL("../packages/octo-runtime-adapter-codex/dist/index.js", import.meta.url)
          ),
          export: "createCodexAdapter",
          factory: true
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
      ...(group ? { group_ids: [group.group_no] } : {}),
      allowed_sender_ids: [sender.id],
      adapter: { adapter_type: "codex", workdir: directory },
      approval_mode: "full_access",
      run_timeout_ms: 180000
    },
    {
      kernel: {
        async *invoke(input, environment) {
          const trace = { terminals: [], tools: 0 };
          calls.push(trace);
          for await (const event of kernel.client.invoke(input, environment)) {
            if (["run.completed", "run.failed", "run.cancelled"].includes(event.type))
              trace.terminals.push(event.type);
            if (event.type === "tool_call.create") trace.tools++;
            yield event;
          }
        },
        cancelInvocation: (...args) => kernel.client.cancelInvocation(...args),
        respondInteraction: (...args) => kernel.client.respondInteraction(...args)
      },
      onDiagnostic: (code) => diagnostics.push(code)
    }
  );
  stage = "connect";
  await runtime.start();
  await wait(() => runtime.status.connected, 30000);
  assert.equal(runtime.status.connected, true, "QA_CONNECTION_FAILED");
  const history = () =>
    getChannelMessages({
      apiUrl: receiver.api,
      botToken: receiver.token,
      channelId: group?.group_no ?? sender.id,
      channelType: group ? 2 : 1,
      limit: 50,
      pullMode: 0
    });
  async function turn(prompt, index, marker) {
    await cli(sender, ["message", "send"], {
      channel_id: group?.group_no ?? receiver.id,
      channel_type: group ? 2 : 1,
      payload: { type: 1, content: prompt, mention: { uids: [receiver.id] } }
    });
    let answer;
    await wait(async () => {
      const trace = calls[index];
      if (!trace?.terminals.length) return false;
      assert.deepEqual(trace.terminals, ["run.completed"], "QA_MODEL_FAILED");
      answer = (await history()).find(
        (message) => message.from_uid === receiver.id && message.content.includes(marker)
      );
      return Boolean(answer && runtime.status.sessions.length === 0);
    });
    assert.equal(calls.length, index + 1, "QA_DUPLICATE_INVOCATION");
    assert.ok(!answer.content.includes("Attachment delivery failed"), "QA_ARTIFACT_FAILED");
    return answer;
  }
  stage = "generated-outputs";
  const marker = `ARTIFACT_${randomUUID().slice(0, 8)}`;
  const first = await turn(
    `Create a minimal self-contained HTML counter game named game.html and a Markdown report named report.md in the working directory using one local file write. Put ${marker} in both files. Do not run a browser, install dependencies, or change the supplied image.png. In your final answer write ${marker}, one Markdown link to game.html, one Markdown link to report.md, and one inline Markdown image of image.png. Follow the channel artifact delivery contract. Do not invoke messaging, upload, publishing or Drive tools.`,
    0,
    marker
  );
  const firstLinks = links(first.content);
  assert.equal(firstLinks.length, 3, "QA_GENERATED_LINKS_MISSING");
  assert.ok(!first.content.includes("File card delivery unconfirmed"), "QA_FILE_CARD_FAILED");
  assert.equal(
    firstLinks.filter((entry) => entry.type === "image").length,
    1,
    "QA_IMAGE_SYNTAX_MISSING"
  );
  assert.equal(
    new Set(firstLinks.map((entry) => entry.url)).size,
    firstLinks.length,
    "QA_DISTINCT_OUTPUTS_MISSING"
  );
  const expectedUploads = 3;
  assert.equal(gatewayUploads, expectedUploads, "QA_GENERATED_UPLOAD_COUNT");
  const historyAfterFirst = await history();
  const fileCards = historyAfterFirst.filter(
    (message) =>
      message.from_uid === receiver.id &&
      message.type === 8 &&
      firstLinks.some((entry) => entry.type === "link" && entry.url === message.url)
  );
  assert.equal(fileCards.length, 2, "QA_NATIVE_FILE_CARDS_MISSING_OR_DUPLICATED");
  assert.deepEqual(fileCards.map((card) => card.name).sort(), ["game.html", "report.md"]);
  for (const [index, name] of ["game.html", "report.md", "image.png"].entries()) {
    const local = await readFile(join(directory, name));
    const target =
      name === "image.png"
        ? firstLinks.find((entry) => entry.type === "image")
        : firstLinks.filter((entry) => entry.type === "link")[index];
    const response = await fetch(target.url, {
      redirect: "error",
      signal: AbortSignal.timeout(15000)
    });
    assert.equal(response.status, 200, "QA_ANONYMOUS_DOWNLOAD_FAILED");
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      createHash("sha256").update(local).digest("hex"),
      "QA_BYTES_MISMATCH"
    );
  }
  console.log(
    JSON.stringify({
      stage,
      realModel: true,
      realChat: true,
      gatewayUploads,
      anonymousDownloads: 3,
      nativeFileCards: 2,
      markdownLinksRetained: true,
      inlineImage: true,
      channelType: group ? "test-group" : "test-bot-dm"
    })
  );
  stage = "explicit-tool-upload";
  const secondMarker = `TOOL_${randomUUID().slice(0, 8)}`;
  const second = await turn(
    `Explicitly upload the existing game.html as a chat attachment with normal tool calls. Use octo-cli file presigned --filename game.html --fileSize <actual bytes> to obtain JSON data, then PUT the exact file to data.uploadUrl with data.contentType and data.contentDisposition unchanged. Do not print credentials or the signed upload URL; credentials are provided in the tool environment. Use the independent data.downloadUrl as the final Markdown link. Do not save to Drive, publish a website, or send a message with a tool. Include ${secondMarker} in the final reply.`,
    1,
    secondMarker
  );
  assert.ok(calls[1].tools > 0, "QA_TOOL_CALL_MISSING");
  assert.equal(gatewayUploads, expectedUploads, "QA_CLOUD_LINK_REUPLOADED");
  const secondLinks = links(second.content);
  assert.ok(
    secondLinks.some((entry) => /^https:\/\//.test(entry.url)),
    "QA_TOOL_CLOUD_LINK_MISSING"
  );
  const retained = await history();
  assert.equal(
    retained.filter(
      (message) =>
        message.from_uid === receiver.id &&
        message.type === 8 &&
        [...firstLinks, ...secondLinks].some((entry) => entry.url === message.url)
    ).length,
    2,
    "QA_NATIVE_FILE_CARD_DUPLICATED"
  );
  for (const card of fileCards)
    assert.equal(
      retained.filter((message) => message.message_id === card.message_id).length,
      1,
      "QA_FILE_CARD_HISTORY_CHANGED"
    );
  assert.ok(
    retained.some(
      (message) => message.message_id === first.message_id && message.content === first.content
    ),
    "QA_HISTORY_CHANGED"
  );
  assert.equal(
    retained.filter(
      (message) => message.from_uid === receiver.id && message.content.includes(secondMarker)
    ).length,
    1,
    "QA_DUPLICATE_FINAL"
  );
  console.log(
    JSON.stringify({
      stage,
      realModel: true,
      realChat: true,
      normalToolCalls: true,
      gatewayAdditionalUploads: 0,
      priorMessageRetained: true,
      duplicateFinal: false
    })
  );
} catch (error) {
  console.error(
    JSON.stringify({
      status: "failed",
      stage,
      code: /^[A-Z_0-9]+$/.test(error.message) ? error.message : "QA_VERIFICATION_FAILED",
      diagnostics: [...new Set(diagnostics)],
      ...(runtime
        ? {
            workingTasks: runtime.status.workingTasks,
            sessions: runtime.status.sessions.length,
            connectionState: runtime.status.state,
            connectionCode: /^[A-Z_0-9]+$/.test(runtime.status.error ?? "")
              ? runtime.status.error
              : undefined
          }
        : {}),
      calls: calls.map(({ terminals, tools }) => ({ terminals, tools })),
      ...(group ? { groupId: group.group_no } : {})
    })
  );
  process.exitCode = 1;
} finally {
  if (runtime) await runtime.close();
  if (kernel) assert.equal((await kernel.close()).complete, true);
  globalThis.fetch = originalFetch;
  if (directory) await rm(directory, { recursive: true, force: true });
}
