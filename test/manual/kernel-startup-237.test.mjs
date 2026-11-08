import { invokeClient } from "../../test-support/invoke-client.js";
// 显式手动专项：不加入默认测试或 CI；使用真实 Kernel/RPC 和宿主注入的 fake Adapter。
import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createKernelService,
  InvocationManifest,
  ServiceInitializationError,
  inspectOrphanCleanup
} from "@mininglamp-oss/octo-runtime-executor-kernel";
import { componentEndpoint } from "@mininglamp-oss/octo-runtime-host-sdk";
import { testAdapter } from "../fixtures/test-adapter.js";
import { kernelInput } from "../kernel-fixture.js";
import { waitFor } from "../runtime-fixture.js";

function describe(value, seen = new Set()) {
  if (!(value instanceof Error)) return value;
  if (seen.has(value)) return "[same error]";
  seen.add(value);
  return Object.fromEntries(
    ["name", ...Object.getOwnPropertyNames(value)].map((key) => [
      key,
      key === "errors"
        ? value.errors.map((error) => describe(error, seen))
        : describe(value[key], seen)
    ])
  );
}

function trace(t, stage, values = {}) {
  t.diagnostic(JSON.stringify({ stage, at: new Date().toISOString(), ...values }));
}

function contains(error, expected) {
  return (
    error === expected ||
    (error instanceof Error &&
      (contains(error.cause, expected) ||
        (error instanceof AggregateError && error.errors.some((item) => contains(item, expected)))))
  );
}

async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), "k237-"));
  const path = join(home, "kernel-invocations.json");
  const resources = { entered: 0, active: 0, released: 0, hostClosed: false };
  const adapter = {
    metadata: testAdapter.metadata,
    async *invoke(request) {
      resources.entered++;
      resources.active++;
      try {
        yield* testAdapter.invoke(request);
      } finally {
        resources.active--;
        resources.released++;
      }
    },
    // Kernel 无权推断并调用宿主对象上的任意 close。
    close() {
      resources.hostClosed = true;
    }
  };
  const options = {
    home,
    endpoint: componentEndpoint(home),
    stateDirectory: home,
    adapters: [adapter]
  };
  const services = [];
  const repairs = [];
  t.after(async () => {
    for (const service of services) await service.close();
    for (const repair of repairs) await repair();
    await rm(home, { recursive: true, force: true });
  });
  return {
    options,
    path,
    resources,
    repair: (operation) => repairs.push(operation),
    service() {
      const service = createKernelService(options);
      services.push(service);
      return service;
    }
  };
}

async function record(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function endpointClosed(endpoint) {
  const error = await new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint);
    socket.once("connect", () => {
      socket.destroy();
      reject(new Error("CANCELLED_ENDPOINT_STILL_LISTENING"));
    });
    socket.once("error", (cause) => {
      socket.destroy();
      resolve(cause);
    });
  });
  assert.ok(["ENOENT", "ECONNREFUSED"].includes(error.code));
}

function holdBind(t, endpoint) {
  const entered = Promise.withResolvers();
  const resume = Promise.withResolvers();
  const listen = net.Server.prototype.listen;
  let server;
  t.mock.method(net.Server.prototype, "listen", function (...args) {
    if (args[0] !== endpoint) return Reflect.apply(listen, this, args);
    server = this;
    entered.resolve();
    void resume.promise.then(() => Reflect.apply(listen, this, args));
    return this;
  });
  // 失败断言也先放开真实 bind，服务自身负责回滚；不退出宿主来隐藏迟到句柄。
  t.after(() => resume.resolve());
  return { entered: entered.promise, resume: () => resume.resolve(), server: () => server };
}

async function replacement(t, f) {
  assert.equal(await record(f.path), undefined);
  await endpointClosed(f.options.endpoint);
  t.mock.restoreAll();
  const next = f.service();
  await next.initialize();
  const status = await next.client.status();
  assert.equal(status.pid, process.pid);
  assert.equal(status.execution_ready, true);
  const owner = await record(f.path);
  assert.equal(owner.nativeOwner, true);
  assert.equal(owner.kernelPid, process.pid);
  const events = [];
  for await (const event of invokeClient(
    next.client,
    kernelInput("replacement after cancellation")
  ))
    events.push(event);
  assert.equal(events.at(-1).type, "run.completed");
  assert.ok(events.some((event) => event.payload.text?.includes("replacement after cancellation")));
  assert.deepEqual(f.resources, { entered: 1, active: 0, released: 1, hostClosed: false });
  const closing = next.close();
  assert.equal(next.close(), closing);
  const cleanup = await closing;
  assert.equal(cleanup.complete, true);
  assert.equal(await next.closed, cleanup);
  assert.equal(await record(f.path), undefined);
  await endpointClosed(f.options.endpoint);
  trace(t, "replacement executed and closed", { status, owner, cleanup, resources: f.resources });
}

for (const mode of ["pre-abort", "owner-abort", "bind-abort", "bind-close", "initializer-error"])
  test(`startup recovery: ${mode}`, { timeout: 12000 }, async (t) => {
    const f = await fixture(t);
    const controller = new AbortController();
    const cause = Object.assign(new Error(`TEST_237_${mode.toUpperCase()}`), { code: "E237" });
    const bind = mode.startsWith("bind-") ? holdBind(t, f.options.endpoint) : undefined;
    const mark = InvocationManifest.prototype.markNativeOwner;
    if (mode === "pre-abort") controller.abort(cause);
    if (["owner-abort", "initializer-error"].includes(mode))
      t.mock.method(InvocationManifest.prototype, "markNativeOwner", async function () {
        await mark.call(this);
        trace(t, "native owner recorded", { owner: await record(f.path) });
        if (mode === "owner-abort") controller.abort(cause);
        else throw cause;
      });
    const service = f.service();
    const initializing = service.initialize({ signal: controller.signal });
    assert.equal(service.initialize(), initializing);
    let failure;
    const rejected = assert.rejects(initializing, (error) => {
      failure = error;
      trace(t, "initialization rejected", { error: describe(error), cleanup: error.cleanup });
      assert.ok(error instanceof ServiceInitializationError);
      if (mode === "bind-close") assert.equal(error.cause.name, "AbortError");
      else assert.equal(error.cause, cause);
      assert.equal(error.cleanup.complete, true);
      return true;
    });
    if (bind) {
      await bind.entered;
      assert.equal((await service.status()).phase, "initializing");
      assert.equal((await record(f.path)).nativeOwner, true);
      if (mode === "bind-close") void service.close();
      else controller.abort(cause);
      await new Promise((resolve) => setImmediate(resolve));
      assert.notEqual((await service.status()).phase, "ready");
      trace(t, "cancelled during pending bind", { status: await service.status() });
      bind.resume();
    }
    await rejected;
    assert.equal((await service.status()).phase, "closed");
    assert.throws(() => service.client, /KERNEL_NOT_INITIALIZED/);
    assert.equal(await service.close(), failure.cleanup);
    assert.equal(await service.closed, failure.cleanup);
    assert.equal(f.resources.entered, 0);
    if (bind) assert.equal(bind.server().listening, false);
    await replacement(t, f);
  });

test(
  "bind completed after cleanup deadline cannot publish ready; result stays incomplete",
  { timeout: 12000 },
  async (t) => {
    const f = await fixture(t);
    const bind = holdBind(t, f.options.endpoint);
    const service = f.service();
    const controller = new AbortController();
    const cause = new Error("TEST_237_LATE_BIND_CANCEL");
    let failure;
    const rejected = assert.rejects(service.initialize({ signal: controller.signal }), (error) => {
      failure = error;
      assert.equal(error.cause, cause);
      assert.equal(error.cleanup.complete, false);
      assert.deepEqual(error.cleanup.pendingResources, ["kernel"]);
      return true;
    });
    await bind.entered;
    controller.abort(cause);
    await rejected;
    assert.equal((await service.status()).phase, "failed");
    assert.equal((await record(f.path)).nativeOwner, true);
    const competitor = createKernelService(f.options);
    await assert.rejects(competitor.initialize(), (error) => {
      trace(t, "pending owner blocks replacement", {
        error: describe(error),
        cleanup: error.cleanup
      });
      assert.match(error.cause.message, /cannot replace live invocation manifest/);
      return true;
    });
    trace(t, "deadline before bind settled", {
      error: describe(failure),
      cleanup: failure.cleanup,
      owner: await record(f.path),
      inspection: await inspectOrphanCleanup(f.path)
    });
    bind.resume();
    await waitFor(async () => (await record(f.path)) === undefined);
    assert.equal(bind.server().listening, false);
    assert.equal((await service.status()).phase, "failed");
    assert.equal(await service.close(), failure.cleanup);
    assert.equal(f.resources.entered, 0);
    await replacement(t, f);
  }
);

for (const cancel of [false, true])
  test(
    `rollback IO failure retains original cause, cleanup failure and owner; sibling survives (cancel=${cancel})`,
    { timeout: 12000 },
    async (t) => {
      const f = await fixture(t);
      const sibling = await fixture(t);
      const live = sibling.service();
      await live.initialize();
      const original = new Error("TEST_237_INITIALIZER_FAILED");
      const afterCancel = new Error("TEST_237_START_FAILED_AFTER_CANCEL");
      const controller = new AbortController();
      const denied = Object.assign(new Error("TEST_237_MANIFEST_CLOSE_DENIED"), { code: "EPERM" });
      const mark = InvocationManifest.prototype.markNativeOwner;
      const close = InvocationManifest.prototype.close;
      let ownManifest;
      t.mock.method(InvocationManifest.prototype, "markNativeOwner", async function () {
        await mark.call(this);
        ownManifest = this;
        if (cancel) {
          controller.abort(original);
          throw afterCancel;
        }
        throw original;
      });
      t.mock.method(InvocationManifest.prototype, "close", async function () {
        if (this === ownManifest) throw denied;
        return close.call(this);
      });
      // 注入只发生在未开始任何执行、尚未 bind 的测试服务；最后修复 fixture 的 IO 拒绝。
      f.repair(async () => {
        t.mock.restoreAll();
        if (ownManifest) await close.call(ownManifest);
      });
      const service = f.service();
      let failure;
      await assert.rejects(service.initialize({ signal: controller.signal }), (error) => {
        failure = error;
        trace(t, "raw initialization and rollback errors", {
          error: describe(error),
          cleanup: error.cleanup
        });
        assert.ok(error instanceof ServiceInitializationError);
        assert.equal(contains(error, original), true);
        if (cancel) assert.equal(contains(error, afterCancel), true);
        assert.equal(
          contains(error, denied),
          true,
          "raw rollback EPERM must remain traceable after cancellation"
        );
        assert.equal(error.cleanup.complete, false);
        return true;
      });
      const owner = await record(f.path);
      assert.equal(owner.cleanupFailed, true);
      assert.deepEqual(owner.invocations, []);
      assert.equal((await inspectOrphanCleanup(f.path)).state, "cleanup_incomplete");
      t.mock.restoreAll();
      await assert.rejects(createKernelService(f.options).initialize(), (error) => {
        assert.match(error.cause.message, /cannot replace live invocation manifest/);
        return true;
      });
      await endpointClosed(f.options.endpoint);
      const events = [];
      for await (const event of invokeClient(live.client, kernelInput("sibling remains usable")))
        events.push(event);
      assert.equal(events.at(-1).type, "run.completed");
      assert.equal((await live.close()).complete, true);
      assert.equal(await service.close(), failure.cleanup);
      assert.equal(f.resources.entered, 0);
      trace(t, "rollback failure evidence", {
        error: describe(failure),
        cleanup: failure.cleanup,
        owner,
        status: await service.status(),
        siblingCleanup: await live.closed,
        hostPid: process.pid
      });
    }
  );
