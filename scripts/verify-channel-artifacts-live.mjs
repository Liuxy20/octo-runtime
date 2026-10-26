import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { artifactPolicy } from "../packages/octo-runtime-extra-channel-gateway/dist/delivery/artifact-policy.js";
import { prepareArtifacts } from "../packages/octo-runtime-extra-channel-gateway/dist/delivery/artifacts.js";
import { uploadChatAttachment } from "../packages/octo-runtime-extra-channel-gateway/dist/transport/api/files.js";
import { verifyBotIdentity } from "../packages/octo-runtime-extra-channel-gateway/dist/transport/auth.js";
import { artifactImage } from "../test-support/channel-artifact-samples.mjs";

// 仅上传测试文件和匿名下载；不注册 IM、不建群、不向任何会话发送消息。
async function account() {
  if (process.env.OCTO_ARTIFACT_QA_CONFIG) {
    const source = JSON.parse(await readFile(process.env.OCTO_ARTIFACT_QA_CONFIG, "utf8"));
    const candidates = source.config?.bots ?? source.bots ?? [source];
    return candidates.find(
      (bot) => bot.api_url === "https://im-test.deepminer.com.cn/api" && bot.bf_token
    );
  }
  assert.ok(process.env.OCTO_CHANNEL_QA_ACCOUNTS, "QA_CONFIG_REQUIRED");
  const blocks = (await readFile(process.env.OCTO_CHANNEL_QA_ACCOUNTS, "utf8"))
    .split(/(?=Bot Name:)/)
    .slice(1);
  return blocks
    .map((block) => {
      const value = (key) => block.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]?.trim();
      return {
        bot_id: value("Bot ID"),
        bf_token: value("Bot Token"),
        api_url: value("API Server")
      };
    })
    .find((bot) => bot.api_url === "https://im-test.deepminer.com.cn/api" && bot.bf_token);
}

async function download(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    redirect: "error",
    headers: {}
  });
  assert.equal(response.status, 200, "ANONYMOUS_DOWNLOAD_REJECTED");
  const parts = [];
  let count = 0;
  for await (const part of response.body) {
    count += part.length;
    assert.ok(count <= 1 << 20, "DOWNLOAD_TOO_LARGE");
    parts.push(part);
  }
  return Buffer.concat(parts);
}

let workspace;
let stage = "account";
try {
  const bot = await account();
  assert.ok(bot, "TEST_BOT_REQUIRED");
  assert.equal(bot.api_url, "https://im-test.deepminer.com.cn/api", "TEST_ENVIRONMENT_REQUIRED");
  const owner = new AbortController();
  stage = "identity";
  const identity = await verifyBotIdentity(bot.api_url, bot.bf_token, owner.signal);
  assert.equal(identity.bot_uid, bot.bot_id, "BOT_IDENTITY_MISMATCH");
  workspace = await mkdtemp(join(tmpdir(), "octo-artifact-live-"));
  const samples = [
    {
      name: "game.html",
      mime: "text/html",
      bytes: Buffer.from(
        '<!doctype html><html><meta charset="utf-8"><title>Attachment QA</title><button id="game">0</button><script>game.onclick=()=>game.textContent=Number(game.textContent)+1</script></html>'
      )
    },
    {
      name: "image.png",
      mime: "image/png",
      bytes: artifactImage()
    }
  ];
  for (const sample of samples)
    await writeFile(join(workspace, sample.name), sample.bytes, { mode: 0o600 });
  const context = {
    schema: "octo.context-envelope/v3",
    items: [
      {
        namespace: "octo.execution",
        name: "workspace",
        payload: { mode: "fixed", path: workspace }
      }
    ]
  };
  const urls = new Map();
  stage = "prepare";
  const { text: result, files } = await prepareArtifacts(
    '[Game](./game.html "HTML attachment")\n\n![Pixel](./image.png "Image attachment")\n\n[Download image](./image.png)',
    artifactPolicy(bot, context, true),
    owner.signal,
    async (bytes, name, mime, uploadSignal) => {
      const url = await uploadChatAttachment(
        bot.api_url,
        bot.bf_token,
        bytes,
        name,
        mime,
        uploadSignal
      );
      urls.set(name, url);
      return url;
    }
  );
  const failures = [...result.matchAll(/\(([a-z]+(?:-[a-z]+)+)\)/g)].map((match) => match[1]);
  assert.ok(!failures.length, `DELIVERY_${failures.join("_").replaceAll("-", "_").toUpperCase()}`);
  assert.equal(urls.size, 2, "UPLOAD_DEDUPLICATION_FAILED");
  assert.equal(files.length, 2, "FILE_CARD_PREPARATION_FAILED");
  assert.ok(!result.includes("./"), "LOCAL_REFERENCE_REMAINS");
  assert.ok(result.includes("![Pixel]("), "IMAGE_SYNTAX_LOST");
  for (const sample of samples) {
    stage = `download:${sample.name}`;
    const bytes = await download(urls.get(sample.name));
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      createHash("sha256").update(sample.bytes).digest("hex"),
      "DOWNLOAD_BYTES_MISMATCH"
    );
    console.log(
      JSON.stringify({
        artifact: sample.name,
        upload: "passed",
        anonymousDownload: "passed",
        bytes: bytes.length,
        persistentUrl: true
      })
    );
  }
  console.log(
    JSON.stringify({
      environment: "im-test",
      markdownRewrite: "passed",
      deduplication: "passed",
      channelMessage: "not-requested",
      clientImageRendering: "not-tested",
      historyRetention: "not-tested"
    })
  );
} catch (error) {
  // 不输出第三方错误原文、URL 或认证响应；报告只含受控检查码。
  const code =
    typeof error?.message === "string" && /^[A-Z_0-9]+$/.test(error.message)
      ? error.message
      : "LIVE_ARTIFACT_VERIFICATION_FAILED";
  console.error(JSON.stringify({ status: "failed", stage, code }));
  process.exitCode = 1;
} finally {
  if (workspace) await rm(workspace, { recursive: true, force: true });
}
