import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createExtraService, componentEndpoint } from "@mininglamp-oss/octo-runtime-host-sdk";
import { attachKernel, createKernelService } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { kernelInput, frames, kernelFixture } from "./kernel-fixture.js";
import { waitFor } from "./runtime-fixture.js";
import * as invoking from "./fixtures/invoking-extra.mjs";
import * as siblingInvoking from "./fixtures/sibling-invoking-extra.mjs";
import * as independent from "./fixtures/independent-extra.mjs";
import { isHostTerminal, isTerminal } from "@mininglamp-oss/octo-runtime-protocol";

test("closing an Extra drains its accepted Run while sibling and Kernel remain live", async (t) => {
  const { client, endpoint } = await kernelFixture(t);
  const app = attachKernel({ endpoint });
  const appTask = (async () => {
    for await (const _event of app.invoke(kernelInput("wait-for-cancel"))) void _event;
  })();
  void appTask.catch(() => undefined);
  t.after(async () => {
    app.close();
    await appTask.catch(() => undefined);
  });
  await waitFor(() => app.invocations.snapshot()[0]?.ref !== undefined);
  const appRef = app.invocations.snapshot()[0].ref;
  const siblingInput = kernelInput("wait-for-cancel");
  const siblingExtra = createExtraService({
    endpoint,
    module: siblingInvoking,
    config: { input: siblingInput },
    dependencies: {}
  });
  t.after(() => siblingExtra.close());
  await siblingExtra.initialize();
  const siblingKey = {
    run_id: siblingInput.runId,
    invocation_id: siblingInput.invocationId,
    agent_session_id: siblingInput.sessionId,
    session_generation: siblingInput.sessionGeneration ?? 0,
    protocol_mode: siblingInput.protocol_mode
  };
  await waitFor(async () =>
    client.get(siblingKey).then(
      () => true,
      () => false
    )
  );
  const sibling = await client.get(siblingKey);
  const input = kernelInput("wait-for-cancel");
  const extra = createExtraService({
    endpoint,
    module: invoking,
    config: { input },
    dependencies: {}
  });
  t.after(() => extra.close());
  await extra.initialize();
  const key = {
    run_id: input.runId,
    invocation_id: input.invocationId,
    agent_session_id: input.sessionId,
    session_generation: input.sessionGeneration ?? 0,
    protocol_mode: input.protocol_mode
  };
  await waitFor(() =>
    client.get(key).then(
      () => true,
      () => false
    )
  );
  const own = await client.get(key);
  assert.equal((await extra.close()).complete, true);
  assert.equal((await client.get(own.ref)).terminal.control.state, "cancelled");
  assert.equal((await client.get(sibling.ref)).terminal, undefined);
  assert.equal((await client.get(appRef)).terminal, undefined);
  assert.notEqual((await siblingExtra.status()).plugin.state, "failed");
  assert.equal((await client.status()).execution_ready, true);
  assert.equal((await siblingExtra.close()).complete, true);
  assert.equal((await client.get(appRef)).terminal, undefined);
  await app.cancelInvocation(appRef.invocation_id);
  await appTask;
});

for (const failDispose of [false, true])
  test(`Extra cleanup awaits delivery after the source terminal (dispose failure=${failDispose})`, async (t) => {
    const { directory, endpoint } = await kernelFixture(t);
    const deliveryFile = join(directory, "delivery");
    const extra = createExtraService({
      endpoint,
      module: invoking,
      config: { input: kernelInput(), deliveryFile, failDispose },
      dependencies: {}
    });
    t.after(() => extra.close());
    await extra.initialize();
    await waitFor(async () => (await extra.status()).plugin.state === "delivering");
    const cleanup = await extra.close();
    assert.equal(await readFile(deliveryFile, "utf8"), "delivered");
    assert.equal(cleanup.complete, !failDispose);
  });

test("native Kernel belongs to this process; replacement is explicit construction", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "okh-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const options = {
    endpoint: componentEndpoint(home),
    workerEntrypoint: resolve("test/fixtures/direct-adapter-host.js")
  };
  const kernel = createKernelService(options);
  t.after(() => kernel.close());
  assert.equal((await kernel.status()).phase, "created");
  const initializing = kernel.initialize();
  assert.equal(kernel.initialize(), initializing);
  await initializing;
  const first = await kernel.client.status();
  assert.equal(first.pid, process.pid);
  const attached = attachKernel({ endpoint: options.endpoint });
  const { ref } = await attached.submit(kernelInput("wait-for-cancel"));
  attached.close();
  assert.equal((await kernel.client.get(ref)).terminal, undefined);
  assert.equal("stop" in attached, false);
  const closed = kernel.close();
  assert.equal(kernel.close(), closed);
  assert.equal((await closed).complete, true);
  assert.equal(await kernel.closed, await closed);
  const next = createKernelService(options);
  t.after(() => next.close());
  await next.initialize();
  assert.notEqual((await next.client.status()).kernel_instance_id, first.kernel_instance_id);
  await assert.rejects(next.client.get(ref, ref.kernel_instance_id), /KERNEL_INSTANCE_CHANGED/);
});

test("Extra sees live same-process business state without requiring Kernel", async (t) => {
  let text = "first";
  let callbackPid;
  const extra = createExtraService({
    endpoint: "/unused-native-kernel.sock",
    module: independent,
    config: {},
    dependencies: {
      loadContexts: () => {
        callbackPid = process.pid;
        return [{ namespace: "extra.test", name: "current", payload: { text } }];
      }
    }
  });
  t.after(() => extra.close());
  await extra.initialize();
  const status = await extra.status();
  assert.equal(status.pid, process.pid);
  assert.equal(status.plugin.pid, process.pid);
  assert.equal(callbackPid, process.pid);
  assert.equal(status.plugin.text, "first");
  text = "second";
  await waitFor(async () => (await extra.status()).plugin.text === "second");
  assert.equal((await extra.close()).complete, true);
});

test("failed Extra disposal blocks replacement only for the same Kernel endpoint", async () => {
  const options = {
    endpoint: "/failed-native-kernel.sock",
    module: independent,
    config: { failDispose: true },
    dependencies: {}
  };
  const extra = createExtraService(options);
  await extra.initialize();
  const result = await extra.close();
  assert.equal(result.complete, false);
  assert.ok(result.pendingResources.includes("plugin"));
  await assert.rejects(
    createExtraService(options).initialize(),
    (error) => error.cause?.message === "EXTRA_DISPOSE_FAILED"
  );
  const other = createExtraService({
    ...options,
    endpoint: "/other-native-kernel.sock",
    config: {}
  });
  await other.initialize();
  assert.equal((await other.close()).complete, true);
});

test("Extra disposers observe source terminal and persisted business tail before handles close", async (t) => {
  const { endpoint, client } = await kernelFixture(t);
  const input = kernelInput("wait-for-cancel");
  let tail = false;
  const database = new DatabaseSync(":memory:");
  database.exec("CREATE TABLE terminal (value TEXT)");
  const saving = Promise.withResolvers();
  const saved = Promise.withResolvers();
  let pluginClient;
  let task;
  const extra = createExtraService({
    endpoint,
    config: {},
    dependencies: {
      async saveTerminal() {
        saving.resolve();
        await saved.promise;
        database.exec("INSERT INTO terminal VALUES ('cancelled')");
      }
    },
    module: {
      name: "tail-order",
      default(ctx) {
        pluginClient = ctx.kernel;
        ctx.onDispose(async () => {
          await task;
          assert.equal(tail, true);
          assert.equal(database.prepare("SELECT value FROM terminal").get().value, "cancelled");
        });
        return (dependencies) => {
          task = (async () => {
            try {
              for await (const frame of ctx.kernel.invoke(input, { signal: ctx.signal })) {
                if ("kind" in frame ? isHostTerminal(frame) : isTerminal(frame)) tail = true;
              }
            } catch (error) {
              assert.equal(error, ctx.signal.reason);
            }
            assert.equal(tail, true);
            await dependencies.saveTerminal();
          })();
          void task.catch(() => undefined);
        };
      }
    }
  });
  t.after(async () => {
    await extra.close();
    database.close();
  });
  await extra.initialize();
  await waitFor(() =>
    client
      .get({
        run_id: input.runId,
        invocation_id: input.invocationId,
        agent_session_id: input.sessionId,
        session_generation: input.sessionGeneration ?? 0,
        protocol_mode: input.protocol_mode
      })
      .then(
        () => true,
        () => false
      )
  );
  let closed = false;
  const closing = extra.close().then((result) => {
    closed = true;
    return result;
  });
  await assert.rejects(async () => {
    for await (const frame of pluginClient.invoke(kernelInput("must-not-start"))) void frame;
  }, /CLOSED/);
  await saving.promise;
  assert.equal(tail, true);
  assert.equal(closed, false);
  saved.resolve();
  const cleanup = await closing;
  assert.equal(cleanup.complete, true, JSON.stringify(cleanup));
  assert.equal(tail, true);
  assert.equal(database.prepare("SELECT value FROM terminal").get().value, "cancelled");
});

test("close cancels an initializer's owned Run even when it omitted the plugin signal", async (t) => {
  const { endpoint, client } = await kernelFixture(t);
  const input = kernelInput("wait-for-cancel");
  const extra = createExtraService({
    endpoint,
    config: {},
    dependencies: {},
    module: {
      name: "initializing-run",
      default(ctx) {
        return async () => {
          for await (const event of ctx.kernel.invoke(input)) void event;
        };
      }
    }
  });
  const initializing = extra.initialize();
  void initializing.catch(() => undefined);
  await waitFor(() =>
    client
      .get({
        run_id: input.runId,
        invocation_id: input.invocationId,
        agent_session_id: input.sessionId,
        session_generation: input.sessionGeneration ?? 0,
        protocol_mode: input.protocol_mode
      })
      .catch(() => undefined)
  );
  const started = Date.now();
  const cleanup = await extra.close();
  assert.equal(cleanup.complete, true, JSON.stringify(cleanup));
  assert.ok(Date.now() - started < 2000);
  await assert.rejects(initializing, (error) => error.cleanup.complete);
});

test("initializer failure cancels its Run before awaiting disposal and saves the source terminal", async (t) => {
  const { endpoint, client } = await kernelFixture(t);
  const instance = (await client.status()).kernel_instance_id;
  const unrelated = await client.submit(kernelInput("wait-for-cancel"));
  const input = kernelInput("wait-for-cancel");
  const key = {
    run_id: input.runId,
    invocation_id: input.invocationId,
    agent_session_id: input.sessionId,
    session_generation: input.sessionGeneration ?? 0,
    protocol_mode: input.protocol_mode
  };
  const cause = new Error("INITIALIZER_FAILED_AFTER_ACCEPTANCE");
  let task;
  let saved;
  const options = {
    endpoint,
    config: {},
    dependencies: {
      saveTerminal: (terminal) => {
        saved = terminal;
      }
    },
    module: {
      name: "rollback-owned-run",
      default(ctx) {
        ctx.onDispose(async () => {
          await task;
        });
        return async (dependencies) => {
          task = (async () => {
            for await (const event of ctx.kernel.invoke(input)) {
              if (isTerminal(event)) await dependencies.saveTerminal(event);
            }
          })();
          void task.catch(() => undefined);
          await waitFor(() => client.get(key).catch(() => undefined));
          throw cause;
        };
      }
    }
  };
  const extra = createExtraService(options);
  t.after(() => extra.close());
  await assert.rejects(extra.initialize(), (error) => {
    assert.equal(error.cause, cause);
    assert.equal(error.cleanup.complete, true, JSON.stringify(error.cleanup));
    return true;
  });
  assert.equal(saved.type, "run.cancelled");
  assert.equal((await client.get(key)).terminal.control.state, "cancelled");
  const closing = extra.close();
  assert.equal(extra.close(), closing);
  assert.equal(await closing, await extra.closed);
  assert.equal((await client.get(unrelated.ref)).terminal, undefined);
  assert.equal((await client.status()).kernel_instance_id, instance);
  const replacement = createExtraService({
    ...options,
    module: { name: options.module.name, default: () => () => {} }
  });
  await replacement.initialize();
  assert.equal((await replacement.close()).complete, true);
  await client.cancel(unrelated.ref, "test_cleanup");
});
