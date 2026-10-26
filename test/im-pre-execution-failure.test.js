import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { setImmediate as settle } from "node:timers/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { RuntimeLogging } from "../packages/octo-runtime-adapter-sdk/dist/index.js";
import { withShutdownDeadline } from "../packages/octo-runtime-host-sdk/dist/shutdown.js";
import { performance } from "node:perf_hooks";
import {
  KernelError,
  isInvocationNotSubmitted
} from "@mininglamp-oss/octo-runtime-executor-kernel";
import { prepareInvokeInput } from "@mininglamp-oss/octo-runtime-executor-core";
import { failurePayload } from "@mininglamp-oss/octo-runtime-protocol";
import { kernelFixture, kernelInput } from "./kernel-fixture.js";
import { buildReasoningFrame } from "../packages/octo-runtime-extra-channel-gateway/dist/transport/reasoning-frame.js";
import { ImRunProjector } from "../packages/octo-runtime-extra-channel-gateway/dist/presentation/run-projector.js";

const event = (type, payload = {}) => ({ protocolVersion: 2, type, payload });
async function until(predicate) {
  for (let i = 0; i < 300; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("turn did not settle");
}

async function fixture(t, suffix, options = {}) {
  const { ImRuntime } = await import(
    `../packages/octo-runtime-extra-channel-${suffix}/dist/index.js`
  );
  const { MemoryImSessionStore } = await import(
    `../packages/octo-runtime-extra-channel-${suffix}/dist/application/session-store.js`
  );
  const transport = await import(
    `../packages/octo-runtime-extra-channel-${suffix}/dist/transport/channel.js`
  );
  const Transport = transport[suffix === "gateway" ? "GatewayTransport" : "WecomTransport"];
  let receive;
  t.mock.method(Transport.prototype, "start", async function () {
    receive = (message) => this.callbacks.onMessage(message);
  });
  t.mock.method(Transport.prototype, "close", async () => {});
  const store = options.store ?? new MemoryImSessionStore();
  const calls = [],
    replies = [],
    failures = [],
    diagnostics = [],
    logs = [],
    saved = [];
  const remember = store.remember.bind(store);
  t.mock.method(store, "remember", (...args) => {
    saved.push(structuredClone(args[2]));
    return remember(...args);
  });
  const cancellations = [];
  const runtime = new ImRuntime(
    {
      bot_id: "pre-execution-fixture",
      ...(suffix === "gateway"
        ? { api_url: "https://im-test.deepminer.com.cn/api" }
        : { app_secret: randomBytes(16).toString("hex") }),
      adapter: { adapter_type: options.adapterType ?? "codex", workdir: process.cwd() },
      ...(suffix === "gateway" ? { codex_retry: { initial_delay_ms: 100, max_delay_ms: 100 } } : {})
    },
    {
      sessions: store,
      log: (...entry) => {
        logs.push(entry);
        options.log?.(...entry);
      },
      onDiagnostic: (code) => diagnostics.push(code),
      kernel: {
        async *invoke(input, environment) {
          const { request } = prepareInvokeInput(input);
          calls.push(request);
          if (options.invoke) yield* options.invoke(input, environment, calls);
          else {
            yield event("message.delta", { messageId: "answer", channel: "final", text: "answer" });
            yield event("run.completed");
          }
        },
        async cancelInvocation(id, reason) {
          cancellations.push(id);
          if (options.cancelInvocation) return options.cancelInvocation(id, reason);
          return { accepted: true };
        },
        async respondInteraction() {}
      }
    }
  );
  await runtime.start();
  t.after(async () => {
    try {
      await runtime.close();
    } catch (error) {
      if (!options.expectedCloseFailure) throw error;
    } finally {
      store.close?.();
    }
  });
  let sequence = 0;
  const send = (overrides = {}) =>
    receive({
      messageId: `message-${++sequence}`,
      senderId: "owner",
      conversationId: "chat",
      conversationKind: "direct",
      text: "hello",
      buildContext: async () => ({ schema: "octo.context-envelope/v3", items: [] }),
      reply: async (text, key) => replies.push({ text, key }),
      replyFailure: async (value) => failures.push(value),
      ...overrides
    });
  const done = async () => {
    await until(() => replies.length && runtime.status.sessions.length === 0);
    await settle();
  };
  return {
    runtime,
    store,
    calls,
    replies,
    failures,
    diagnostics,
    logs,
    saved,
    cancellations,
    send,
    done
  };
}

for (const suffix of ["gateway", "wecom"]) {
  test(`${suffix}: read failure projects one shared error and same message works after recovery`, async (t) => {
    const f = await fixture(t, suffix);
    let broken = true;
    const read = f.store.read.bind(f.store);
    t.mock.method(f.store, "read", (...args) => {
      if (broken) throw Error("PRIVATE_PATH_AND_BODY");
      return read(...args);
    });
    f.send({ messageId: "same" });
    await f.done();
    assert.equal(f.calls.length, 0);
    assert.deepEqual(f.cancellations, []);
    assert.match(f.replies[0].text, /OH-RUN-2010/);
    const root = f.logs.find(
      ([, name, data]) => name === "channel.diagnostic" && data.code === "OH-RUN-2010"
    )[2];
    assert.match(f.replies[0].text, new RegExp(root.diagnostic_id));
    assert.equal(root.stage, "channel_session_read");
    assert.equal(root.run_id, undefined);
    assert.equal(root.reason_code, "IM_SESSION_STORE_FAILED");
    assert.equal(f.runtime.status.state, "online");
    assert.equal(f.runtime.status.error, null);
    assert.doesNotMatch(JSON.stringify(f.logs), /PRIVATE_PATH_AND_BODY/);
    if (suffix === "gateway") {
      assert.equal(f.failures.length, 1);
      assert.equal(f.failures[0].payload.failure.diagnosticId, root.diagnostic_id);
      const projector = new ImRunProjector("local-failure", true);
      projector.accept(f.failures[0]);
      const card = buildReasoningFrame(projector.snapshot(), {
        ref: { id: "ai.reasoning-process", version: "0.4.0" },
        maxPayloadBytes: 16384
      });
      assert.match(JSON.stringify(card), /OH-RUN-2010/);
      assert.match(JSON.stringify(card), new RegExp(root.diagnostic_id));
    }
    broken = false;
    f.send({ messageId: "same" });
    await until(() => f.calls.length === 1 && f.runtime.status.sessions.length === 0);
    assert.equal(f.replies.at(-1).text, "answer");
  });

  for (const mode of ["begin", "initial-update"]) {
    test(`${suffix}: ${mode} failure never invokes or cancels; occurrence records non-submission`, async (t) => {
      const f = await fixture(t, suffix);
      let updates = 0,
        finishes = 0;
      f.send({
        messageId: "not-submitted",
        beginPresentation() {
          if (mode === "begin") throw Error("private initialization error");
          return {
            update() {
              updates++;
              throw Error("private update error");
            },
            async finish() {
              finishes++;
            }
          };
        }
      });
      await f.done();
      assert.equal(f.calls.length, 0);
      assert.deepEqual(f.cancellations, []);
      assert.match(f.replies[0].text, /OH-RUN-2011/);
      assert.doesNotMatch(f.replies[0].text, /未知|private/);
      assert.equal(updates, mode === "begin" ? 0 : 1);
      assert.equal(finishes, mode === "begin" ? 0 : 1);
      assert.equal(f.saved.at(-1).notSubmittedFailure.code, "OH-RUN-2011");
      if (suffix === "gateway") assert.deepEqual(f.saved.at(-1).attempts, []);
      t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
      t.mock.timers.tick(120_001);
      // An external host may retain occurrence records beyond the built-in TTL.
      const prior = f.saved.at(-1);
      const occurrence = t.mock.method(f.store, "occurrence", () => structuredClone(prior));
      try {
        f.send({ messageId: "not-submitted" });
        await until(() => f.replies.length === 2);
      } finally {
        occurrence.mock.restore();
      }
      assert.match(f.replies[1].text, /原消息尚未提交/);
      assert.doesNotMatch(f.replies[1].text, /已经提交/);
      assert.match(f.replies[1].text, new RegExp(prior.notSubmittedFailure.diagnosticId));
    });
  }

  for (const mode of [
    "progress",
    "terminal",
    "finish",
    "source-after-terminal",
    "source-after-failed"
  ]) {
    test(`${suffix}: ${mode} failure preserves execution facts and final text`, async (t) => {
      const f = await fixture(t, suffix, {
        invoke: async function* () {
          yield event("message.delta", { messageId: "answer", channel: "final", text: "answer" });
          yield event(mode === "source-after-failed" ? "run.failed" : "run.completed");
          if (mode.startsWith("source-after-")) throw Error("source disconnected");
        }
      });
      let count = 0;
      let controls;
      f.send({
        beginPresentation(_run, _diagnostic, value) {
          controls = value;
          return {
            update(snapshot) {
              count++;
              if (
                (mode === "progress" && count === 2) ||
                (mode === "terminal" && snapshot.terminal)
              )
                throw Error("display unavailable");
            },
            async finish() {
              if (mode === "finish") throw Error("finish unavailable");
            }
          };
        }
      });
      await f.done();
      assert.equal(f.calls.length, 1);
      assert.equal(
        f.cancellations.length,
        mode === "progress" || mode.startsWith("source-after-") ? 1 : 0
      );
      if (mode.startsWith("source-after-")) {
        assert.match(f.replies[0].text, /结果未知/);
        assert.equal(controls.retry("owner", "unsafe-retry"), false);
      } else assert.equal(f.replies[0].text, "answer");
      assert.equal(f.failures.length, 0);
      assert.ok(!f.logs.some(([, , data]) => data?.code === "OH-RUN-2011"));
    });
  }

  test(`${suffix}: a same-code untrusted rejection remains unknown`, async (t) => {
    const f = await fixture(t, suffix, {
      invoke: async function* () {
        throw new KernelError("CLIENT_INVOCATION_ADMISSION_CLOSED");
      }
    });
    f.send();
    await f.done();
    assert.match(f.replies[0].text, /结果未知/);
    assert.equal(f.cancellations.length, 1);
    assert.equal(f.failures.length, 0);
  });

  test(`${suffix}: real Kernel admission rejection reaches feedback without cancel or replay`, async (t) => {
    const k = await kernelFixture(t);
    k.client.invocations.stopAdmission();
    const f = await fixture(t, suffix, { invoke: (input, env) => k.client.invoke(input, env) });
    f.send();
    await f.done();
    assert.match(f.replies[0].text, /OH-RUN-2012/);
    assert.doesNotMatch(f.replies[0].text, /未知/);
    assert.equal(f.calls.length, 1);
    assert.equal(f.cancellations.length, 0);
    assert.deepEqual(k.client.invocations.snapshot(), []);
    assert.equal(f.saved.at(-1).notSubmittedFailure.code, "OH-RUN-2012");
    if (suffix === "gateway") {
      assert.equal(f.saved.at(-1).attempts[0].outcome, "not_submitted");
      assert.equal(
        f.saved.at(-1).attempts[0].diagnosticId,
        f.failures[0].payload.failure.diagnosticId
      );
    }
  });
}

for (const mode of ["control", "completed", "cancelled", "source-error"]) {
  test(`Gateway: real Kernel presentation cancellation preserves observation: ${mode}`, async (t) => {
    const k = await kernelFixture(t, { manifest: resolve("test/fixtures/invoke-adapters.json") });
    const source = [];
    let observedSignal;
    const f = await fixture(t, "gateway", {
      adapterType: "test",
      invoke: async function* (input, environment) {
        observedSignal = environment.signal;
        for await (const value of k.client.invoke(input, environment)) {
          source.push(value.type);
          yield value;
        }
        if (mode === "source-error") throw new Error("fixture post-terminal source failure");
      },
      cancelInvocation: async (id, reason) => {
        // 固定取消与完成的先后关系；cancelled 场景另验真实在途执行取消。
        if (mode !== "cancelled") await until(() => source.includes("run.completed"));
        return k.client.cancelInvocation(id, reason);
      }
    });
    let updates = 0;
    f.send({
      text: mode === "cancelled" ? "wait-for-cancel" : "complete",
      beginPresentation: () => ({
        update() {
          if (++updates === 2 && mode !== "control") throw new Error("fixture display failure");
        },
        async finish() {}
      })
    });
    await f.done();
    assert.equal(f.calls.length, 1);
    const terminal = mode === "cancelled" ? "run.cancelled" : "run.completed";
    assert.ok(source.includes(terminal), source.join(","));
    assert.equal(
      f.saved.at(-1).attempts[0].outcome,
      mode === "source-error" ? "unknown" : terminal
    );
    assert.equal(observedSignal.aborted, false, "display cancellation must retain the observer");
    if (mode === "source-error") assert.match(f.replies.at(-1).text, /结果未知/);
    else {
      assert.doesNotMatch(f.replies.at(-1).text, /结果未知/);
      assert.equal(f.diagnostics.includes("IM_EXECUTION_RESULT_UNKNOWN"), false);
      assert.equal(f.cancellations.length, mode === "control" ? 0 : 1);
      if (mode !== "cancelled") assert.equal(f.replies.at(-1).text, "answer");
    }
    assert.deepEqual(k.client.invocations.snapshot(), []);
  });
}

test("Gateway: a later rejected retry retains the earlier execution record", async (t) => {
  const k = await kernelFixture(t);
  k.client.invocations.stopAdmission();
  const f = await fixture(t, "gateway", {
    invoke: async function* (input, env, calls) {
      if (calls.length > 1) return yield* k.client.invoke(input, env);
      const payload = failurePayload(
        { httpStatus: 503 },
        {
          stage: "provider.invoke",
          defaultDomain: "provider",
          source: { component: "octo-runtime", adapter: "codex" }
        }
      );
      payload.failure.retryAfterMs = 0;
      yield event("run.failed", payload);
    }
  });
  f.send();
  await f.done();
  assert.match(f.replies[0].text, /本次重试未提交/);
  assert.equal(f.calls.length, 2);
  assert.deepEqual(f.cancellations, []);
  assert.deepEqual(
    f.saved.at(-1).attempts.map((a) => a.outcome),
    ["run.failed", "not_submitted"]
  );
  assert.equal(f.saved.at(-1).notSubmittedFailure, undefined);
});

test("Gateway: error card failure cannot suppress text; secondary log retains root diagnosis", async (t) => {
  const f = await fixture(t, "gateway");
  f.send({
    beginPresentation() {
      throw Error("init");
    },
    replyFailure: async () => {
      throw Error("card unavailable");
    }
  });
  await f.done();
  assert.match(f.replies[0].text, /OH-RUN-2011/);
  const root = f.logs.find(([, , data]) => data?.code === "OH-RUN-2011")[2];
  const secondary = f.logs.find(([, , data]) => data?.primary_code === "OH-RUN-2011")[2];
  assert.equal(secondary.diagnostic_id, root.diagnostic_id);
  assert.equal(f.calls.length, 0);
});

test("Gateway: channel failure reaches the real worker log with the card diagnosis", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "octo-channel-failure-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const statuses = [];
  const logging = new RuntimeLogging({
    directory,
    statusOutput: (record) => statuses.push(record)
  });
  const f = await fixture(t, "gateway", { log: logging.extra("channel-gateway") });
  t.after(() => logging.close());
  f.send({
    beginPresentation() {
      throw Error("PRIVATE_ERROR_BODY");
    }
  });
  await f.done();
  await logging.close();
  const names = await readdir(join(directory, "extras"));
  const content = (
    await Promise.all(names.map((name) => readFile(join(directory, "extras", name), "utf8")))
  ).join("");
  const rows = content
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const root = rows.find((row) => row.data?.code === "OH-RUN-2011");
  const failure = f.failures[0].payload.failure;
  assert.equal(root.data.diagnostic_id, failure.diagnosticId);
  assert.equal(root.data.reason_code, failure.reasonCode);
  assert.equal(root.data.stage, failure.stage);
  assert.equal(root.data.failure_component, failure.source.component);
  assert.equal(root.data.occurred_at, failure.occurredAt);
  assert.equal(root.source, "extra");
  assert.match(f.replies[0].text, new RegExp(failure.diagnosticId));
  assert.doesNotMatch(JSON.stringify(statuses), /diagnostic_id|run_id|session_id|OH-RUN-2011/);
  assert.doesNotMatch(content, /PRIVATE_ERROR_BODY/);
});

test("Gateway: stalled finish releases the scheduler but keeps shutdown incomplete", async (t) => {
  const f = await fixture(t, "gateway", { expectedCloseFailure: true });
  withShutdownDeadline(performance.now() + 50, () =>
    f.send({
      beginPresentation() {
        return { update() {}, finish: () => new Promise(() => {}) };
      }
    })
  );
  await f.done();
  assert.equal(f.replies[0].text, "answer");
  const closing = f.runtime.close();
  await assert.rejects(closing, /IM_DISPOSE_FAILED/);
  assert.equal(f.runtime.close(), closing);
  await assert.rejects(f.runtime.close(), /IM_DISPOSE_FAILED/);
});

test("Gateway: a stalled error card has a bounded wait and does not hold the next message", async (t) => {
  const f = await fixture(t, "gateway");
  withShutdownDeadline(performance.now() + 50, () =>
    f.send({
      beginPresentation() {
        throw Error("init");
      },
      replyFailure: () => new Promise(() => {})
    })
  );
  await f.done();
  assert.match(f.replies[0].text, /OH-RUN-2011/);
  assert.equal(f.calls.length, 0);
  assert.deepEqual(f.cancellations, []);
  assert.ok(
    f.logs.some(
      ([, , data]) => data?.primary_code === "OH-RUN-2011" && data.code === "IM_DELIVERY_UNKNOWN"
    )
  );
  f.send();
  await until(() => f.calls.length === 1 && f.runtime.status.sessions.length === 0);
  assert.equal(f.replies.at(-1).text, "answer");
});

test("Gateway: both feedback sends failing neither recurse nor invoke", async (t) => {
  const f = await fixture(t, "gateway");
  let attempts = 0;
  const reject = async () => {
    attempts++;
    throw Error("PRIVATE_DELIVERY_ERROR");
  };
  f.send({
    beginPresentation() {
      throw Error("init");
    },
    reply: reject,
    replyFailure: reject
  });
  await until(() => attempts === 2 && f.runtime.status.sessions.length === 0);
  assert.equal(f.calls.length, 0);
  assert.deepEqual(f.cancellations, []);
  assert.equal(f.logs.filter(([, , data]) => data?.primary_code === "OH-RUN-2011").length, 2);
  assert.doesNotMatch(JSON.stringify(f.logs), /PRIVATE_DELIVERY_ERROR/);
});

test("Kernel: admission proof survives real pre-write race and rejects reconstructed errors", async (t) => {
  const k = await kernelFixture(t, { manifest: resolve("test/fixtures/invoke-adapters.json") });
  const { kernelRelay } = await import("./kernel-relay.js");
  let relay;
  relay = await kernelRelay(t, k, {
    response(value, connection) {
      if (connection.request?.method === "status") relay.client.invocations.stopAdmission();
      return value;
    }
  });
  await assert.rejects(
    async () => {
      for await (const frame of relay.client.invoke(kernelInput())) void frame;
    },
    (error) => {
      assert.equal(isInvocationNotSubmitted(error), true);
      assert.equal(isInvocationNotSubmitted(new KernelError(error.code, {})), false);
      assert.equal(isInvocationNotSubmitted(new Error("wrapped", { cause: error })), false);
      assert.equal(isInvocationNotSubmitted({ code: error.code }), false);
      return true;
    }
  );
  assert.equal(relay.count("agent_run.invoke"), 0);
  assert.deepEqual(relay.client.invocations.snapshot(), []);
});
