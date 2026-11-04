// 显式手动专项：真实 Kernel/本地 IPC + fake Adapter，不加入默认测试选择器或 CI。
import test from "node:test";
import assert from "node:assert/strict";
import { InvocationRegistry } from "../../packages/octo-runtime-executor-kernel/dist/invocation-lifecycle.js";
import { KernelError } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { kernelFixture, kernelInput } from "../kernel-fixture.js";
import { kernelRelay } from "../kernel-relay.js";
import { testAdapter } from "../fixtures/invoke-adapter.js";
import { waitFor } from "../runtime-fixture.js";

const explicit = { explicit: true };
const key = {
  run_id: "manual-run",
  invocation_id: "manual-invocation",
  agent_session_id: "manual-session",
  session_generation: 0,
  protocol_mode: "native"
};
const ref = { ...key, stream_id: "manual-stream", protocol: "test", kernel_instance_id: "kernel" };
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
function registryFixture(t, cancel, get = async () => ({ ref, latest_seq: 0 })) {
  const registry = new InvocationRegistry({ cancel, get });
  t.after(() => registry.close());
  const record = registry.begin(key);
  return { registry, record };
}
async function observe(iterator, values = []) {
  try {
    for await (const value of iterator) values.push(value);
    return { values };
  } catch (error) {
    return { values, error };
  }
}

test("a new explicit attempt retries once and concurrent callers share that attempt", async (t) => {
  const gate = deferred();
  const original = new KernelError("OPERATION_OUTCOME_UNKNOWN");
  let calls = 0;
  const { registry, record } = registryFixture(t, async () => {
    if (++calls === 1) throw original;
    await gate.promise;
    return { accepted: true };
  });
  registry.accepted(record, ref);
  const first = registry.cancel(record, "first Stop", explicit);
  await assert.rejects(first, (error) => error === original);
  assert.strictEqual(registry.cancel(record, "internal observation"), first);
  const second = registry.cancel(record, "new Stop", explicit);
  const concurrent = registry.cancel(record, "concurrent Stop", explicit);
  try {
    assert.equal(calls, 2);
    assert.strictEqual(concurrent, second);
  } finally {
    gate.resolve();
  }
  assert.deepEqual(await second, { accepted: true });
  assert.deepEqual(await concurrent, { accepted: true });
  await assert.rejects(first, (error) => error === original);
  assert.deepEqual(await registry.cancel(record, "already acknowledged", explicit), {
    accepted: true
  });
  assert.equal(calls, 2);
});

test("drain queries an unknown cancellation without automatically retrying control", async (t) => {
  let calls = 0,
    queries = 0;
  const { registry, record } = registryFixture(
    t,
    async () => {
      calls++;
      throw new KernelError("OPERATION_OUTCOME_UNKNOWN");
    },
    async () => {
      queries++;
      return { ref, latest_seq: 0 };
    }
  );
  registry.accepted(record, ref);
  await assert.rejects(registry.cancel(record, "Stop", explicit), /OPERATION_OUTCOME_UNKNOWN/);
  const result = await registry.drain({ deadline: Date.now() + 180, reason: "owner drain" });
  assert.equal(result.complete, false);
  assert.ok(queries >= 2);
  assert.equal(calls, 1);
});

test("one Stop before admission stays one attempt when its cancellation fails", async (t) => {
  let calls = 0;
  const { registry, record } = registryFixture(t, async () => {
    calls++;
    throw new KernelError("OPERATION_OUTCOME_UNKNOWN");
  });
  const pending = registry.cancel(record, "Stop before ACK", explicit);
  registry.accepted(record, ref);
  await assert.rejects(pending, /OPERATION_OUTCOME_UNKNOWN/);
  assert.equal(calls, 1);
});

test("a confirmed terminal wins over a later explicit Stop", async (t) => {
  let calls = 0;
  const { registry, record } = registryFixture(t, async () => {
    calls++;
    throw new KernelError("OPERATION_OUTCOME_UNKNOWN");
  });
  registry.accepted(record, ref);
  await assert.rejects(registry.cancel(record, "first", explicit), /OPERATION_OUTCOME_UNKNOWN/);
  registry.observe(ref, {
    kind: "control",
    seq: 1,
    control: { type: "state", state: "completed" }
  });
  assert.deepEqual(await registry.cancel(record, "late Stop", explicit), { accepted: false });
  assert.equal(calls, 1);
  assert.deepEqual(registry.snapshot(), []);
});

for (const drop of ["request", "ack"])
  test(
    `real IPC: a fresh explicit Stop after lost ${drop} preserves the first failure`,
    { timeout: 15000 },
    async (t) => {
      let starts = 0,
        controls = 0;
      const adapter = {
        ...testAdapter,
        async *invoke(request, context) {
          starts++;
          yield* testAdapter.invoke(request, context);
        }
      };
      const f = await kernelFixture(t, { adapters: [adapter] });
      const relay = await kernelRelay(t, f, {
        request(request, connection) {
          if (request.method === "agent_run.cancel" && ++controls === 1 && drop === "request") {
            connection.disconnect();
            return false;
          }
        },
        response(_value, connection) {
          if (
            connection.request.method === "agent_run.cancel" &&
            controls === 1 &&
            drop === "ack"
          ) {
            connection.disconnect();
            return false;
          }
        }
      });
      const input = kernelInput("wait-for-cancel");
      const iterator = relay.client.invoke(input);
      let accepted, observation;
      try {
        await iterator.next();
        await waitFor(() => starts === 1);
        accepted = relay.client.invocations.snapshot()[0].ref;
        let original;
        await assert.rejects(
          relay.client.cancelInvocation(input.invocationId, "first Stop"),
          (error) => {
            original = error;
            return error.code === "OPERATION_OUTCOME_UNKNOWN";
          }
        );
        assert.equal(relay.count("agent_run.cancel"), 1);
        if (drop === "request") assert.equal((await f.client.get(accepted)).terminal, undefined);
        // 第二组为新显式意图；组内并发调用只应发出一个原 RunRef 的控制请求。
        const retry = await Promise.all([
          relay.client.cancelInvocation(input.invocationId, "second Stop"),
          relay.client.cancelInvocation(input.invocationId, "same pending Stop")
        ]);
        assert.equal(typeof retry[0].accepted, "boolean");
        if (drop === "request") assert.equal(retry[0].accepted, true);
        assert.deepEqual(retry[1], retry[0]);
        assert.equal(relay.count("agent_run.cancel"), 2);
        const requests = relay.requests.filter((request) => request.method === "agent_run.cancel");
        assert.deepEqual(requests[1].params.ref, requests[0].params.ref);
        assert.equal(requests[1].params.reason, "second Stop");
        observation = observe(iterator);
        const result = await observation;
        assert.strictEqual(
          result.error,
          original,
          "later control success must not erase the original observer error"
        );
        assert.ok(result.values.some((event) => event.type === "run.cancelled"));
        assert.equal((await f.client.get(accepted)).terminal.control.state, "cancelled");
        assert.equal(relay.count("agent_run.invoke"), 1);
        assert.equal(starts, 1);
        assert.deepEqual(relay.client.invocations.snapshot(), []);
        t.diagnostic(
          JSON.stringify({
            drop,
            controls,
            starts,
            terminal: "cancelled",
            firstError: original.code
          })
        );
      } finally {
        // 独立客户端只回收本用例原执行；即使旧版本在第二次 Stop 失败，也不留下活动执行。
        if (accepted) await f.client.cancel(accepted);
        observation ??= observe(iterator);
        await observation;
      }
    }
  );

test(
  "real IPC: slow cleanup drain observes terminal without replaying a lost-ACK cancel",
  { timeout: 15000 },
  async (t) => {
    const cleanup = deferred();
    let started = false,
      cleaning = false;
    const adapter = {
      ...testAdapter,
      async *invoke(request, context) {
        started = true;
        try {
          yield* testAdapter.invoke(request, context);
        } finally {
          cleaning = true;
          await cleanup.promise;
        }
      }
    };
    const f = await kernelFixture(t, { adapters: [adapter] });
    const relay = await kernelRelay(t, f, {
      response(_value, connection) {
        if (connection.request.method === "agent_run.cancel") {
          connection.disconnect();
          return false;
        }
      }
    });
    const input = kernelInput("wait-for-cancel");
    const iterator = relay.client.invoke(input);
    let accepted, observation, draining;
    try {
      await iterator.next();
      await waitFor(() => started);
      accepted = relay.client.invocations.snapshot()[0].ref;
      await assert.rejects(
        relay.client.cancelInvocation(input.invocationId),
        /OPERATION_OUTCOME_UNKNOWN/
      );
      await waitFor(() => cleaning);
      assert.equal((await f.client.get(accepted)).terminal, undefined);
      draining = relay.client.invocations.drain({
        deadline: Date.now() + 2000,
        reason: "owner drain"
      });
      await waitFor(() => relay.count("agent_run.get") >= 2);
      assert.equal(relay.count("agent_run.cancel"), 1);
      cleanup.resolve();
      assert.equal((await draining).complete, true);
      observation = observe(iterator);
      const result = await observation;
      assert.equal(result.error.code, "OPERATION_OUTCOME_UNKNOWN");
      assert.ok(result.values.some((event) => event.type === "run.cancelled"));
      assert.equal(relay.count("agent_run.cancel"), 1);
      assert.equal(relay.count("agent_run.invoke"), 1);
    } finally {
      cleanup.resolve();
      if (accepted) await f.client.cancel(accepted);
      await draining;
      observation ??= observe(iterator);
      await observation;
    }
  }
);

test(
  "real IPC: natural completion racing with a fresh Stop does not replay execution",
  { timeout: 15000 },
  async (t) => {
    const finish = deferred();
    let starts = 0,
      controls = 0;
    const adapter = {
      ...testAdapter,
      async *invoke(request, context) {
        starts++;
        await finish.promise;
        yield* testAdapter.invoke(request, context);
      }
    };
    const f = await kernelFixture(t, { adapters: [adapter] });
    const relay = await kernelRelay(t, f, {
      request(request, connection) {
        if (request.method === "agent_run.cancel" && ++controls === 1) {
          connection.disconnect();
          return false;
        }
      }
    });
    const input = kernelInput("complete after gate");
    const iterator = relay.client.invoke(input);
    let accepted, observation;
    try {
      await iterator.next();
      await waitFor(() => starts === 1);
      accepted = relay.client.invocations.snapshot()[0].ref;
      let original;
      await assert.rejects(relay.client.cancelInvocation(input.invocationId), (error) => {
        original = error;
        return error.code === "OPERATION_OUTCOME_UNKNOWN";
      });
      finish.resolve();
      await waitFor(
        async () => (await f.client.get(accepted)).terminal?.control.state === "completed"
      );
      assert.deepEqual(await relay.client.cancelInvocation(input.invocationId), {
        accepted: false
      });
      observation = observe(iterator);
      const result = await observation;
      assert.strictEqual(result.error, original);
      assert.ok(result.values.some((event) => event.type === "run.completed"));
      assert.equal(relay.count("agent_run.cancel"), 2);
      assert.equal(relay.count("agent_run.invoke"), 1);
      assert.equal(starts, 1);
    } finally {
      finish.resolve();
      if (accepted) await f.client.cancel(accepted);
      observation ??= observe(iterator);
      await observation;
    }
  }
);
