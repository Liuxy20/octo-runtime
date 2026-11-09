import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { AgentExecutor, prepareInvokeInput } from "@mininglamp-oss/octo-runtime/executor-core";
import {
  agentEnvItem,
  assertAdapterAgentEnv,
  defineAdapter,
  invocationProviderOptions,
  invocationTimeoutSeconds,
  withAgentEnvDefaults,
  withAgentEnvItems
} from "@mininglamp-oss/octo-runtime/adapter-sdk";
import {
  assertContextEnvelope as assertAgentEnv,
  CONTEXT_SCHEMA
} from "@mininglamp-oss/octo-runtime/protocol";
import { kernelFixture } from "../kernel-fixture.js";
import { invokeClient } from "../../test-support/invoke-client.js";

// 专项使用原始信封，不经过会补 cwd、审批或 source 的测试构造器。
const envelope = (items = []) => ({ schema: CONTEXT_SCHEMA, items });
const item = (namespace, name, payload) => ({ namespace, name, payload });
const input = (agentEnv) => ({
  inputs: [{ type: "text", text: "exact input\r\n第二行" }],
  agentEnv,
  protocol_mode: "canonical",
  invocationId: randomUUID(),
  runId: randomUUID(),
  sessionId: randomUUID()
});
const customAdapter = (invoke) =>
  defineAdapter({
    metadata: { type: "private-host", agentSources: ["provisioned"], workspace: false },
    respondInteraction: async () => {},
    invoke
  });
const completed = { protocolVersion: 2, type: "run.completed", payload: {} };

for (const route of ["direct", "rpc"]) {
  test(`${route}: host-private beans arrive in order without defaults or public registration`, async (t) => {
    const received = [];
    const adapter = customAdapter(async function* (request) {
      received.push(structuredClone(request.agentEnv));
      assert.deepEqual(agentEnvItem(request.agentEnv, "host.openclaw", "preferences"), {
        agentId: "业务自定",
        nested: [false, null, { exact: "${NO_RENDER}" }]
      });
      assert.equal(request.modelInput, "exact input\r\n第二行");
      for (const key of ["context", "workdir", "approvalMode", "runtimeLimits"])
        assert.equal(Object.hasOwn(request, key), false);
      yield completed;
    });
    const env = envelope([
      item("host.openclaw", "preferences", {
        agentId: "业务自定",
        nested: [false, null, { exact: "${NO_RENDER}" }]
      }),
      item("octo.execution", "adapter", { type: "private-host" }),
      item("adapter.unrelated", "options", { future: [3, 2, 1] })
    ]);
    const value = input(env),
      before = structuredClone(value);
    let events;
    if (route === "direct") {
      const host = new AgentExecutor();
      host.register(adapter);
      t.after(async () => assert.equal((await host.shutdown()).cleanup, "complete"));
      events = await Array.fromAsync(host.invoke(value));
    } else {
      const { client } = await kernelFixture(t, { adapters: [adapter] });
      events = await Array.fromAsync(invokeClient(client, value));
    }
    assert.equal(events.at(-1).type, "run.completed");
    assert.deepEqual(received, [before.agentEnv]);
    assert.deepEqual(value, before);
  });
}

test("Core snapshots empty AgentEnv without appending execution beans", () => {
  const value = input(envelope());
  const { request, adapterType } = prepareInvokeInput(value);
  assert.equal(adapterType, "codex");
  assert.deepEqual(request.agentEnv, envelope());
  value.agentEnv.items.push(item("host.private", "later", { value: true }));
  assert.deepEqual(request.agentEnv, envelope());
});

test("defaults are independent and invocation never appends them", async () => {
  const received = [];
  const adapter = customAdapter(async function* (request) {
    received.push(structuredClone(request.agentEnv));
    yield completed;
  });
  const defaults = adapter.defaultAgentEnv;
  defaults.items[0].payload.type = "mutated";
  assert.equal(adapter.defaultAgentEnv.items[0].payload.type, "private-host");
  const submitted = envelope([item("host.private", "options", { mode: "custom" })]);
  const merged = withAgentEnvDefaults(submitted, adapter.defaultAgentEnv);
  assert.deepEqual(merged.items[0], submitted.items[0]);
  assert.equal(submitted.items.length, 1);
  const request = prepareInvokeInput(input(submitted)).request;
  await Array.fromAsync(adapter.invoke(request));
  assert.deepEqual(received, [submitted]);
});

test("concurrent trusted options stay local and isolated even with a shared low-level request", async () => {
  const callerToken = randomUUID();
  const connectionTokens = [randomUUID(), randomUUID()];
  let release;
  const barrier = new Promise((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const observed = [];
  const adapter = customAdapter(async function* (request) {
    if (++calls === 2) release();
    await barrier;
    observed.push(invocationProviderOptions(request, "private-host"));
    yield completed;
  });
  const request = prepareInvokeInput(
    input(
      envelope([item("adapter.private-host", "options", { token: callerToken, retained: true })])
    )
  ).request;
  const before = structuredClone(request.agentEnv);
  await Promise.all(
    connectionTokens.map((token) =>
      Array.fromAsync(adapter.invoke(request, { providerOptions: { token } }))
    )
  );
  assert.deepEqual(observed.map((x) => x.token).sort(), [...connectionTokens].sort());
  assert.ok(observed.every((x) => x.retained === true));
  assert.deepEqual(request.agentEnv, before);
  assert.deepEqual(invocationProviderOptions(request, "private-host"), {
    token: callerToken,
    retained: true
  });
});

test("known malformed config fails before Provider and leaves no cleanup debt", async () => {
  let calls = 0;
  const adapter = customAdapter(async function* () {
    calls++;
    yield completed;
  });
  const host = new AgentExecutor();
  host.register(adapter);
  try {
    const value = input(
      envelope([
        item("octo.execution", "adapter", { type: "private-host" }),
        item("octo.security", "approval_policy", {})
      ])
    );
    const events = await Array.fromAsync(host.invoke(value));
    assert.equal(events.at(-1).type, "run.failed");
    assert.equal(calls, 0);
    const next = await Array.fromAsync(
      host.invoke(input(envelope([item("octo.execution", "adapter", { type: "private-host" })])))
    );
    assert.equal(next.at(-1).type, "run.completed");
  } finally {
    assert.equal((await host.shutdown()).cleanup, "complete");
  }
});

test("structural boundaries reject duplicates, combined overflow, malformed schema and oversized Unicode", () => {
  const privateItem = item("host.private", "options", { exact: "汉字\r\n😀" });
  assert.doesNotThrow(() => assertAgentEnv(envelope([privateItem])));
  assert.throws(() => assertAgentEnv({ schema: "wrong", items: [] }), /CONTEXT_SCHEMA_INVALID/);
  assert.throws(
    () => withAgentEnvItems(envelope(), [privateItem, privateItem]),
    /CONTEXT_KEY_DUPLICATED/
  );
  const many = (prefix) =>
    envelope(Array.from({ length: 17 }, (_, n) => item(prefix, `n${n}`, {})));
  assert.throws(
    () => withAgentEnvDefaults(many("host.a"), many("host.b")),
    /CONTEXT_BUDGET_EXCEEDED/
  );
  assert.throws(
    () =>
      assertAgentEnv(
        envelope([
          item("host.private", "large", {
            text: "汉".repeat(22000)
          })
        ])
      ),
    /CONTEXT_BUDGET_EXCEEDED/
  );
});

test("reusing a preparation Error in another Provider cannot claim confirmed cleanup", async () => {
  const fault = new Error("shared preparation and Provider error");
  const managed = customAdapter(async function* () {
    yield completed;
  });
  const request = prepareInvokeInput(input(envelope())).request;
  await assert.rejects(
    Array.fromAsync(
      managed.invoke(request, {
        configureRuntimeLimits() {
          throw fault;
        }
      })
    ),
    (error) => error === fault
  );
  const host = new AgentExecutor();
  host.register({
    metadata: managed.metadata,
    async *invoke() {
      throw fault;
    }
  });
  try {
    const events = await Array.fromAsync(
      host.invoke(input(envelope([item("octo.execution", "adapter", { type: "private-host" })])))
    );
    assert.equal(events.at(-1).type, "run.failed");
  } finally {
    assert.equal((await host.shutdown()).cleanup, "incomplete");
  }
});

// 原公共层负例迁到真正消费配置的 SDK；仅协议放行不能证明 Adapter 正确拒绝。
const configFixtures = JSON.parse(
  readFileSync(
    new URL(
      "../../packages/octo-runtime-protocol/test/fixtures/context-fixtures.json",
      import.meta.url
    ),
    "utf8"
  )
);
for (const fixture of configFixtures.filter((row) => row.adapter_valid !== undefined)) {
  test(`Adapter consumes former envelope semantic fixture: ${fixture.name}`, () => {
    assert.doesNotThrow(() => assertAgentEnv(fixture.context));
    const request = prepareInvokeInput(input(fixture.context)).request;
    if (fixture.adapter_valid) assert.doesNotThrow(() => assertAdapterAgentEnv(request));
    else assert.throws(() => assertAdapterAgentEnv(request));
  });
}

const privateFixtures = JSON.parse(
  readFileSync(
    new URL(
      "../../packages/octo-runtime-protocol/test/fixtures/native-invoke-fixtures.json",
      import.meta.url
    ),
    "utf8"
  )
);
for (const fixture of privateFixtures.filter((row) => row.adapter_valid !== undefined)) {
  test(`private timeout consumer: ${fixture.name}`, () => {
    const request = prepareInvokeInput(fixture.value).request;
    if (fixture.adapter_valid) assert.equal(invocationTimeoutSeconds(request, "openclaw"), 0.5);
    else
      assert.throws(() => invocationTimeoutSeconds(request, "openclaw"), /ADAPTER_OPTION_INVALID/);
  });
}
