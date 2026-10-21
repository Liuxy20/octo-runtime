import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { createExtraService } from "@mininglamp-oss/octo-runtime-host-sdk";
import { withShutdownDeadline } from "@mininglamp-oss/octo-runtime-host-sdk/shutdown";

function service(module, dependencies) {
  return createExtraService({
    endpoint: `/unused-${randomUUID()}`,
    module,
    dependencies,
    config: {}
  });
}

test("disposer can save through injected host SQLite and captured dependencies close afterwards", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec("CREATE TABLE terminal (value TEXT)");
  let captured;
  const extra = service(
    {
      name: "save-disposer",
      default(ctx) {
        return (dependencies) => {
          captured = dependencies;
          ctx.onDispose(() => dependencies.save());
        };
      }
    },
    {
      save() {
        database.exec("INSERT INTO terminal VALUES ('cancelled')");
      }
    }
  );
  try {
    await extra.initialize();
    const closing = extra.close();
    assert.equal(extra.close(), closing);
    assert.equal((await closing).complete, true);
    assert.equal(database.prepare("SELECT count(*) AS n FROM terminal").get().n, 1);
    assert.throws(() => captured.save(), /EXTRA_DEPENDENCIES_CLOSED/);
    assert.equal(database.prepare("SELECT count(*) AS n FROM terminal").get().n, 1);
  } finally {
    database.close();
  }
});

for (const cancelled of [false, true]) {
  test(`initialization ${cancelled ? "cancellation" : "failure"} permits bounded disposer save`, async () => {
    const entered = Promise.withResolvers();
    let saves = 0;
    let captured;
    const extra = service(
      {
        name: "rollback-save",
        default(ctx) {
          return async (dependencies) => {
            captured = dependencies;
            ctx.onDispose(() => dependencies.save());
            entered.resolve();
            if (cancelled)
              await new Promise((resolve) =>
                ctx.signal.addEventListener("abort", resolve, { once: true })
              );
            else throw new Error("START_FAILED");
          };
        }
      },
      {
        save() {
          saves++;
        }
      }
    );
    const controller = new AbortController();
    const initializing = extra.initialize({ signal: controller.signal });
    const rejected = assert.rejects(initializing, (error) => error.cleanup.complete);
    await entered.promise;
    if (cancelled) controller.abort();
    await rejected;
    assert.equal(saves, 1);
    assert.throws(() => captured.save(), /EXTRA_DEPENDENCIES_CLOSED/);
    assert.notEqual((await extra.status()).phase, "ready");
  });
}

test("a dependency started by dispose is awaited even if the disposer forgets to await it", async () => {
  const entered = Promise.withResolvers();
  const finish = Promise.withResolvers();
  const extra = service(
    {
      name: "late-dependency",
      default(ctx) {
        return (dependencies) => {
          ctx.onDispose(() => {
            void dependencies.save();
          });
        };
      }
    },
    {
      save() {
        entered.resolve();
        return finish.promise;
      }
    }
  );
  await extra.initialize();
  let closed = false;
  const closing = extra.close().then((result) => {
    closed = true;
    return result;
  });
  await entered.promise;
  await Promise.resolve();
  assert.equal(closed, false);
  finish.resolve();
  assert.equal((await closing).complete, true);
});

test("rejected host save remains a plugin failure and leaves the host database usable", async () => {
  const database = new DatabaseSync(":memory:");
  const module = {
    name: "reject-save",
    default(ctx) {
      return (dependencies) => {
        ctx.onDispose(() => dependencies.save());
      };
    }
  };
  const extra = service(module, {
    save() {
      return Promise.reject(new Error("SAVE_FAILED"));
    }
  });
  try {
    await extra.initialize();
    const cleanup = await extra.close();
    assert.equal(cleanup.complete, false);
    assert.ok(cleanup.pendingResources.includes("plugin"));
    assert.equal(database.prepare("SELECT 1 AS n").get().n, 1);
    assert.equal(await extra.close(), cleanup);
  } finally {
    database.close();
  }
});

test("shared deadline revokes late dependency calls and retains unfinished occupancy", async () => {
  let captured;
  let calls = 0;
  const finish = Promise.withResolvers();
  const module = {
    name: "deadline-save",
    default(ctx) {
      return (dependencies) => {
        captured = dependencies;
        ctx.onDispose(() => dependencies.save());
      };
    }
  };
  const options = {
    endpoint: `/unused-${randomUUID()}`,
    module,
    config: {},
    dependencies: {
      save() {
        calls++;
        return finish.promise;
      }
    }
  };
  const extra = createExtraService(options);
  await extra.initialize();
  const started = performance.now();
  const closing = withShutdownDeadline(started + 80, () => extra.close());
  assert.equal(extra.close(), closing);
  const cleanup = await closing;
  assert.equal(cleanup.complete, false);
  assert.ok(cleanup.pendingResources.includes("dependencies"));
  assert.ok(performance.now() - started < 1000);
  assert.throws(() => captured.save(), /EXTRA_DEPENDENCIES_CLOSED/);
  assert.equal(calls, 1);
  await assert.rejects(
    createExtraService(options).initialize(),
    (error) => error.cause?.message === "EXTRA_DISPOSE_FAILED"
  );
  finish.resolve();
  await Promise.resolve();
  assert.equal(await extra.close(), cleanup);
  assert.equal(cleanup.complete, false);
});

test("deadline revokes dependencies while an initializer still ignores cancellation", async () => {
  const entered = Promise.withResolvers();
  const finish = Promise.withResolvers();
  let captured;
  let calls = 0;
  const extra = service(
    {
      name: "stuck-start",
      default() {
        return async (dependencies) => {
          captured = dependencies;
          entered.resolve();
          await finish.promise;
        };
      }
    },
    {
      save() {
        calls++;
      }
    }
  );
  const initializing = extra.initialize();
  const rejected = assert.rejects(initializing, (error) => !error.cleanup.complete);
  await entered.promise;
  const cleanup = await withShutdownDeadline(performance.now() + 80, () => extra.close());
  assert.equal(cleanup.complete, false);
  assert.throws(() => captured.save(), /EXTRA_DEPENDENCIES_CLOSED/);
  assert.equal(calls, 0);
  finish.resolve();
  await rejected;
  assert.notEqual((await extra.status()).phase, "ready");
});

test("deadline fences a stuck disposer even before its late cleanup returns", async () => {
  const finish = Promise.withResolvers();
  let captured;
  let calls = 0;
  const extra = service(
    {
      name: "stuck-dispose",
      default(ctx) {
        return (dependencies) => {
          captured = dependencies;
          ctx.onDispose(() => finish.promise);
        };
      }
    },
    {
      save() {
        calls++;
      }
    }
  );
  await extra.initialize();
  const cleanup = await withShutdownDeadline(performance.now() + 80, () => extra.close());
  assert.equal(cleanup.complete, false);
  assert.ok(cleanup.pendingResources.includes("plugin"));
  assert.throws(() => captured.save(), /EXTRA_DEPENDENCIES_CLOSED/);
  assert.equal(calls, 0);
  finish.resolve();
  assert.equal(await extra.close(), cleanup);
});

test("cancelled dependency promises keep actual capacity until settlement", async () => {
  const finish = Promise.withResolvers();
  let captured;
  let calls = 0;
  const extra = service(
    {
      name: "capacity-save",
      default() {
        return (dependencies) => {
          captured = dependencies;
        };
      }
    },
    {
      save() {
        calls++;
        return finish.promise;
      }
    }
  );
  await extra.initialize();
  for (let index = 0; index < 128; index++) void captured.save();
  assert.throws(() => captured.save(), /EXTRA_DEPENDENCY_CAPACITY_EXHAUSTED/);
  const cleanup = await withShutdownDeadline(performance.now() + 80, () => extra.close());
  assert.equal(cleanup.complete, false);
  assert.ok(cleanup.pendingResources.includes("dependencies"));
  assert.equal(calls, 128);
  finish.resolve();
  await Promise.resolve();
  assert.throws(() => captured.save(), /EXTRA_DEPENDENCIES_CLOSED/);
  assert.equal(await extra.close(), cleanup);
});

test("initialization rollback and outer cleanup share the original deadline", async () => {
  const finish = Promise.withResolvers();
  let captured;
  const extra = service(
    {
      name: "rollback-deadline",
      default(ctx) {
        return (dependencies) => {
          captured = dependencies;
          ctx.onDispose(() => dependencies.save());
          throw new Error("START_FAILED");
        };
      }
    },
    { save: () => finish.promise }
  );
  const started = performance.now();
  await assert.rejects(
    withShutdownDeadline(started + 80, () => extra.initialize()),
    (error) =>
      error.cause.message === "START_FAILED" &&
      !error.cleanup.complete &&
      error.cleanup.pendingResources.includes("dependencies")
  );
  assert.ok(performance.now() - started < 1000);
  assert.throws(() => captured.save(), /EXTRA_DEPENDENCIES_CLOSED/);
  finish.resolve();
  assert.equal((await extra.close()).complete, false);
});
