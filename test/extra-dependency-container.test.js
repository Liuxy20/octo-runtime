import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { ExtraPlugins, createExtraService } from "@mininglamp-oss/octo-runtime-host-sdk";
import { withShutdownDeadline } from "@mininglamp-oss/octo-runtime-host-sdk/shutdown";

const readSymbol = Symbol("read");
class BusinessState {
  #value = "initial";
  read() {
    return this.#value;
  }
  update(value) {
    this.#value = value;
  }
  [readSymbol]() {
    return this.#value;
  }
}
class Dependencies extends BusinessState {
  constructor(entered, finish) {
    super();
    this.entered = entered;
    this.finish = finish;
    Object.defineProperty(this, "hiddenRead", {
      value() {
        return this.read();
      }
    });
  }
  async save(value) {
    this.entered.resolve();
    await this.finish.promise;
    this.update(value);
  }
}

for (const native of [false, true]) {
  test(`${native ? "native service" : "direct loader"} preserves class dependency receivers and inherited members`, async (t) => {
    const entered = Promise.withResolvers();
    const finish = Promise.withResolvers();
    const host = new Dependencies(entered, finish);
    let captured;
    const module = {
      name: "class-dependencies",
      default(ctx) {
        return (dependencies) => {
          captured = dependencies;
          assert.equal(dependencies.read(), "initial");
          assert.equal(dependencies.hiddenRead(), "initial");
          assert.equal(dependencies[readSymbol](), "initial");
          ctx.onDispose(() => dependencies.save("saved"));
        };
      }
    };
    const loader = new ExtraPlugins([], {});
    const extra = native
      ? createExtraService({
          endpoint: `/unused-${randomUUID()}`,
          module,
          config: {},
          dependencies: host
        })
      : undefined;
    t.after(async () => {
      finish.resolve();
      await (native ? extra.close() : loader.close());
    });
    if (native) await extra.initialize();
    else await loader.load(module, {}, host);
    assert.ok(captured instanceof Dependencies);
    assert.equal(Object.getOwnPropertyDescriptor(captured, "read").enumerable, false);
    assert.equal(Object.isFrozen(host), false);
    host.update("changed");
    assert.equal(captured.read(), "changed");
    assert.equal(captured.hiddenRead(), "changed");
    assert.equal(captured[readSymbol](), "changed");
    assert.throws(() => {
      captured.read = () => "replaced";
    }, TypeError);
    assert.equal(host.read(), "changed");
    const save = captured.save;
    let closed = false;
    const closing = (native ? extra.close() : loader.close()).then((result) => {
      closed = true;
      return result;
    });
    await entered.promise;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(closed, false);
    finish.resolve();
    const cleanup = await closing;
    if (native) {
      assert.equal(cleanup.complete, true);
      assert.throws(() => save("late"), /EXTRA_DEPENDENCIES_CLOSED/);
    }
    assert.equal(host.read(), "saved");
    host.update("host-owned");
    assert.equal(host.read(), "host-owned");
  });
}

test("class dependency operations retain capacity and incomplete ownership until actual settlement", async (t) => {
  const finish = Promise.withResolvers();
  class PendingDependencies {
    #calls = 0;
    save() {
      this.#calls++;
      return finish.promise;
    }
    get calls() {
      return this.#calls;
    }
  }
  const host = new PendingDependencies();
  let captured;
  const options = {
    endpoint: `/unused-${randomUUID()}`,
    module: {
      name: "class-capacity",
      default: () => (dependencies) => {
        captured = dependencies;
      }
    },
    config: {},
    dependencies: host
  };
  const extra = createExtraService(options);
  t.after(async () => {
    finish.resolve();
    await extra.close();
  });
  await extra.initialize();
  for (let index = 0; index < 128; index++) void captured.save();
  assert.throws(() => captured.save(), /EXTRA_DEPENDENCY_CAPACITY_EXHAUSTED/);
  assert.equal(host.calls, 128);
  const cleanup = await withShutdownDeadline(performance.now() + 80, () => extra.close());
  assert.equal(cleanup.complete, false);
  assert.ok(cleanup.pendingResources.includes("dependencies"));
  assert.throws(() => captured.save(), /EXTRA_DEPENDENCIES_CLOSED/);
  await assert.rejects(
    createExtraService(options).initialize(),
    (error) => error.cause?.message === "EXTRA_DISPOSE_FAILED"
  );
  finish.resolve();
  assert.equal(await extra.close(), cleanup);
  assert.equal(host.calls, 128);
});
