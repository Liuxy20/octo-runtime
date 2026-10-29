// 手动专项：先 pnpm build，再 node --test test/manual/channel-preparation-errors.test.mjs。
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { build_im_contexts } from "../../packages/octo-runtime-extra-channel-gateway/dist/transport/contexts.js";
import { ImImageInputError } from "../../packages/octo-runtime-extra-channel-gateway/dist/transport/image-input.js";

const context = (items = []) => ({ schema: "octo.context-envelope/v3", items });
const generic = "本轮输入或执行配置准备失败，尚未发起执行。请检查配置、会话权限或稍后重试。";
const workdirMessage = "本轮工作目录与固定目录配置冲突，尚未发起执行。请检查工作目录配置。";
const ruleMessage = "规则数据格式不符合协议，尚未发起执行。请检查规则服务返回格式。";
const privateDetail = "PRIVATE_PATH_RULE_BODY_AND_CREDENTIAL";

async function until(predicate) {
  for (let i = 0; i < 300; i++) {
    if (predicate()) return;
    await delay(10);
  }
  assert.fail("channel did not settle");
}

async function fixture(t, platform) {
  const base = `../../packages/octo-runtime-extra-channel-${platform}/dist/`;
  const { ImRuntime, MemoryImSessionStore } = await import(base + "index.js");
  const transport = await import(base + "transport/channel.js");
  const Transport = transport[platform === "gateway" ? "GatewayTransport" : "WecomTransport"];
  let receive,
    invocations = 0,
    cancellations = 0,
    sequence = 0;
  const replies = [],
    diagnostics = [],
    logs = [],
    failureCards = [];
  t.mock.method(Transport.prototype, "start", async function () {
    receive = this.callbacks.onMessage;
  });
  t.mock.method(Transport.prototype, "close", async () => {});
  t.mock.method(globalThis, "fetch", async () => {
    throw Error("External network forbidden");
  });
  const config = {
    bot_id: "preparation-fixture",
    ...(platform === "gateway"
      ? { api_url: "https://im-test.deepminer.com.cn/api", spaceId: "fixture-space" }
      : { app_secret: randomBytes(16).toString("hex") }),
    adapter: { adapter_type: "codex", workdir: process.cwd() }
  };
  const sessions = new MemoryImSessionStore();
  const runtime = new ImRuntime(config, {
    sessions,
    onDiagnostic: (code) => diagnostics.push(code),
    log: (...entry) => logs.push(entry),
    kernel: {
      async *invoke() {
        invocations++;
        yield {
          protocolVersion: 2,
          type: "message.delta",
          payload: { messageId: "m", channel: "final", text: "answer" }
        };
        yield { protocolVersion: 2, type: "run.completed", payload: {} };
      },
      async cancelInvocation() {
        cancellations++;
        return { accepted: true };
      }
    }
  });
  t.after(async () => {
    try {
      await runtime.close();
    } finally {
      sessions.close?.();
    }
  });
  await runtime.start();
  const send = (overrides = {}) =>
    receive({
      messageId: `preparation-${++sequence}`,
      senderId: "owner",
      conversationId: "chat",
      conversationKind: "direct",
      text: "inspect",
      async buildContext() {
        return context();
      },
      async reply(text) {
        replies.push(text);
      },
      async replyFailure(event) {
        failureCards.push(event);
      },
      ...overrides
    });
  const failed = async (expectedMessage, expectedCode) => {
    await until(() => replies.length === 1 && runtime.status.sessions.length === 0);
    assert.equal(invocations, 0);
    assert.equal(cancellations, 0);
    assert.deepEqual(failureCards, []);
    assert.deepEqual(replies, [expectedMessage]);
    assert.deepEqual(diagnostics, [
      ...(expectedCode ? [expectedCode] : []),
      "IM_CONTEXT_PREPARATION_FAILED"
    ]);
    assert.equal(runtime.status.state, "online");
    assert.equal(runtime.status.error, null);
    assert.doesNotMatch(
      JSON.stringify({ replies, diagnostics, logs, status: runtime.status }),
      new RegExp(privateDetail)
    );
  };
  return { config, runtime, send, failed, replies, invocations: () => invocations };
}

for (const platform of ["gateway", "wecom"]) {
  for (const [code, message] of [
    ["IM_AGENT_WORKDIR_FIXED", workdirMessage],
    ["IM_RULE_PROTOCOL_INVALID", ruleMessage]
  ]) {
    test(`${platform}: preserves safe preparation cause ${code}`, async (t) => {
      const f = await fixture(t, platform);
      f.send({
        async buildContext() {
          throw Error(code);
        }
      });
      await f.failed(message, code);
    });
  }

  for (const [name, error] of [
    ["unknown Error", Error(privateDetail)],
    ["non-Error", { code: "IM_RULE_PROTOCOL_INVALID", message: privateDetail }],
    ["rule code with private suffix", Error(`IM_RULE_PROTOCOL_INVALID ${privateDetail}`)],
    ["workdir code with private suffix", Error(`IM_AGENT_WORKDIR_FIXED ${privateDetail}`)],
    ["prototype key", Error("constructor")],
    ["prototype accessor", Error("__proto__")]
  ]) {
    test(`${platform}: keeps ${name} generic`, async (t) => {
      const f = await fixture(t, platform);
      f.send({
        async buildContext() {
          throw error;
        }
      });
      await f.failed(generic);
    });
  }

  for (const code of ["IM_CONTEXT_LOADING_FAILED", "IM_CONTEXT_RESULT_INVALID"]) {
    test(`${platform}: retains existing ${code} diagnostic`, async (t) => {
      const f = await fixture(t, platform);
      f.send({
        async buildContext() {
          throw Error(code);
        }
      });
      await f.failed(generic, code);
    });
  }
}

test("gateway: real dispatcher rejects a conflicting workspace and next message can execute", async (t) => {
  const f = await fixture(t, "gateway");
  f.send({
    async buildContext() {
      return context([
        {
          namespace: "octo.execution",
          name: "workspace",
          payload: { mode: "fixed", path: join(process.cwd(), privateDetail) }
        }
      ]);
    }
  });
  await f.failed(workdirMessage, "IM_AGENT_WORKDIR_FIXED");
  f.send();
  await until(() => f.invocations() === 1 && f.runtime.status.sessions.length === 0);
  assert.equal(f.replies.at(-1), "answer");
});

test("gateway: real rule reader retains protocol failure without leaking the document", async (t) => {
  const f = await fixture(t, "gateway");
  const credential = randomBytes(16).toString("hex");
  let reads = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    assert.equal(String(url), `${f.config.api_url}/v1/bot/groups/group/md`);
    reads++;
    return Response.json({ content: privateDetail, version: "invalid" });
  });
  f.send({
    async buildContext(signal) {
      return context(
        await build_im_contexts(
          f.config,
          {
            messageId: "rule",
            fromUid: "owner",
            channelId: "group",
            channelType: 2,
            payload: { type: 1, content: "inspect" }
          },
          credential,
          signal
        )
      );
    }
  });
  await f.failed(ruleMessage, "IM_RULE_PROTOCOL_INVALID");
  assert.equal(reads, 1);
});

test("gateway: context failure on an image message takes precedence over image fallback", async (t) => {
  const f = await fixture(t, "gateway");
  let imageReads = 0;
  f.send({
    async buildContext() {
      throw Error("IM_RULE_PROTOCOL_INVALID");
    },
    async buildInputs() {
      imageReads++;
      throw Error(privateDetail);
    }
  });
  await f.failed(ruleMessage, "IM_RULE_PROTOCOL_INVALID");
  assert.equal(imageReads, 0);
});

for (const [name, error, message] of [
  [
    "known image error",
    new ImImageInputError("PNG 图片已损坏或不完整。"),
    "PNG 图片已损坏或不完整。"
  ],
  [
    "unknown image error",
    Error(privateDetail),
    "图片输入准备失败，尚未发起执行。请检查图片或稍后重试。"
  ]
]) {
  test(`gateway: preserves ${name} reply`, async (t) => {
    const f = await fixture(t, "gateway");
    f.send({
      async buildInputs() {
        throw error;
      }
    });
    await f.failed(message);
  });
}
