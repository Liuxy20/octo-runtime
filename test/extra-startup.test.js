import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { createExtraService, componentEndpoint } from "@mininglamp-oss/octo-runtime-host-sdk";
import { withShutdownDeadline } from "@mininglamp-oss/octo-runtime-host-sdk/shutdown";
import { ServiceInitializationError } from "@mininglamp-oss/octo-runtime-executor-kernel";

async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), "oes-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  return {
    endpoint: componentEndpoint(home, "kernel"),
    controlEndpoint: componentEndpoint(home, "extra"),
    config: {},
    dependencies: {}
  };
}

test("closing before initialize allocates nothing and permanently stops admission", async (t) => {
  const options = await fixture(t);
  let calls = 0;
  const extra = createExtraService({
    ...options,
    module: {
      name: "not-started",
      default: () => () => {
        calls++;
      }
    }
  });
  assert.equal((await extra.close()).complete, true);
  await assert.rejects(extra.initialize(), /SERVICE_CLOSED/);
  assert.equal(calls, 0);
  await assert.rejects(stat(options.controlEndpoint), { code: "ENOENT" });
});

test("cancelling initialization awaits disposal and never publishes a late endpoint", async (t) => {
  const options = await fixture(t);
  let entered;
  const ready = new Promise((resolve) => (entered = resolve));
  let disposed = false;
  const extra = createExtraService({
    ...options,
    module: {
      name: "cancel-startup",
      default(ctx) {
        ctx.onDispose(() => {
          disposed = true;
        });
        return () =>
          new Promise((resolve) => {
            entered();
            ctx.signal.addEventListener("abort", () => resolve(), { once: true });
          });
      }
    }
  });
  const initializing = extra.initialize();
  void initializing.catch(() => undefined);
  await ready;
  const closing = extra.close();
  assert.equal((await closing).complete, true);
  await assert.rejects(
    initializing,
    (error) => error instanceof ServiceInitializationError && error.cleanup.complete
  );
  assert.equal(disposed, true);
  await assert.rejects(stat(options.controlEndpoint), { code: "ENOENT" });
});

test("partial initialization rolls back, preserves failure facts and only permits clean replacement", async (t) => {
  const options = await fixture(t);
  let disposal = 0;
  const module = {
    name: "partial-startup",
    default(ctx, config) {
      ctx.onDispose(() => {
        disposal++;
        if (config.failDispose) throw new Error("private disposal");
      });
      return () => {
        if (config.failStart) throw new Error("private startup");
      };
    }
  };
  await assert.rejects(
    createExtraService({ ...options, module, config: { failStart: true } }).initialize(),
    (error) => error instanceof ServiceInitializationError && error.cleanup.complete
  );
  const next = createExtraService({ ...options, module });
  await next.initialize();
  assert.equal((await next.close()).complete, true);
  await assert.rejects(
    createExtraService({
      ...options,
      module,
      config: { failStart: true, failDispose: true }
    }).initialize(),
    (error) => error instanceof ServiceInitializationError && !error.cleanup.complete
  );
  await assert.rejects(
    createExtraService({ ...options, module }).initialize(),
    (error) => error.cause?.message === "EXTRA_DISPOSE_FAILED"
  );
  assert.equal(disposal, 3);
});

test(
  "unfinished native dependency keeps ownership after the shared shutdown deadline",
  { timeout: 12000 },
  async (t) => {
    const options = await fixture(t);
    let release;
    let entered;
    const pending = new Promise((resolve) => (release = resolve));
    const called = new Promise((resolve) => (entered = resolve));
    t.after(() => release());
    const module = {
      name: "native-dependency",
      default(ctx) {
        return (dependencies) => {
          void dependencies.lookup({ signal: ctx.signal });
        };
      }
    };
    const extra = createExtraService({
      ...options,
      module,
      dependencies: {
        lookup: () => {
          entered();
          return pending;
        }
      }
    });
    await extra.initialize();
    await called;
    const start = Date.now();
    const result = await extra.close();
    assert.equal(result.complete, false);
    assert.ok(result.pendingResources.includes("dependencies"));
    assert.ok(Date.now() - start < 5700);
    release();
    await assert.rejects(
      createExtraService({ ...options, module }).initialize(),
      (error) => error.cause?.message === "EXTRA_DISPOSE_FAILED"
    );
  }
);

test(
  "startup signal abort bounds an uncooperative initializer and prevents late resources",
  { timeout: 12000 },
  async (t) => {
    const options = await fixture(t);
    let release;
    let entered;
    const pending = new Promise((resolve) => (release = resolve));
    const called = new Promise((resolve) => (entered = resolve));
    const extra = createExtraService({
      ...options,
      module: {
        name: "late-startup",
        default: () => () => {
          entered();
          return pending;
        }
      }
    });
    const controller = new AbortController();
    const initializing = extra.initialize({ signal: controller.signal });
    void initializing.catch(() => undefined);
    await called;
    controller.abort();
    await assert.rejects(
      initializing,
      (error) => error instanceof ServiceInitializationError && !error.cleanup.complete
    );
    assert.equal((await extra.closed).complete, false);
    release();
    await new Promise((resolve) => setImmediate(resolve));
    await assert.rejects(stat(options.controlEndpoint), { code: "ENOENT" });
    assert.equal((await extra.status()).phase, "failed");
  }
);

test(
  "failed endpoint lease release is explicit and retains ownership",
  { skip: process.platform === "win32" },
  async (t) => {
    const options = await fixture(t);
    const extra = createExtraService({
      ...options,
      module: { name: "lease-failure", default: () => () => {} }
    });
    await extra.initialize();
    await writeFile(`${options.controlEndpoint}.owner`, '{"nonce":"changed"}');
    assert.equal((await extra.close()).complete, false);
    await stat(`${options.controlEndpoint}.owner`);
  }
);

test("startup rejection after cancelled cleanup expiry stays observed and preserves the cancellation cause", async (t) => {
  const options = await fixture(t);
  const entered = Promise.withResolvers();
  const finish = Promise.withResolvers();
  const controller = new AbortController();
  const extra = createExtraService({
    ...options,
    module: {
      name: "late-startup-rejection",
      default: () => () => {
        entered.resolve();
        return finish.promise;
      }
    }
  });
  const initializing = extra.initialize({ signal: controller.signal });
  const rejected = assert.rejects(initializing, (error) => {
    assert.equal(error.cause.name, "AbortError");
    assert.equal(error.cleanup.complete, false);
    return true;
  });
  await entered.promise;
  withShutdownDeadline(performance.now() + 80, () => controller.abort());
  await rejected;
  const cleanup = await extra.close();
  finish.reject(new Error("LATE_STARTUP_FAILURE"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await extra.status()).phase, "failed");
  assert.equal(await extra.close(), cleanup);
});
