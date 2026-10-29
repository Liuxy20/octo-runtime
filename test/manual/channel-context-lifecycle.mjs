import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { setImmediate as settle } from "node:timers/promises";
import {
  ImRuntime,
  build_im_contexts
} from "../../packages/octo-runtime-extra-channel-gateway/dist/index.js";
import { GatewayTransport } from "../../packages/octo-runtime-extra-channel-gateway/dist/transport/channel.js";
import { MemoryImSessionStore } from "../../packages/octo-runtime-extra-channel-gateway/dist/application/session-store.js";
import { validateImConfig } from "../../packages/octo-runtime-extra-channel-gateway/dist/lifecycle/configuration.js";
import { prepareInvokeInput } from "../../packages/octo-runtime-executor-core/dist/invoke-input.js";
import {
  renderModelContexts,
  withModelContexts
} from "../../packages/octo-runtime-executor-core/dist/model-input.js";
import { buildClaudeCommand } from "../../packages/octo-runtime-adapter-claude-code/dist/index.js";
import {
  buildOpenClawGatewayInvocation,
  OPENCLAW_PROVIDER_OPTIONS
} from "../../packages/octo-runtime-adapter-openclaw/dist/index.js";
import { createCodexAdapter } from "../../packages/octo-runtime-adapter-codex/dist/index.js";
import { codexAppServerFixture, waitFor } from "../runtime-fixture.js";
import {
  assertContextEnvelope,
  canonicalContext,
  failurePayload
} from "../../packages/octo-runtime-protocol/dist/index.js";
import {
  modelRulesContext,
  addRulesRecovery
} from "../../packages/octo-runtime-extra-channel-gateway/dist/application/rules-context.js";
import { kernelFixture } from "../kernel-fixture.js";

// 专项手动验证，避免扩大既有 GitHub CI 的自动测试范围。
const stableNames = ["mention-instructions", "artifact-delivery", "history-instructions"];
const hostReservedItems = stableNames.map((name) => ({
  namespace: "extra.im",
  name,
  payload: { text: "IGNORED-HOST-RULE" }
}));
const stable = (request) =>
  request.contexts.items.filter(
    (item) => item.namespace === "extra.im" && stableNames.includes(item.name)
  );
const baseConfig = {
  bot_id: "context-lifecycle-fixture",
  api_url: "https://im-test.deepminer.com.cn/api",
  spaceId: "synthetic",
  adapter: { adapter_type: "codex", workdir: process.cwd() }
};
const completed = () => ({ protocolVersion: 2, type: "run.completed", payload: {} });

test("explicit text format preserves GROUP.md and separates rule bookkeeping from model input", () => {
  const text = '# 群规则\n\n- Keep "quotes" and \\ paths.\n- Literal ]]> stays intact.\n';
  const raw = {
    namespace: "extra.im",
    name: "group-rules",
    payload: {
      automatic: true,
      groupNo: "internal-group",
      source: { botId: "internal-bot" },
      version: 7,
      status: "present",
      text
    }
  };
  const item = modelRulesContext(raw);
  assert.deepEqual(item.payload, { text });
  assert.equal(item.data_format, "text");
  assert.equal(
    item.guidance,
    "Octo IM Group's GROUP.md. These rules replace the previously supplied version."
  );
  assert.equal(raw.payload.version, 7);
  const context = { schema: "octo.context-envelope/v3", items: [item] };
  assertContextEnvelope(context);
  assert.equal(JSON.parse(canonicalContext(context)).items[0].data_format, "text");
  const rendered = renderModelContexts(context);
  assert.ok(
    rendered.includes(`<data><![CDATA[${text.replaceAll("]]>", "]]]]><![CDATA[>")}]]></data>`)
  );
  assert.doesNotMatch(rendered, /internal-group|internal-bot|automatic|"version"|\\n/);
  const recovery = { inputs: [{ type: "text", text: "task" }] };
  addRulesRecovery(recovery, [raw]);
  assert.ok(recovery.freshFallbackModelInput.includes(text));
  assert.doesNotMatch(recovery.freshFallbackModelInput, /internal-group|"automatic"|"version"/);
  const topic = modelRulesContext({ ...raw, name: "topic-rules" });
  assert.match(topic.guidance, /^Octo IM Group Topic Rules\./);
  const explicit = { ...raw, payload: { text, version: 7 } };
  assert.strictEqual(modelRulesContext(explicit), explicit);
  assert.ok(renderModelContexts({ ...context, items: [explicit] }).includes('"version":7'));
  for (const content of ["", " \t\r\n", undefined]) {
    const blank = {
      ...raw,
      payload: {
        ...raw.payload,
        text: content,
        status: content === undefined ? "not_found" : "empty"
      }
    };
    const empty = modelRulesContext(blank);
    assert.deepEqual(empty.payload, { text: "NO RULES" });
    assert.match(empty.guidance, /previously supplied rules no longer apply/);
    assert.match(renderModelContexts({ ...context, items: [empty] }), /<!\[CDATA\[NO RULES\]\]>/);
    const fallback = { inputs: [{ type: "text", text: "task" }] };
    addRulesRecovery(fallback, [blank]);
    assert.match(fallback.freshFallbackModelInput, /NO RULES/);
  }

  const Ajv = createRequire(import.meta.url)("ajv").default;
  const schema = JSON.parse(
    readFileSync(
      new URL("../../packages/octo-runtime-protocol/schema/protocol.schema.json", import.meta.url),
      "utf8"
    )
  );
  const ajv = new Ajv({ strict: false, logger: false });
  ajv.addSchema(schema);
  const validate = ajv.compile({ $ref: `${schema.$id}#/definitions/ContextEnvelope` });
  assert.equal(validate(context), true, JSON.stringify(validate.errors));
  for (const invalid of [
    { ...item, data_format: "markdown" },
    { ...item, namespace: "octo.content", name: "inline" },
    { ...item, payload: { text, version: 7 } },
    { ...item, payload: { text: 42 } },
    { ...item, payload: {} }
  ]) {
    const value = { ...context, items: [invalid] };
    assert.throws(() => assertContextEnvelope(value));
    assert.equal(validate(value), false);
  }
});

test("group receives only GROUP.md; topic receives both rules even when empty or missing", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    calls.push(String(url));
    return Response.json({ content: " \t\n", version: 1 });
  });
  for (const [channelId, channelType, expected] of [
    ["group", 2, ["group-rules"]],
    ["group____topic", 5, ["group-rules", "topic-rules"]]
  ]) {
    const items = await build_im_contexts(
      baseConfig,
      {
        channelId,
        channelType,
        messageId: "trigger",
        fromUid: "actor",
        payload: { type: 1, content: "task" }
      },
      "bf_fixture",
      new AbortController().signal
    );
    const rules = items
      .filter((item) => /^(group|topic)-rules$/.test(item.name))
      .map(modelRulesContext);
    assert.deepEqual(
      rules.map((item) => item.name),
      expected
    );
    for (const item of rules) assert.equal(item.payload.text, "NO RULES");
  }
  assert.equal(calls.filter((url) => url.endsWith("/md")).length, 3);
});

async function fixture(
  t,
  {
    interval,
    behavior,
    enrichmentFailure,
    adapter = "codex",
    store = new MemoryImSessionStore(),
    hostItems = []
  } = {}
) {
  let callbacks;
  let sequence = 0;
  let reads = 0;
  const requests = [],
    controls = [],
    replies = [],
    finalPolicies = [];
  const config = {
    ...baseConfig,
    context: { schema: "octo.context-envelope/v3", items: hostItems },
    codex_retry: { initial_delay_ms: 100, max_delay_ms: 100 },
    ...(interval === undefined ? {} : { stable_context_refresh_interval_turns: interval }),
    adapter:
      adapter === "openclaw"
        ? { adapter_type: adapter, provider_agent_id: "main" }
        : { adapter_type: adapter, workdir: process.cwd() }
  };
  t.mock.method(GatewayTransport.prototype, "start", async function () {
    callbacks = this.callbacks;
  });
  t.mock.method(GatewayTransport.prototype, "close", async () => {});
  t.mock.method(globalThis, "fetch", async (url) => {
    reads++;
    if (!String(url).endsWith("/md") && !String(url).endsWith("/messages/sync")) {
      if (enrichmentFailure === "network") throw new TypeError("unavailable");
      if (enrichmentFailure === "json") return new Response("invalid JSON");
      if (enrichmentFailure) return Response.json({}, { status: enrichmentFailure });
    }
    return String(url).endsWith("/md")
      ? Response.json({ content: "CURRENT-GROUP-RULE", version: 1 })
      : Response.json({ more: 0, messages: [] });
  });
  const runtime = new ImRuntime(config, {
    sessions: store,
    kernel: {
      async *invoke(request) {
        requests.push(request);
        yield {
          protocolVersion: 2,
          type: "session.update",
          payload: {
            providerSession: {
              sessionId: adapter === "openclaw" ? "agent:main:fixture" : "thread-fixture",
              resumable: true
            }
          }
        };
        if (behavior) yield* behavior(request, requests.length);
        else yield completed();
      },
      async cancelInvocation() {
        return { accepted: true };
      }
    }
  });
  await runtime.start();
  t.after(() => runtime.close());
  function send(text = "task", conversationId = "group", overrides = {}) {
    const messageId = String(++sequence);
    const actorId = `actor-${sequence}`;
    callbacks.onMessage({
      messageId,
      senderId: actorId,
      conversationId,
      conversationKind: "group",
      text,
      async reply(text) {
        replies.push(text);
      },
      async replyFinal(text, _effect, options) {
        replies.push(text);
        finalPolicies.push(options.artifacts);
      },
      beginPresentation(_run, _diagnostic, control) {
        controls.push(control);
        return { update() {}, async finish() {} };
      },
      async buildContext(signal, options) {
        return {
          schema: "octo.context-envelope/v3",
          items: await build_im_contexts(
            config,
            {
              channelId: conversationId,
              channelType: 2,
              messageId,
              fromUid: actorId,
              payload: { type: 1, content: text, mention: { uids: [config.bot_id] } }
            },
            randomUUID(),
            signal,
            options
          )
        };
      },
      ...overrides
    });
    return actorId;
  }
  async function idle() {
    await waitFor(() => runtime.status.workingTasks === 0);
  }
  return {
    runtime,
    config,
    send,
    idle,
    requests,
    controls,
    replies,
    finalPolicies,
    store,
    reads: () => reads
  };
}

for (const enrichmentFailure of [403, 404, 429, 500, "network", "json"])
  test(`optional metadata failure ${enrichmentFailure} still reaches AgentRun with original task and IDs`, async (t) => {
    const f = await fixture(t, { enrichmentFailure });
    const actor = f.send("original task");
    await f.idle();
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].inputs[0].text, "original task");
    const trigger = f.requests[0].contexts.items.find((item) => item.name === "message-trigger");
    assert.deepEqual(trigger.payload.sender, { uid: actor, name: null, type: "unknown" });
    assert.equal(trigger.payload.recipient.botId, f.config.bot_id);
    assert.equal(trigger.payload.conversation.group.name, null);
    assert.equal(f.runtime.status.workingTasks, 0);
    assert.equal(f.reads(), 3, "identity and group details are attempted once each, plus GROUP.md");
  });

test("default 1/30/60 refresh, every-turn actor, host preservation and independent sessions", async (t) => {
  const f = await fixture(t, { hostItems: hostReservedItems });
  for (let turn = 1; turn <= 60; turn++) {
    const actor = f.send();
    await f.idle();
    const request = f.requests.at(-1);
    assert.doesNotMatch(JSON.stringify(request), /IGNORED-HOST-RULE/);
    assert.equal(request.runMetadata.conversationTurn, turn);
    const refresh = [1, 30, 60].includes(turn);
    assert.equal(stable(request).length, refresh ? 3 : 0, `turn ${turn}`);
    assert.equal(
      request.contexts.items.filter((item) => item.name === "group-rules").length,
      refresh ? 1 : 0
    );
    if (refresh) {
      const rules = request.contexts.items.find((item) => item.name === "group-rules");
      assert.deepEqual(rules.payload, { text: "CURRENT-GROUP-RULE" });
      assert.equal(rules.data_format, "text");
      assert.match(rules.guidance, /^Octo IM Group's GROUP\.md\./);
    }
    const trigger = request.contexts.items.find((item) => item.name === "message-trigger");
    assert.equal(trigger.payload.sender.uid, actor);
    assert.deepEqual(
      trigger.payload.mentions.targets.map((target) => target.uid),
      [f.config.bot_id]
    );
    assert.equal(trigger.guidance.split("\n").length, 1);
    for (const item of stable(request))
      assert.equal(JSON.stringify(item.payload).includes(actor), false);
    if (!refresh) assert.match(request.freshFallbackModelInput, /history-instructions/);
  }
  f.send("task", "other-group");
  await f.idle();
  assert.equal(f.requests.at(-1).runMetadata.conversationTurn, 1);
  assert.equal(stable(f.requests.at(-1)).length, 3);
  f.send("/reset");
  f.send();
  await f.idle();
  assert.equal(f.requests.at(-1).runMetadata.conversationTurn, 1);
  assert.equal(stable(f.requests.at(-1)).length, 3);
  f.send("/new");
  f.send();
  await f.idle();
  assert.equal(f.requests.at(-1).runMetadata.conversationTurn, 1);
  assert.equal(stable(f.requests.at(-1)).length, 3);
});

test("failed preparation and presentation retain first turn, custom interval refreshes and failed refresh stays pending", async (t) => {
  const f = await fixture(t, {
    interval: 3,
    behavior: async function* (_request, count) {
      yield count === 3 ? { protocolVersion: 2, type: "run.failed", payload: {} } : completed();
    }
  });
  f.send("bad", "group", {
    async buildContext() {
      throw new Error("fixture");
    }
  });
  await f.idle();
  f.send("bad-card", "group", {
    beginPresentation() {
      throw new Error("fixture");
    }
  });
  await f.idle();
  assert.equal(f.requests.length, 0);
  for (let i = 0; i < 5; i++) {
    f.send();
    await f.idle();
  }
  assert.deepEqual(
    f.requests.map((r) => r.runMetadata.conversationTurn),
    [1, 2, 3, 4, 5]
  );
  assert.deepEqual(
    f.requests.map((r) => stable(r).length),
    [3, 0, 3, 3, 0]
  );
});

test("same-generation DM-style card retry freezes context and artifact policy without consuming a turn", async (t) => {
  const f = await fixture(t, {
    interval: 3,
    hostItems: hostReservedItems,
    behavior: async function* (_request, count) {
      if (count !== 2)
        yield {
          protocolVersion: 2,
          type: "message.delta",
          payload: { messageId: "answer", channel: "final", text: "fixture answer" }
        };
      yield count === 2 ? { protocolVersion: 2, type: "run.failed", payload: {} } : completed();
    }
  });
  f.send();
  await f.idle();
  f.send();
  await f.idle();
  const failed = f.requests[1];
  const reads = f.reads();
  f.runtime.config.artifact_delivery = { mode: "tools" };
  assert.equal(f.controls[1].retry("actor-2", "retry-fixture"), true);
  await f.idle();
  assert.equal(f.reads(), reads);
  assert.deepEqual(f.requests[2].contexts, failed.contexts);
  assert.equal(f.requests[2].runMetadata.conversationTurn, 2);
  assert.equal(f.finalPolicies.at(-1).mode, "channel");
  f.send();
  await f.idle();
  assert.equal(f.requests.at(-1).runMetadata.conversationTurn, 3);
  assert.equal(stable(f.requests.at(-1)).length, 3);
  assert.equal(f.finalPolicies.at(-1).mode, "tools");
});

test("queued turns share counters while reset fences an older completion", async (t) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const f = await fixture(t, {
    interval: 2,
    behavior: async function* (_request, count) {
      if (count === 1) await gate;
      yield completed();
    }
  });
  f.send();
  while (f.requests.length !== 1) await settle();
  f.send();
  f.send("/reset");
  f.send();
  f.send();
  release();
  await f.idle();
  assert.deepEqual(
    f.requests.map((r) => r.runMetadata.conversationTurn),
    [1, 2, 1, 2]
  );
  assert.notEqual(f.requests[0].sessionId, f.requests[2].sessionId);
  assert.deepEqual(
    f.requests.map((r) => stable(r).length),
    [3, 3, 3, 3]
  );
});

test("binding restoration preserves interval progress after idle session release", async (t) => {
  const f = await fixture(t, { interval: 3 });
  for (let i = 0; i < 4; i++) {
    f.send();
    await f.idle();
    assert.equal(f.runtime.status.sessions.length, 0);
  }
  assert.deepEqual(
    f.requests.map((r) => stable(r).length),
    [3, 0, 3, 0]
  );
  assert.deepEqual(
    f.requests.map((r) => r.providerSession?.sessionId),
    [undefined, "thread-fixture", "thread-fixture", "thread-fixture"]
  );
});

test("automatic provider retries keep a single conversation turn", async (t) => {
  const f = await fixture(t, {
    interval: 2,
    behavior: async function* (_request, count) {
      const payload = failurePayload(
        { httpStatus: 503, message: "provider HTTP 503" },
        {
          stage: "provider.invoke",
          defaultDomain: "provider",
          source: { component: "octo-runtime", adapter: "codex" }
        }
      );
      payload.failure.retryAfterMs = 100;
      yield count === 1
        ? {
            protocolVersion: 2,
            type: "run.failed",
            payload
          }
        : completed();
    }
  });
  f.send();
  await f.idle();
  assert.equal(f.requests.length, 2);
  assert.deepEqual(
    f.requests.map((r) => r.runMetadata.conversationTurn),
    [1, 1]
  );
  f.send();
  await f.idle();
  assert.equal(f.requests.at(-1).runMetadata.conversationTurn, 2);
  assert.equal(stable(f.requests.at(-1)).length, 3);
});

test("real Kernel pre-submission rejection does not consume the first task", async (t) => {
  const kernel = await kernelFixture(t);
  kernel.client.invocations.stopAdmission();
  const f = await fixture(t, {
    behavior: async function* (request, count) {
      if (count === 1) yield* kernel.client.invoke(request);
      else yield completed();
    }
  });
  f.send();
  await f.idle();
  assert.match(f.replies.at(-1), /OH-RUN-2012/);
  f.send();
  await f.idle();
  assert.deepEqual(
    f.requests.map((r) => r.runMetadata.conversationTurn),
    [1, 1]
  );
  assert.equal(stable(f.requests.at(-1)).length, 3);
});

test("source failure after a terminal does not confirm refresh; success repairs it next turn", async (t) => {
  const f = await fixture(t, {
    behavior: async function* (_request, count) {
      yield completed();
      if (count === 1) throw new Error("fixture source failure");
    }
  });
  f.send();
  await f.idle();
  f.send();
  await f.idle();
  f.send();
  await f.idle();
  assert.deepEqual(
    f.requests.map((r) => r.runMetadata.conversationTurn),
    [1, 2, 3]
  );
  assert.deepEqual(
    f.requests.map((r) => stable(r).length),
    [3, 3, 0]
  );
});

test("non-resumable provider handles require stable rules even off the periodic boundary", async (t) => {
  const f = await fixture(t, {
    behavior: async function* (_request, count) {
      if (count === 1)
        yield {
          protocolVersion: 2,
          type: "session.update",
          payload: { providerSession: { sessionId: "fresh-only", resumable: false } }
        };
      yield completed();
    }
  });
  f.send();
  await f.idle();
  f.send();
  await f.idle();
  assert.equal(f.requests[1].runMetadata.conversationTurn, 2);
  assert.equal(stable(f.requests[1]).length, 3);
});

test("configuration rejects zero, negatives, fractional and unsafe intervals", () => {
  for (const interval of [0, -1, 1.5, "30", NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(
      () => validateImConfig({ ...baseConfig, stable_context_refresh_interval_turns: interval }),
      /IM_STABLE_CONTEXT_REFRESH_INTERVAL_INVALID/
    );
  for (const interval of [undefined, 1, 30, Number.MAX_SAFE_INTEGER])
    assert.doesNotThrow(() =>
      validateImConfig({ ...baseConfig, stable_context_refresh_interval_turns: interval })
    );
});

for (const adapterType of ["codex", "claude-code", "openclaw"]) {
  test(`${adapterType} periodic rules reach actual resumed native user-input carrier with readable newlines`, async (t) => {
    const f = await fixture(t, { interval: 2, adapter: adapterType });
    f.send();
    await f.idle();
    f.send();
    await f.idle();
    let request = withModelContexts(prepareInvokeInput(f.requests[1]).request);
    request = { ...request, signal: AbortSignal.timeout(5000) };
    assert.equal(stable(f.requests[1]).length, 3);
    let nativeText;
    if (adapterType === "claude-code") {
      const command = await buildClaudeCommand(request);
      try {
        assert.ok(command.args.includes("--resume"));
        assert.ok(!command.args.includes("--append-system-prompt-file"));
        nativeText = JSON.parse(command.input).message.content;
      } finally {
        await command.cleanup();
      }
    } else if (adapterType === "openclaw") {
      request.agentConfig.providerOptions = Object.fromEntries(
        Object.values(OPENCLAW_PROVIDER_OPTIONS).map((key) => [key, randomUUID()])
      );
      request.agentConfig.providerOptions[OPENCLAW_PROVIDER_OPTIONS.url] = "ws://localhost:1";
      const invocation = buildOpenClawGatewayInvocation(request);
      assert.equal(invocation.agentParams.extraSystemPrompt, undefined);
      nativeText = invocation.agentParams.message;
    } else {
      request.approvalMode = "ask";
      const server = codexAppServerFixture();
      const adapter = createCodexAdapter({ command: "fixture", spawnFn: server.spawnFn });
      try {
        let terminal;
        for await (const event of adapter.invoke(request)) {
          if (event.type === "interaction.requested") {
            await adapter.respondInteraction(request.invocationId, {
              interactionId: event.payload.interactionId,
              outcome: "accepted"
            });
            server.complete();
          }
          if (event.type.startsWith("run.")) terminal = event.type;
        }
        assert.equal(terminal, "run.completed");
        assert.ok(server.writes.some((message) => message.method === "thread/resume"));
        nativeText = server.writes
          .find((message) => message.method === "turn/start")
          .params.input.filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n");
      } finally {
        server.close(0);
      }
    }
    for (const name of stableNames) assert.match(nativeText, new RegExp(`name="${name}"`));
    assert.match(nativeText, /\n<contexts>\n/);
    assert.match(nativeText, /\n\[\/OCTO_CHANNEL_MENTION_RULES_V1\]/);
    assert.match(nativeText, /actor-2/);
    assert.match(nativeText, /Octo IM Group's GROUP\.md/);
    assert.match(nativeText, /<data><!\[CDATA\[CURRENT-GROUP-RULE\]\]><\/data>/);
    assert.match(nativeText, /<!-- Context information ends -->\n\n<!-- Query Input -->\n\n/);
  });
}
