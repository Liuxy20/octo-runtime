import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { createExtraService, ExtraPlugins } from "@mininglamp-oss/octo-runtime-host-sdk";
import { withShutdownDeadline } from "@mininglamp-oss/octo-runtime-host-sdk/shutdown";
import * as gateway from "../packages/octo-runtime-extra-channel-gateway/dist/extra.js";
import { ImChannelManager } from "../packages/octo-runtime-extra-channel-gateway/dist/lifecycle/manager.js";
import { ImRuntime } from "../packages/octo-runtime-extra-channel-gateway/dist/application/im-channel.js";
import { HostSessionStore } from "../packages/octo-runtime-extra-channel-gateway/dist/application/host-session-store.js";
import { MemoryImSessionStore } from "../packages/octo-runtime-extra-channel-gateway/dist/application/session-store.js";
import { GatewayTransport } from "../packages/octo-runtime-extra-channel-gateway/dist/transport/channel.js";
import { kernelFixture, kernelInput, frames } from "./kernel-fixture.js";
import { kernelRelay } from "./kernel-relay.js";
import { waitFor } from "./runtime-fixture.js";

const bot = (id = "host-store", fields = {}) => ({
  bot_id: id,
  api_url: "https://im-test.deepminer.com.cn/api",
  adapter: { adapter_type: "test", workdir: process.cwd() },
  ...fields
});
const context = { schema: "octo.context-envelope/v3", items: [] };

// 后端属于测试宿主；逐 Bot 句柄关闭不清空后端，也不引入数据库实现。
function hostHandle(backend, trace = []) {
  class Handle {
    #backend = backend;
    closes = 0;
    close() {
      this.closes++;
      trace.push("store.close");
    }
    read(...args) {
      trace.push("read");
      return this.#backend.read(...args);
    }
    save(...args) {
      trace.push("save");
      if (args[1]?.providerSession?.sessionId)
        trace.push(`provider:${args[1].providerSession.sessionId}`);
      return this.#backend.save(...args);
    }
    reset(...args) {
      trace.push("reset");
      return this.#backend.reset(...args);
    }
    occurrence(...args) {
      trace.push("occurrence");
      return this.#backend.occurrence(...args);
    }
    remember(...args) {
      trace.push("remember");
      return this.#backend.remember(...args);
    }
    patchGap(...args) {
      trace.push("patchGap");
      return this.#backend.patchGap(...args);
    }
    invalidateRules(...args) {
      trace.push("invalidateRules");
      return this.#backend.invalidateRules(...args);
    }
    patchRules(...args) {
      trace.push("patchRules");
      return this.#backend.patchRules(...args);
    }
  }
  return new Handle();
}

function transport(t, trace = []) {
  const callbacks = new Map();
  t.mock.method(GatewayTransport.prototype, "start", async function () {
    callbacks.set(this.config.bot_id, this.callbacks);
  });
  t.mock.method(GatewayTransport.prototype, "close", async () => {
    trace.push("connector.close");
  });
  return callbacks;
}

function message(id, fields = {}) {
  return {
    messageId: id,
    senderId: "sender",
    conversationId: "chat",
    conversationKind: "direct",
    text: "hello",
    buildContext: async () => context,
    reply: async () => {},
    ...fields
  };
}

async function holdSessionUpdate(t, fixture) {
  const held = Promise.withResolvers(),
    gate = Promise.withResolvers();
  let waiting = false;
  t.after(() => gate.resolve());
  const relay = await kernelRelay(t, fixture, {
    async response(value) {
      const frame = value.params?.event;
      if (
        !waiting &&
        value.method === "agent_run.event" &&
        frame?.kind === "canonical" &&
        frame.event.type === "session.update"
      ) {
        waiting = true;
        held.resolve();
        // 暂缓已产生的真实 IPC 帧；取消之后继续原订阅，不要求 Provider 在取消后产生新事件。
        await gate.promise;
      }
    }
  });
  return { endpoint: relay.endpoint, ready: held.promise, release: () => gate.resolve() };
}

test("real Gateway consumes the host factory, reloads saved bindings and resets idempotently", async (t) => {
  const callbacks = transport(t);
  const backend = new MemoryImSessionStore();
  t.after(() => backend.close());
  const trace = [],
    handles = [],
    requests = [],
    replies = [];
  const extras = new ExtraPlugins([], {
    async *invoke(input) {
      requests.push(input);
      yield {
        protocolVersion: 2,
        type: "session.update",
        payload: { providerSession: { adapterType: "test", sessionId: "provider-saved" } }
      };
      yield { protocolVersion: 2, type: "run.completed", payload: {} };
    }
  });
  t.after(() => extras.close());
  const load = () =>
    extras.load(
      gateway,
      { bots: [bot()] },
      {
        createSessionStore(config) {
          assert.equal(config.bot_id, "host-store");
          const handle = hostHandle(backend, trace);
          handles.push(handle);
          return handle;
        }
      }
    );
  const send = async (id, text = "hello") => {
    const count = replies.length;
    callbacks.get("host-store").onMessage(
      message(id, {
        text,
        reply: async (text) => {
          replies.push(text);
        }
      })
    );
    await waitFor(() => replies.length > count);
  };
  await load();
  await send("first");
  const first = requests[0];
  await extras.unload(gateway.name);
  assert.equal(handles[0].closes, 1);
  await load();
  await send("second");
  assert.equal(requests[1].sessionId, first.sessionId);
  assert.equal(requests[1].sessionName, first.sessionName);
  assert.equal(requests[1].providerSession.sessionId, "provider-saved");
  await send("reset", "/reset");
  await send("third");
  assert.notEqual(requests[2].sessionId, first.sessionId);
  assert.notEqual(requests[2].sessionName, first.sessionName);
  assert.equal(requests[2].sessionGeneration, first.sessionGeneration + 1);
  assert.equal(requests[2].providerSession, undefined);
  // 模拟重连后再次收到同一控制消息，保留 backend 的控制去重记录。
  await extras.unload(gateway.name);
  await load();
  await send("reset", "/reset");
  await send("fourth");
  assert.equal(requests[3].sessionId, requests[2].sessionId);
  assert.equal(requests[3].sessionName, requests[2].sessionName);
  assert.equal(requests[3].sessionGeneration, requests[2].sessionGeneration);
  for (const name of ["read", "save", "reset", "occurrence", "remember"])
    assert.ok(trace.includes(name), name);
  await extras.close();
  assert.deepEqual(
    handles.map((handle) => handle.closes),
    [1, 1, 1]
  );
});

test("factory only allocates enabled valid Bots and receives an independent trusted config", async (t) => {
  transport(t);
  const snapshots = [],
    runtimeConfigs = [],
    backends = [];
  const start = ImRuntime.prototype.start;
  t.mock.method(ImRuntime.prototype, "start", function () {
    runtimeConfigs.push(structuredClone(this.config));
    return start.call(this);
  });
  const config = bot("enabled", { organization: "org", scope: { assistant: "original" } });
  const extras = new ExtraPlugins([], {});
  t.after(async () => {
    await extras.close();
    backends.forEach((store) => store.close());
  });
  await extras.load(
    gateway,
    { bots: [config, bot("off", { enabled: false }), bot("invalid", { adapter: null })] },
    {
      createSessionStore(value) {
        snapshots.push(value);
        value.scope.assistant = "host-mutated";
        const backend = new MemoryImSessionStore();
        backends.push(backend);
        return hostHandle(backend);
      }
    }
  );
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].organization, "org");
  assert.equal(runtimeConfigs[0].scope.assistant, "original");
  config.scope.assistant = "caller-mutated";
  assert.equal(snapshots[0].scope.assistant, "host-mutated");
  assert.equal((await extras.inspect(gateway.name)).errors.length, 1);
});

test("host wrapper forwards optional methods with private receivers and fences old generations", async (t) => {
  const backend = new MemoryImSessionStore();
  t.after(() => backend.close());
  const trace = [],
    raw = hostHandle(backend, trace),
    lease = new HostSessionStore();
  const store = lease.create(() => raw, {});
  const identity = { sessionId: "session", generation: 1 };
  store.save("chat", { id: identity.sessionId, generation: 1 });
  assert.equal(
    store.patchGap("chat", identity, () => ({
      processEpoch: "p",
      revision: 0,
      localOutputSeqs: []
    })),
    true
  );
  assert.equal(
    store.patchRules("chat", identity, () => ({ revision: 1 })),
    true
  );
  store.invalidateRules((key) => key === "chat");
  assert.deepEqual(store.read("chat").rulesContext, { revision: 2 });
  store.reset("chat", "reset");
  assert.equal(
    store.patchGap("chat", identity, () => {
      throw new Error("late");
    }),
    false
  );
  assert.equal(
    store.patchRules("chat", identity, () => {
      throw new Error("late");
    }),
    false
  );
  assert.ok(
    trace.includes("patchGap") && trace.includes("patchRules") && trace.includes("invalidateRules")
  );
  await lease.close(performance.now() + 1000);
  assert.equal(raw.closes, 1);
  assert.throws(() => store.read("chat"), /IM_SESSION_STORE_CLOSED/);
  assert.equal(trace.at(-1), "store.close");
});

test("missing optional store methods remain absent and a close-less handle is still revoked", async () => {
  const lease = new HostSessionStore();
  const store = lease.create(
    () => ({
      read() {},
      save() {},
      reset() {
        return { generation: 2 };
      },
      occurrence() {},
      remember() {}
    }),
    {}
  );
  for (const name of ["patchGap", "patchRules", "invalidateRules", "close"])
    assert.equal(store[name], undefined);
  await lease.close(performance.now() + 1000);
  assert.throws(() => store.read("chat"), /IM_SESSION_STORE_CLOSED/);
});

for (const name of [
  "read",
  "save",
  "reset",
  "occurrence",
  "remember",
  "patchGap",
  "invalidateRules",
  "patchRules"
]) {
  test(`draining ${name} failures survive a business catch and make lease cleanup fail`, async () => {
    const failure = new Error("private database error");
    const raw = {
      read() {},
      save() {},
      reset() {},
      occurrence() {},
      remember() {},
      [name]() {
        throw failure;
      }
    };
    const lease = new HostSessionStore();
    const store = lease.create(() => raw, {});
    lease.drain(performance.now() + 1000);
    assert.throws(
      () => store[name](),
      (error) => error === failure
    );
    await assert.rejects(lease.close(performance.now() + 1000), /IM_SESSION_STORE_DISPOSE_FAILED/);
  });
}

for (const kind of ["throw", "reject", "pending"]) {
  test(`manager retains ownership and forbids replacement after handle close ${kind}`, async (t) => {
    transport(t);
    const backend = new MemoryImSessionStore();
    t.after(() => backend.close());
    const gate = Promise.withResolvers();
    let factories = 0,
      closes = 0;
    const manager = new ImChannelManager({
      kernel: {},
      createSessionStore() {
        factories++;
        const raw = hostHandle(backend);
        raw.close = () => {
          closes++;
          if (kind === "throw") throw new Error("private close");
          return kind === "reject" ? Promise.reject(new Error("private close")) : gate.promise;
        };
        return raw;
      }
    });
    await manager.upsert(bot());
    const result = await withShutdownDeadline(performance.now() + 60, () =>
      manager.remove(manager.status[0].connection_key)
    ).catch((error) => error);
    assert.equal(result.message, "IM_DISPOSE_FAILED");
    await assert.rejects(manager.upsert(bot()), (error) => error === result);
    assert.equal(factories, 1);
    assert.equal(closes, 1);
    gate.resolve();
    await assert.rejects(manager.close(), /IM_DISPOSE_FAILED/);
    assert.equal(closes, 1);
  });
}

test("manager closes the previous lease before allocating its replacement and borrows direct sessions", async (t) => {
  transport(t);
  const backend = new MemoryImSessionStore();
  t.after(() => backend.close());
  const order = [];
  const manager = new ImChannelManager({
    kernel: {},
    createSessionStore() {
      order.push("factory");
      return hostHandle(backend, order);
    }
  });
  await manager.upsert(bot());
  await manager.upsert(bot());
  assert.ok(order.indexOf("store.close") < order.lastIndexOf("factory"));
  await manager.close();
  let borrowedCloses = 0;
  const borrowed = hostHandle(backend);
  borrowed.close = () => {
    borrowedCloses++;
  };
  const borrower = new ImChannelManager({ kernel: {}, sessions: borrowed });
  await borrower.upsert(bot());
  await borrower.close();
  assert.equal(borrowedCloses, 0);
  assert.throws(
    () =>
      new ImChannelManager({ kernel: {}, sessions: borrowed, createSessionStore: () => borrowed }),
    /IM_SESSION_STORE_CONFLICT/
  );
});

for (const factory of [
  () => {
    throw new Error("private factory");
  },
  () => null,
  () => ({}),
  () => ({ read: 1 }),
  () => ({ read() {}, save() {}, reset() {}, occurrence() {}, remember() {}, patchRules: true })
]) {
  test("invalid host factory reports a sanitized Bot error and never falls back to memory", async (t) => {
    const callbacks = transport(t);
    const extra = createExtraService({
      endpoint: `/unused-${randomUUID()}`,
      module: gateway,
      config: { bots: [bot()] },
      dependencies: { createSessionStore: factory }
    });
    await extra.initialize();
    const status = await extra.status();
    assert.match(status.plugin.errors[0].error, /^IM_SESSION_STORE_/);
    assert.doesNotMatch(JSON.stringify(status), /private factory/);
    assert.equal(callbacks.size, 0);
    assert.equal((await extra.close()).complete, true);
  });
}

for (const reject of [false, true]) {
  test(`mistaken async factory is rejected and late ${reject ? "rejection is consumed" : "handle is closed once"}`, async (t) => {
    transport(t);
    const gate = Promise.withResolvers();
    const backend = new MemoryImSessionStore();
    t.after(() => backend.close());
    const raw = hostHandle(backend);
    const manager = new ImChannelManager({ kernel: {}, createSessionStore: () => gate.promise });
    const upsert = withShutdownDeadline(performance.now() + 60, () => manager.upsert(bot())).catch(
      (error) => error
    );
    await waitFor(() => manager.status.length === 0);
    assert.equal((await upsert).message, "IM_ENDPOINT_CLEANUP_INCOMPLETE");
    const failed = manager.close().catch((error) => error);
    if (reject) gate.reject(new Error("private rejection"));
    else gate.resolve(raw);
    assert.equal((await failed).message, "IM_DISPOSE_FAILED");
    await waitFor(() => reject || raw.closes === 1);
    assert.equal(raw.closes, reject ? 0 : 1);
    await assert.rejects(manager.upsert(bot()), /IM_MANAGER_CLOSED/);
  });
}

test("factory reentrant close still releases the newly created handle", async (t) => {
  transport(t);
  const backend = new MemoryImSessionStore();
  t.after(() => backend.close());
  const raw = hostHandle(backend);
  let closing;
  const manager = new ImChannelManager({
    kernel: {},
    createSessionStore() {
      closing = manager.close();
      return raw;
    }
  });
  await assert.rejects(manager.upsert(bot()), /IM_MANAGER_CLOSED/);
  await closing;
  assert.equal(raw.closes, 1);
});

test("trusted host scope and opaque chat identities remain isolated across Extra reloads", async (t) => {
  const callbacks = transport(t),
    backends = new Map(),
    requests = [];
  const extras = new ExtraPlugins([], {
    async *invoke(input) {
      requests.push(input);
      yield { protocolVersion: 2, type: "run.completed", payload: {} };
    }
  });
  t.after(async () => {
    await extras.close();
    for (const backend of backends.values()) backend.close();
  });
  const base = { organization: "org", assistant: "assistant", user: "user" };
  const cases = [
    { id: "host-store", scope: base, kind: "direct", chat: "chat" },
    { id: "other-bot", scope: base, kind: "direct", chat: "chat" },
    ...["organization", "assistant", "user"].map((field) => ({
      id: "host-store",
      scope: { ...base, [field]: "other" },
      kind: "direct",
      chat: "chat"
    })),
    { id: "host-store", scope: base, kind: "direct", chat: "other-chat" },
    { id: "host-store", scope: base, kind: "group", chat: "group" },
    { id: "host-store", scope: base, kind: "thread", chat: "group____topic" }
  ];
  const run = async (value) => {
    await extras.load(
      gateway,
      { bots: [bot(value.id, value.scope)] },
      {
        createSessionStore(config) {
          const scope = JSON.stringify([
            config.bot_id,
            config.organization,
            config.assistant,
            config.user
          ]);
          if (!backends.has(scope)) backends.set(scope, new MemoryImSessionStore());
          return hostHandle(backends.get(scope));
        }
      }
    );
    let replied = false;
    callbacks.get(value.id).onMessage(
      message(randomUUID(), {
        conversationId: value.chat,
        conversationKind: value.kind,
        reply: async () => {
          replied = true;
        }
      })
    );
    await waitFor(() => replied);
    const id = requests.at(-1).sessionId;
    await extras.unload(gateway.name);
    return id;
  };
  const sessions = [];
  for (const value of cases) sessions.push(await run(value));
  assert.equal(new Set(sessions).size, cases.length);
  assert.equal(await run(cases[0]), sessions[0]);
  assert.equal(
    new Set(requests.slice(0, cases.length).map((request) => request.sessionName)).size,
    cases.length
  );
  assert.equal(requests.at(-1).sessionName, requests[0].sessionName);
});

test("startup failure releases the acquired handle and allows a clean retry", async (t) => {
  transport(t);
  const backend = new MemoryImSessionStore(),
    handles = [];
  t.after(() => backend.close());
  let fail = true;
  const start = ImRuntime.prototype.start;
  t.mock.method(ImRuntime.prototype, "start", function () {
    if (fail) throw new Error("startup failed after factory");
    return start.call(this);
  });
  const manager = new ImChannelManager({
    kernel: {},
    createSessionStore() {
      const handle = hostHandle(backend);
      handles.push(handle);
      return handle;
    }
  });
  await assert.rejects(manager.upsert(bot()), /startup failed/);
  assert.equal(handles[0].closes, 1);
  fail = false;
  await manager.upsert(bot());
  await manager.close();
  assert.deepEqual(
    handles.map((handle) => handle.closes),
    [1, 1]
  );
});

for (const phase of ["presentation", "final"]) {
  test(`Gateway keeps its host handle while post-terminal ${phase} is pending`, async (t) => {
    const callbacks = transport(t),
      backend = new MemoryImSessionStore();
    t.after(() => backend.close());
    const raw = hostHandle(backend),
      gate = Promise.withResolvers();
    let holding = false;
    const extras = new ExtraPlugins([], {
      async *invoke() {
        yield { protocolVersion: 2, type: "run.completed", payload: {} };
      }
    });
    t.after(async () => {
      gate.resolve();
      await extras.close();
    });
    await extras.load(gateway, { bots: [bot()] }, { createSessionStore: () => raw });
    callbacks.get("host-store").onMessage(
      message("post-terminal", {
        beginPresentation: () => ({
          update() {},
          async finish() {
            if (phase === "presentation") {
              holding = true;
              await gate.promise;
            }
          }
        }),
        reply: async () => {
          if (phase === "final") {
            holding = true;
            await gate.promise;
          }
        }
      })
    );
    await waitFor(() => holding);
    const closing = extras.unload(gateway.name);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(raw.closes, 0);
    gate.resolve();
    await closing;
    assert.equal(raw.closes, 1);
  });
}

test("native cancellation during Gateway initialization closes the factory handle", async (t) => {
  let entered = false;
  t.mock.method(GatewayTransport.prototype, "start", async function (signal) {
    entered = true;
    await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
  });
  t.mock.method(GatewayTransport.prototype, "close", async () => {});
  const backend = new MemoryImSessionStore(),
    raw = hostHandle(backend);
  t.after(() => backend.close());
  const extra = createExtraService({
    endpoint: `/unused-${randomUUID()}`,
    module: gateway,
    config: { bots: [bot()] },
    dependencies: { createSessionStore: () => raw }
  });
  const loading = extra.initialize().catch((error) => error);
  await waitFor(() => entered);
  assert.equal((await extra.close()).complete, true);
  assert.equal((await loading).name, "ServiceInitializationError");
  assert.equal(raw.closes, 1);
});

test("all Bot handles share the inherited deadline and retain their original incomplete result", async (t) => {
  transport(t);
  const gate = Promise.withResolvers(),
    backend = new MemoryImSessionStore(),
    handles = [];
  t.after(() => backend.close());
  const manager = new ImChannelManager({
    kernel: {},
    createSessionStore() {
      const raw = hostHandle(backend);
      raw.close = () => {
        raw.closes++;
        return gate.promise;
      };
      handles.push(raw);
      return raw;
    }
  });
  await manager.upsert(bot("first"));
  await manager.upsert(bot("second"));
  const until = performance.now() + 60;
  const closing = withShutdownDeadline(until, () => manager.close());
  const failure = await closing.catch((error) => error);
  assert.equal(failure.message, "IM_DISPOSE_FAILED");
  assert.deepEqual(
    handles.map((raw) => raw.closes),
    [1, 1]
  );
  gate.resolve();
  await assert.rejects(manager.close(), (error) => error === failure);
  const lease = new HostSessionStore();
  let reads = 0;
  const raw = hostHandle(backend);
  raw.read = () => {
    reads++;
  };
  const store = lease.create(() => raw, {});
  lease.drain(performance.now() - 1);
  assert.throws(() => store.read("late"), /IM_SESSION_STORE_CLOSED/);
  assert.equal(reads, 0, "deadline enforcement does not depend on a timer firing");
  await lease.close(performance.now() + 1000);
});

for (const name of ["save", "remember", "close"]) {
  test(
    `native cleanup preserves host ${name} failure and forbids same-name replacement`,
    { timeout: 10000 },
    async (t) => {
      const fixture = await kernelFixture(t, {
        workerEntrypoint: resolve("test/fixtures/drain-worker.mjs"),
        manifest: undefined
      });
      const tail = await holdSessionUpdate(t, fixture);
      const endpoint = tail.endpoint;
      const callbacks = transport(t),
        backend = new MemoryImSessionStore(),
        trace = [];
      t.after(() => backend.close());
      const raw = hostHandle(backend, trace);
      let stopping = false;
      const original = raw[name].bind(raw);
      raw[name] = (...args) => {
        if (stopping) throw new Error("private host failure");
        return original(...args);
      };
      const options = {
        endpoint,
        module: gateway,
        config: { bots: [bot()] },
        dependencies: { createSessionStore: () => raw }
      };
      const extra = createExtraService(options);
      await extra.initialize();
      callbacks.get("host-store").onMessage(message("tail"));
      await tail.ready;
      stopping = true;
      const closing = extra.close();
      tail.release();
      const result = await closing;
      assert.equal(result.complete, false);
      assert.doesNotMatch(JSON.stringify(result), /private host/);
      assert.equal(await extra.close(), result);
      await assert.rejects(
        createExtraService(options).initialize(),
        (error) => error.cause?.message === "EXTRA_DISPOSE_FAILED"
      );
    }
  );
}

test("invalid callable properties are rejected without losing an identifiable handle", async () => {
  let closes = 0;
  const raw = {
    get then() {
      throw new Error("private getter");
    },
    close() {
      closes++;
    }
  };
  const lease = new HostSessionStore();
  assert.throws(() => lease.create(() => raw, {}), /IM_SESSION_STORE_INVALID/);
  await lease.close(performance.now() + 1000);
  assert.equal(closes, 1);
  for (const createSessionStore of [null, false, 0, {}])
    assert.throws(
      () => new ImChannelManager({ kernel: {}, createSessionStore }),
      /IM_SESSION_STORE_FACTORY_INVALID/
    );
});

test(
  "native Gateway drains a real Kernel tail before closing the host handle and preserves a sibling",
  { timeout: 10000 },
  async (t) => {
    const fixture = await kernelFixture(t, {
      workerEntrypoint: resolve("test/fixtures/drain-worker.mjs"),
      manifest: undefined
    });
    const { client } = fixture;
    const tail = await holdSessionUpdate(t, fixture);
    const endpoint = tail.endpoint;
    const sibling = await client.submit(kernelInput("sibling"));
    const order = [],
      callbacks = transport(t, order),
      backend = new MemoryImSessionStore();
    t.after(() => backend.close());
    const raw = hostHandle(backend, order);
    const save = raw.save.bind(raw);
    raw.save = (key, binding) => {
      if (binding.providerSession?.sessionId === "drained-provider-session")
        order.push("tail.binding");
      return save(key, binding);
    };
    const extra = createExtraService({
      endpoint,
      module: gateway,
      config: { bots: [bot()] },
      dependencies: { createSessionStore: () => raw }
    });
    t.after(() => extra.close());
    await extra.initialize();
    callbacks.get("host-store").onMessage(
      message("tail", {
        reply: async () => {
          order.push("final");
        }
      })
    );
    await tail.ready;
    order.push("owner.stop");
    const closing = extra.close();
    tail.release();
    const result = await closing;
    assert.equal(result.complete, true, JSON.stringify(result));
    const lastSave = order.lastIndexOf("save");
    assert.ok(lastSave >= 0 && lastSave < order.indexOf("store.close"), JSON.stringify(order));
    assert.ok(order.indexOf("final") < order.indexOf("store.close"));
    assert.ok(order.indexOf("tail.binding") > order.indexOf("owner.stop"));
    assert.ok(order.indexOf("tail.binding") < order.indexOf("store.close"));
    assert.equal(raw.closes, 1);
    assert.equal((await client.get(sibling.ref)).terminal, undefined);
    assert.equal((await client.status()).execution_ready, true);
    await client.cancel(sibling.ref);
    await frames(client, sibling.ref);
  }
);
