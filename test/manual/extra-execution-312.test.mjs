import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm, readdir, access } from "node:fs/promises";
import { join } from "node:path";
import { connect } from "node:net";
import { AgentExecutor } from "@mininglamp-oss/octo-runtime-executor-core";
import { createExtraService } from "@mininglamp-oss/octo-runtime-host-sdk";
import { withShutdownDeadline } from "@mininglamp-oss/octo-runtime-host-sdk/shutdown";
import { createCodexAdapter } from "@mininglamp-oss/octo-runtime-adapter-codex";
import { invocationInput } from "@mininglamp-oss/octo-runtime-protocol";
import { kernelFixture, kernelInput } from "../kernel-fixture.js";
import { invokeRequest, waitFor } from "../runtime-fixture.js";
import { testAdapter } from "../fixtures/test-adapter.js";

const collect = async (source) => {
  const values = [];
  for await (const value of source) values.push(value);
  return values;
};
function core(t, adapter = testAdapter, cleanup = "complete") {
  const executor = new AgentExecutor();
  executor.register(adapter);
  t.after(async () =>
    assert.equal((await executor.shutdown("test finished", 100)).cleanup, cleanup)
  );
  return executor;
}
async function service(t, execution, name = `extra-${randomUUID()}`, fields = {}) {
  let context;
  const extra = createExtraService({
    execution,
    config: {},
    dependencies: {},
    module: {
      name,
      default(ctx) {
        context = ctx;
        return () => {};
      }
    },
    ...fields
  });
  t.after(async () => {
    await extra.close();
  });
  await extra.initialize();
  return { extra, context, execution: context.execution };
}
const direct = (executor) => ({ kind: "direct", executor });

test("direct explicit control endpoint owns only its listener, and absent parents are not created", async (t) => {
  const directory = await mkdtemp("/tmp/extra-control-312-");
  t.after(() => rm(directory, { recursive: true, force: true }));
  const executor = core(t);
  const controlEndpoint =
    process.platform === "win32"
      ? `\\\\.\\pipe\\extra-312-${randomUUID()}`
      : join(directory, "extra.sock");
  const { extra } = await service(t, direct(executor), undefined, { controlEndpoint });
  const result = await new Promise((resolve, reject) => {
    const socket = connect(controlEndpoint);
    let body = "";
    socket.on("error", reject);
    socket.on("connect", () =>
      socket.write(JSON.stringify({ id: "status", method: "status" }) + "\n")
    );
    socket.on("data", (chunk) => {
      body += chunk;
    });
    socket.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
  });
  assert.deepEqual(result.result.status.execution, { kind: "direct", available: true });
  assert.equal("kernel_available" in result.result.status, false);
  assert.equal((await extra.close()).complete, true);
  assert.deepEqual(await readdir(directory), []);
  if (process.platform !== "win32") {
    await assert.rejects(
      service(t, direct(executor), undefined, {
        controlEndpoint: join(directory, "absent", "e.sock")
      })
    );
    await assert.rejects(access(join(directory, "absent")), { code: "ENOENT" });
  }
});

test("unobserved and pre-aborted invocations do not execute; admitted signal cancellation remains scoped", async (t) => {
  let invoked = 0;
  const executor = core(t, {
    ...testAdapter,
    async *invoke(request) {
      invoked++;
      yield* testAdapter.invoke(request);
    }
  });
  const a = await service(t, direct(executor)),
    b = await service(t, direct(executor));
  const never = a.execution.invoke(kernelInput());
  await never.return();
  const cancelled = new AbortController();
  cancelled.abort(new Error("BEFORE_START"));
  await assert.rejects(
    collect(a.execution.invoke(kernelInput(), { signal: cancelled.signal })),
    /BEFORE_START/
  );
  assert.equal(invoked, 0);
  const bi = kernelInput("wait-for-cancel");
  const bs = b.execution.invoke(bi);
  await bs.next();
  await bs.return();
  const controller = new AbortController();
  const stream = a.execution.invoke(kernelInput("wait-for-cancel"), { signal: controller.signal });
  await stream.next();
  controller.abort(new Error("EXPLICIT_STOP"));
  await assert.rejects(collect(stream), /EXPLICIT_STOP/);
  assert.equal((await b.execution.cancelInvocation(bi.invocationId)).accepted, true);
  assert.equal((await a.extra.close()).complete, true);
  assert.equal((await b.extra.close()).complete, true);
});

test("direct source capacity rejects overflow without cancelling admitted scopes", async (t) => {
  const executor = core(t);
  const { execution, extra } = await service(t, direct(executor));
  for (let i = 0; i < 128; i++) {
    const stream = execution.invoke(kernelInput("wait-for-cancel"));
    await stream.next();
    await stream.return();
  }
  await assert.rejects(collect(execution.invoke(kernelInput())), /CAPACITY_EXHAUSTED/);
  assert.equal(executor.status().available, true);
  assert.equal((await extra.close()).complete, true);
});

test("legacy Kernel-specific plugin runs only in IPC; direct misuse rolls back and allows replacement", async (t) => {
  const executor = core(t);
  const name = `kernel-only-${randomUUID()}`;
  const options = {
    execution: direct(executor),
    module: {
      name,
      default(ctx) {
        return async () => {
          await ctx.kernel.list();
        };
      }
    },
    config: {},
    dependencies: {}
  };
  await assert.rejects(
    createExtraService(options).initialize(),
    (error) => error.cause instanceof TypeError && error.cleanup.complete
  );
  const replacement = await service(t, direct(executor), name);
  assert.equal((await replacement.extra.close()).complete, true);
  const fixture = await kernelFixture(t);
  const ipc = createExtraService({
    ...options,
    home: fixture.directory,
    execution: { kind: "ipc", endpoint: fixture.endpoint }
  });
  await ipc.initialize();
  assert.equal((await ipc.close()).complete, true);
});

test("configuration rejects mixed branches, undefined fields, impostors and unknown kinds before initialization", () => {
  const executor = new AgentExecutor();
  const base = {
    module: { name: "validation", default: () => () => {} },
    config: {},
    dependencies: {}
  };
  for (const fields of [
    {},
    { execution: undefined },
    { execution: null },
    { execution: [] },
    { execution: { kind: "other" } },
    { execution: { kind: "direct" } },
    { execution: { kind: "direct", executor: { invoke() {} } } },
    { execution: { ...direct(executor), endpoint: undefined } },
    { execution: { kind: "ipc", endpoint: "/tmp/k", executor: undefined } },
    { execution: { kind: "ipc" } },
    { execution: direct(executor), endpoint: undefined }
  ])
    assert.throws(() => createExtraService({ ...base, ...fields }), /EXTRA_/);
});

test("direct borrows the exact executor with no Home, Kernel fields or shutdown ownership", async (t) => {
  const executor = core(t);
  const { extra, context, execution } = await service(t, direct(executor));
  assert.equal(context.kernel, undefined);
  assert.equal(execution.kind, "direct");
  assert.deepEqual((await extra.status()).execution, { kind: "direct", available: true });
  assert.equal("kernel_available" in (await extra.status()), false);
  assert.ok(
    (await collect(execution.invoke(kernelInput()))).some((event) => event.type === "run.completed")
  );
  assert.equal((await extra.close()).complete, true);
  assert.equal(executor.status().available, true);
  assert.ok(
    (await collect(executor.invoke(kernelInput()))).some((event) => event.type === "run.completed")
  );
});

test("direct identity is executor object plus Extra name; duplicate rollback cannot close original", async (t) => {
  const executor = core(t),
    other = core(t);
  const name = `identity-${randomUUID()}`;
  const first = await service(t, direct(executor), name);
  await assert.rejects(
    service(t, direct(executor), name),
    (e) => e.cause.message === "EXTRA_ALREADY_LOADED"
  );
  const second = await service(t, direct(other), name);
  assert.equal((await first.extra.status()).phase, "ready");
  assert.equal((await second.extra.status()).phase, "ready");
  assert.equal((await first.extra.close()).complete, true);
  assert.equal((await (await service(t, direct(executor), name)).extra.close()).complete, true);
});

for (const kind of ["direct", "ipc", "legacy"]) {
  test(`${kind}: observation exit does not cancel; Extra close isolates sibling and host calls`, async (t) => {
    const executor = kind === "direct" ? core(t) : undefined;
    const fixture = executor ? undefined : await kernelFixture(t);
    const selection = executor ? direct(executor) : { kind: "ipc", endpoint: fixture.endpoint };
    const fields = fixture ? { home: fixture.directory } : {};
    if (kind === "legacy") {
      fields.endpoint = fixture.endpoint;
    }
    // legacy 必须真的省略 execution，不以 undefined 绕过运行期互斥。
    const make = async () => {
      if (kind !== "legacy") return service(t, selection, undefined, fields);
      let context;
      const extra = createExtraService({
        ...fields,
        module: {
          name: `legacy-${randomUUID()}`,
          default(ctx) {
            context = ctx;
            return () => {};
          }
        },
        config: {},
        dependencies: {}
      });
      t.after(() => extra.close());
      await extra.initialize();
      return { extra, context, execution: context.execution };
    };
    const a = await make(),
      b = await make();
    const ai = kernelInput("wait-for-cancel"),
      bi = kernelInput("wait-for-cancel"),
      hi = kernelInput("wait-for-cancel");
    const host = executor ?? fixture.client;
    const hostStream = host.invoke(hi);
    const hostTask = collect(hostStream);
    void hostTask.catch(() => {});
    const aStream = a.execution.invoke(ai),
      bStream = b.execution.invoke(bi);
    assert.equal((await aStream.next()).done, false);
    assert.equal((await bStream.next()).done, false);
    await aStream.return();
    await bStream.return();
    assert.equal((await a.extra.close()).complete, true);
    // 关闭 A 后，B 与宿主仍有可取消的原调用；跨 scope 操作先拒绝。
    await assert.rejects(b.execution.cancelInvocation(hi.invocationId), /INVOCATION_NOT_TRACKED/);
    assert.equal((await b.execution.cancelInvocation(bi.invocationId)).accepted, true);
    assert.equal(
      executor
        ? executor.cancel(hi.invocationId)
        : (await host.cancelInvocation(hi.invocationId)).accepted,
      true
    );
    await hostTask;
    assert.equal((await b.extra.close()).complete, true);
    assert.ok((await collect(host.invoke(kernelInput()))).some((e) => e.type === "run.completed"));
  });
}

test("identity collision cannot cancel an existing host invocation before admission", async (t) => {
  const executor = core(t);
  const own = kernelInput("wait-for-cancel");
  const host = collect(executor.invoke(own));
  void host.catch(() => {});
  await delay(15);
  const { execution, extra } = await service(t, direct(executor));
  await assert.rejects(collect(execution.invoke(own)), /EXECUTION_IDENTITY_CONFLICT/);
  assert.equal((await extra.close()).complete, true);
  assert.equal(executor.cancel(own.invocationId), true);
  await host;
});

test("direct slow observer gets a visible gap while independent execution completes", async (t) => {
  let completed = false;
  const start = Promise.withResolvers();
  const executor = core(t, {
    ...testAdapter,
    async *invoke() {
      yield { protocolVersion: 2, type: "message.delta", payload: { text: "first" } };
      await start.promise;
      for (let i = 0; i < 30; i++) {
        yield { protocolVersion: 2, type: "message.delta", payload: { text: String(i) } };
        await delay(1);
      }
      completed = true;
      yield { protocolVersion: 2, type: "run.completed", payload: {} };
    }
  });
  const { execution, extra } = await service(t, direct(executor));
  const stream = execution.invoke(kernelInput(), { streamLimits: { replayRunMaxItems: 16 } });
  await stream.next();
  start.resolve();
  await waitFor(() => completed);
  await assert.rejects(collect(stream), /STREAM_GAP/);
  assert.equal((await extra.close()).complete, true);
});

test("direct shutdown fences new calls and reports the borrowed executor becoming unavailable", async (t) => {
  const executor = core(t);
  const { extra, execution } = await service(t, direct(executor));
  await executor.shutdown();
  assert.equal((await extra.status()).execution.available, false);
  await assert.rejects(collect(execution.invoke(kernelInput())), /EXECUTOR_CLOSED/);
  assert.equal((await extra.close()).complete, true);
  await assert.rejects(collect(execution.invoke(kernelInput())), /ADMISSION_CLOSED/);
  await assert.rejects(execution.list(), /ADMISSION_CLOSED/);
});

for (const fail of [false, true]) {
  test(`Core cleanup receipt preserves delayed finally and failure=${fail}`, async (t) => {
    const finish = Promise.withResolvers();
    const entered = Promise.withResolvers();
    const executor = core(
      t,
      {
        ...testAdapter,
        async *invoke() {
          try {
            yield { protocolVersion: 2, type: "run.completed", payload: {} };
          } finally {
            entered.resolve();
            await finish.promise;
            if (fail) throw new Error("FINALLY_FAILED");
          }
        }
      },
      fail ? "incomplete" : "complete"
    );
    const input = kernelInput("cleanup", { runtimeLimits: { cancelGraceMs: 100 } });
    const stream = executor.invokeFrames(input);
    const receipt = (await stream.next()).value;
    const task = collect(stream);
    await entered.promise;
    assert.equal(
      await executor.waitForInvocationCleanup(receipt, { deadline: Date.now() + 10 }),
      "pending"
    );
    assert.equal(
      await executor.waitForInvocationCleanup(
        { ...receipt, stream_id: "wrong" },
        { deadline: Date.now() + 10 }
      ),
      "unknown"
    );
    finish.resolve();
    await task;
    assert.equal(await executor.waitForInvocationCleanup(receipt), fail ? "failed" : "complete");
    assert.equal(await executor.waitForInvocationCleanup(receipt), fail ? "failed" : "complete");
  });
}

test("direct incomplete cleanup retains ownership across repeated close and late settlement", async (t) => {
  const finish = Promise.withResolvers(),
    entered = Promise.withResolvers();
  const executor = core(t, {
    ...testAdapter,
    async *invoke(request) {
      try {
        await new Promise((resolve) =>
          request.signal.addEventListener("abort", resolve, { once: true })
        );
      } finally {
        entered.resolve();
        await finish.promise;
      }
    }
  });
  const name = `pending-${randomUUID()}`;
  const { execution, extra } = await service(t, direct(executor), name);
  const stream = execution.invoke(
    kernelInput("wait-for-cancel", { runtimeLimits: { cancelGraceMs: 100 } })
  );
  await stream.next();
  await delay(10);
  await stream.return();
  const closing = withShutdownDeadline(performance.now() + 50, () => extra.close());
  await entered.promise;
  const result = await closing;
  assert.equal(result.complete, false);
  assert.ok(result.pendingResources.includes("runs"));
  finish.resolve();
  await delay(40);
  assert.equal(await extra.close(), result);
  await assert.rejects(
    service(t, direct(executor), name),
    (e) => e.cause.message === "EXTRA_DISPOSE_FAILED"
  );
});

test("direct list tracks the real probe after its presentation timeout", async (t) => {
  const finish = Promise.withResolvers();
  const executor = core(t, { ...testAdapter, probe: () => finish.promise });
  const { execution, extra } = await service(t, direct(executor));
  const result = await execution.list();
  assert.equal(result[0].available, false);
  assert.equal(result[0].unavailableReason, "probe_timeout");
  const cleanup = await withShutdownDeadline(performance.now() + 40, () => extra.close());
  assert.equal(cleanup.complete, false);
  finish.resolve({ available: true, command: "fixture" });
  await delay(10);
});

test("direct initialization rollback cancels only its admitted calls and preserves original cause", async (t) => {
  const executor = core(t);
  const original = new Error("INITIALIZATION_FAILED");
  const extra = createExtraService({
    execution: direct(executor),
    config: {},
    dependencies: {},
    module: {
      name: `rollback-${randomUUID()}`,
      default(ctx) {
        return async () => {
          const stream = ctx.execution.invoke(kernelInput("wait-for-cancel"));
          await stream.next();
          await stream.return();
          throw original;
        };
      }
    }
  });
  await assert.rejects(extra.initialize(), (e) => e.cause === original && e.cleanup.complete);
  assert.equal(executor.status().available, true);
});

for (const kind of ["direct", "ipc"])
  for (const mode of ["native", "canonical"]) {
    test(`${kind}: real Codex Adapter with fake process supports ${mode} replies and rejects cross-scope controls`, async (t) => {
      const adapter = createCodexAdapter({
        command: process.execPath,
        appServerArgs: [
          fileURLToPath(new URL("../../test-support/fake-native-codex.mjs", import.meta.url))
        ]
      });
      const executor = kind === "direct" ? core(t, adapter) : undefined;
      const fixture = executor ? undefined : await kernelFixture(t, { adapters: [adapter] });
      const selection = executor ? direct(executor) : { kind: "ipc", endpoint: fixture.endpoint };
      const fields = fixture ? { home: fixture.directory } : {};
      const a = await service(t, selection, undefined, fields),
        b = await service(t, selection, undefined, fields);
      const input = invocationInput(
        invokeRequest({
          modelInput: "approval",
          prompt: "approval",
          approvalMode: "ask",
          runId: randomUUID(),
          invocationId: randomUUID()
        }),
        mode,
        "codex"
      );
      const frames = [];
      let answered = false;
      for await (const frame of a.execution.invoke(input)) {
        frames.push(frame);
        if (
          mode === "native" &&
          frame.kind === "control" &&
          frame.control.type === "interaction" &&
          frame.control.status === "pending"
        ) {
          const reply = {
            requestId: 42,
            payload: { jsonrpc: "2.0", id: 42, result: { decision: "accept" } }
          };
          await assert.rejects(
            b.execution.respondNativeInteraction(input.invocationId, reply),
            /INVOCATION_NOT_TRACKED/
          );
          await a.execution.respondNativeInteraction(input.invocationId, reply);
          answered = true;
        } else if (mode === "canonical" && frame.type === "interaction.requested") {
          const reply = { interactionId: frame.payload.interactionId, outcome: "accepted" };
          await assert.rejects(
            b.execution.respondInteraction(input.invocationId, reply),
            /INVOCATION_NOT_TRACKED/
          );
          await a.execution.respondInteraction(input.invocationId, reply);
          answered = true;
        }
      }
      assert.equal(answered, true);
      assert.ok(
        frames.some(
          (frame) => frame.type === "run.completed" || frame.control?.state === "completed"
        )
      );
      assert.equal((await a.extra.close()).complete, true);
      assert.equal((await b.extra.close()).complete, true);
    });
  }
