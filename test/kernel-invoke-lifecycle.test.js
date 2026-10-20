import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { resolve } from "node:path";
import { InvocationRegistry } from "../packages/octo-runtime-executor-kernel/dist/invocation-lifecycle.js";
import { KernelError } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { kernelFixture, kernelInput, frames } from "./kernel-fixture.js";

const key = (i) => ({
  run_id: `r${i}`,
  invocation_id: `i${i}`,
  agent_session_id: `s${i}`,
  session_generation: 0,
  protocol_mode: "native"
});
const ref = (i) => ({
  ...key(i),
  stream_id: `stream${i}`,
  protocol: "test",
  kernel_instance_id: "kernel"
});
const terminal = (i, state = "cancelled") => {
  const { kernel_instance_id: _instance, ...receipt } = ref(i);
  return { ...receipt, seq: 3, kind: "control", control: { type: "state", state } };
};

test("128 metadata records include admission and unknown outcomes; conflicts precede IO", () => {
  const registry = new InvocationRegistry({
    get: async () => {
      throw new Error("unused");
    },
    cancel: async () => ({ accepted: true })
  });
  const first = registry.begin(key(0));
  first.submitted = true;
  registry.rejected(first, new KernelError("ACCEPTANCE_UNKNOWN"));
  for (let i = 1; i < 128; i++) registry.begin(key(i));
  assert.throws(() => registry.begin(key(0)), /EXECUTION_IDENTITY_CONFLICT/);
  assert.throws(() => registry.begin(key(128)), /CLIENT_INVOCATION_CAPACITY_EXHAUSTED/);
  assert.equal(registry.snapshot().length, 128);
  assert.deepEqual(Object.keys(registry.snapshot()[0]).sort(), [
    "cancellation",
    "key",
    "lastSeq",
    "observationError",
    "phase"
  ]);
  registry.accepted(first, ref(0));
  registry.observe(ref(0), terminal(0));
  registry.begin(key(128));
  const snapshot = registry.snapshot();
  snapshot[0].key.run_id = "changed copy";
  assert.notEqual(registry.snapshot()[0].key.run_id, "changed copy");
  registry.close();
});

test("drain does not await an unresolved admission and shares its first deadline", async () => {
  const registry = new InvocationRegistry({
    get: async () => {
      throw new Error("unused");
    },
    cancel: async () => ({ accepted: true })
  });
  registry.begin(key(0)).submitted = true;
  const start = Date.now();
  const first = registry.drain({ deadline: start + 80, reason: "owner stop" });
  assert.equal(registry.drain({ deadline: start + 4000, reason: "later" }), first);
  assert.throws(() => registry.begin(key(1)), /CLIENT_INVOCATION_ADMISSION_CLOSED/);
  const result = await first;
  assert.ok(Date.now() - start < 500);
  assert.equal(result.complete, false);
  assert.equal(result.unresolved[0].key.invocation_id, "i0");
});

test("confirmed terminal releases pending cancellation IO before drain returns", async () => {
  let signal;
  const registry = new InvocationRegistry({
    async get() {
      return { ref: ref(0), latest_seq: 3, terminal: terminal(0) };
    },
    async cancel(_ref, _reason, _deadline, current) {
      signal = current;
      await delay(10_000, undefined, { signal });
      return { accepted: true };
    }
  });
  const record = registry.begin(key(0));
  registry.accepted(record, ref(0));
  const cancellation = assert.rejects(registry.cancel(record), { name: "AbortError" });
  const start = Date.now();
  assert.equal((await registry.drain({ deadline: start + 1000, reason: "stop" })).complete, true);
  await cancellation;
  assert.equal(signal.aborted, true);
  assert.ok(Date.now() - start < 500);
});

test("drain bounds control and query concurrency and confirms terminals after cancel ACK loss", async () => {
  let controls = 0,
    queries = 0,
    maxControls = 0,
    maxQueries = 0,
    cancelled = new Set();
  const registry = new InvocationRegistry({
    async get(k) {
      maxQueries = Math.max(maxQueries, ++queries);
      await delay(2);
      queries--;
      const i = Number(k.invocation_id.slice(1));
      return { ref: ref(i), latest_seq: 3, ...(cancelled.has(i) ? { terminal: terminal(i) } : {}) };
    },
    async cancel(r) {
      maxControls = Math.max(maxControls, ++controls);
      await delay(2);
      controls--;
      cancelled.add(Number(r.invocation_id.slice(1)));
      throw new KernelError("OPERATION_OUTCOME_UNKNOWN");
    }
  });
  const cancellations = [];
  for (let i = 0; i < 24; i++) {
    const record = registry.begin(key(i));
    record.submitted = true;
    registry.accepted(record, ref(i));
    cancellations.push(registry.cancel(record));
  }
  const results = Promise.allSettled(cancellations);
  const result = await registry.drain({ deadline: Date.now() + 1500, reason: "stop" });
  await results;
  assert.equal(result.complete, true);
  assert.equal(cancelled.size, 24);
  assert.ok(maxControls <= 4 && maxControls > 1);
  assert.ok(maxQueries <= 4 && maxQueries > 1);
});

test("lost remains unresolved; stalled query ends at shared deadline and creates no later IO", async () => {
  let calls = 0;
  const registry = new InvocationRegistry({
    async get(k, _instance, _deadline, signal) {
      calls++;
      if (k.invocation_id === "i0")
        return { ref: ref(0), latest_seq: 3, terminal: terminal(0, "lost") };
      await delay(10_000, undefined, { signal });
      throw new Error("unreachable");
    },
    async cancel() {
      assert.fail("lost must not send cancellation");
    }
  });
  for (let i = 0; i < 2; i++) registry.accepted(registry.begin(key(i)), ref(i));
  const start = Date.now();
  const result = await registry.drain({ deadline: start + 100, reason: "stop" });
  assert.equal(result.complete, false);
  assert.equal(result.unresolved.length, 2);
  assert.equal(result.unresolved[0].observationError, "RUN_OUTCOME_UNKNOWN");
  assert.ok(Date.now() - start < 500);
  const finalCalls = calls;
  await delay(30);
  assert.equal(calls, finalCalls);
});

test("real owner drain cancels abandoned iterator only, without replay subscriptions", async (t) => {
  const f = await kernelFixture(t, { manifest: resolve("test/fixtures/invoke-adapters.json") });
  const { kernelRelay } = await import("./kernel-relay.js");
  const relay = await kernelRelay(t, f);
  const other = await f.client.submit(kernelInput("wait-for-cancel"));
  const input = { ...kernelInput("wait-for-cancel"), protocol_mode: "native" };
  const iterator = relay.client.invoke(input);
  await iterator.next();
  await iterator.return();
  const own = relay.client.invocations.snapshot()[0].ref;
  const before = relay.count("agent_run.subscribe");
  const result = await relay.client.invocations.drain({
    deadline: Date.now() + 1500,
    reason: "owner"
  });
  assert.equal(result.complete, true);
  assert.equal(relay.count("agent_run.subscribe"), before);
  assert.equal((await f.client.get(own)).terminal.control.state, "cancelled");
  assert.equal((await f.client.get(other.ref)).terminal, undefined);
  await assert.rejects(
    relay.client.invoke(kernelInput()).next(),
    /CLIENT_INVOCATION_ADMISSION_CLOSED/
  );
  await f.client.cancel(other.ref);
  await frames(f.client, other.ref);
});

test("real owner drains sixteen paused subscriptions and a rejected seventeenth observer", async (t) => {
  const f = await kernelFixture(t, { manifest: resolve("test/fixtures/invoke-adapters.json") });
  const { kernelRelay } = await import("./kernel-relay.js");
  const relay = await kernelRelay(t, f),
    iterators = [];
  for (let i = 0; i < 16; i++) {
    const iterator = relay.client.invoke({
      ...kernelInput("wait-for-cancel"),
      protocol_mode: "native"
    });
    await iterator.next();
    iterators.push(iterator);
  }
  const rejected = relay.client.invoke({
    ...kernelInput("wait-for-cancel"),
    protocol_mode: "native"
  });
  await assert.rejects(rejected.next(), /STREAM_SUBSCRIBER_LIMIT/);
  const subscriptions = relay.count("agent_run.subscribe");
  const result = await relay.client.invocations.drain({
    deadline: Date.now() + 4000,
    reason: "owner"
  });
  assert.equal(result.complete, true, JSON.stringify(result));
  assert.equal(relay.count("agent_run.subscribe"), subscriptions);
  assert.equal(relay.count("agent_run.cancel"), 17);
  for (const iterator of iterators) await iterator.return();
});
