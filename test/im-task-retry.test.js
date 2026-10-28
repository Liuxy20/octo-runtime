import test from "node:test";
import assert from "node:assert/strict";
import { ImTask } from "../packages/octo-runtime-extra-channel-gateway/dist/execution/task.js";
import { createImInvocation } from "../packages/octo-runtime-extra-channel-gateway/dist/execution/dispatcher.js";
import { validateImConfig } from "../packages/octo-runtime-extra-channel-gateway/dist/index.js";
import {
  assertInvokeInput,
  failurePayload,
  invocationInput
} from "@mininglamp-oss/octo-runtime-protocol";
import { prepareInvokeInput } from "@mininglamp-oss/octo-runtime-executor-core";
import { InvocationWatchdog } from "../packages/octo-runtime-executor-core/dist/watchdog.js";
import { ImModelWait } from "../packages/octo-runtime-extra-channel-gateway/dist/execution/model-wait.js";
import {
  KernelError,
  attachKernel,
  isInvocationNotSubmitted
} from "@mininglamp-oss/octo-runtime-executor-kernel";

const config = {
  bot_id: "retry-fixture",
  api_url: "https://im-test.deepminer.com.cn/api",
  adapter: { adapter_type: "codex", workdir: process.cwd() }
};
const event = (type, payload = {}) => ({ protocolVersion: 2, type, payload });
const failed = (status = 503) =>
  event(
    "run.failed",
    failurePayload(
      { httpStatus: status, message: `provider HTTP ${status}` },
      {
        stage: "provider.invoke",
        defaultDomain: "provider",
        source: { component: "octo-runtime", adapter: "codex" }
      }
    )
  );
const notice = () =>
  event("run.notice", {
    noticeId: "retry",
    code: "retry_scheduled",
    severity: "warning",
    params: { attempt: 1 }
  });
const progress = () => event("message.delta", { messageId: "m", channel: "final", text: "work" });

function fixture(invoke, options = {}) {
  let now = 0,
    sequence = 0;
  const timers = new Map(),
    calls = [],
    cancellations = [],
    waits = [];
  const time = {
    now: () => now,
    schedule(fn, ms) {
      const id = ++sequence;
      timers.set(id, { fn, at: now + ms });
      return () => timers.delete(id);
    },
    async wait(ms, signal) {
      signal.throwIfAborted();
      waits.push(ms);
      if (options.wait) await options.wait(ms, signal);
      else time.tick(ms);
      signal.throwIfAborted();
    },
    random: () => 0,
    tick(ms) {
      const end = now + ms;
      for (;;) {
        const first = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!first || first[1].at > end) break;
        now = first[1].at;
        timers.delete(first[0]);
        first[1].fn();
      }
      now = end;
    }
  };
  const bot = { ...config, ...options.config };
  const request = createImInvocation(
    bot,
    { messageId: "msg", senderId: "owner", conversationId: "chat", text: "long task" },
    options.context ?? { schema: "octo.context-envelope/v3", items: [] },
    "key",
    { id: "session", generation: 1 },
    options.signal ?? new AbortController().signal
  ).request;
  const host = {
    async *invoke(input, environment) {
      assertInvokeInput(input);
      const prepared = prepareInvokeInput(input).request;
      calls.push(prepared);
      yield* invoke({ time, calls, request: prepared, signal: environment.signal });
    },
    async cancelInvocation(id) {
      cancellations.push(id);
      if (options.cancel) return options.cancel(id);
      return { accepted: true };
    }
  };
  const task = new ImTask(
    host,
    request,
    options.adapter ?? "codex",
    bot,
    { signal: options.signal },
    () => {},
    time
  );
  const collect = async () => {
    const events = [];
    for await (const e of task.events()) events.push(e);
    return events;
  };
  return {
    task,
    time,
    timers,
    calls,
    cancellations,
    waits,
    collect,
    request: prepareInvokeInput(request).request
  };
}

test("trusted local rejection stops retries and remains safe under later drain and deadline", async () => {
  const client = attachKernel({
    endpoint:
      process.platform === "win32"
        ? "\\\\.\\pipe\\octo-not-submitted-unused"
        : "/unused-octo-not-submitted.sock"
  });
  client.invocations.stopAdmission();
  const f = fixture(async function* ({ request }) {
    yield* client.invoke(invocationInput(request, "canonical", "codex"));
  });
  try {
    await assert.rejects(f.collect(), isInvocationNotSubmitted);
    assert.equal(f.task.attempts[0].outcome, "not_submitted");
    assert.equal(f.task.attempts[0].failureCode, "OH-RUN-2012");
    assert.equal(f.task.attempts[0].diagnosticId, f.task.notSubmittedFailure.diagnosticId);
    f.time.tick(86_400_000);
    await f.task.drain();
    assert.equal(await f.task.cancel(), true);
    assert.deepEqual(f.cancellations, []);
    assert.equal(f.calls.length, 1);
    assert.equal(f.timers.size, 0);
  } finally {
    client.close();
  }
});

test("an exhausted stream without a terminal records unknown rather than running", async () => {
  const f = fixture(async function* () {});
  await assert.rejects(f.collect(), /IM_RUN_WITHOUT_TERMINAL/);
  assert.equal(f.task.attempts[0].outcome, "unknown");
  assert.equal(f.task.notSubmittedFailure, undefined);
  assert.equal(f.calls.length, 1);
});

test("IM defaults to one day, accepts explicit long and short limits, validates retry options", () => {
  const f = fixture(async function* () {});
  assert.equal(f.request.runtimeLimits.runTimeoutMs, 86_400_000);
  assert.equal(f.request.runtimeLimits.toolTimeoutMs, 86_400_000);
  assert.equal(f.request.runtimeLimits.firstFrameTimeoutMs, 310_000);
  assert.equal(f.request.runtimeLimits.modelIdlePolicy, "observe");
  for (const ms of [100, 60_000, 86_400_000]) {
    validateImConfig({ ...config, run_timeout_ms: ms });
    assert.equal(
      fixture(async function* () {}, { config: { run_timeout_ms: ms } }).request.runtimeLimits
        .runTimeoutMs,
      ms
    );
  }
  for (const ms of [0, 1, 99, 86_400_001, NaN])
    assert.throws(() => validateImConfig({ ...config, run_timeout_ms: ms }));
  for (const retry of [
    null,
    [],
    { enabled: "yes" },
    { max_total_retries: 101 },
    { recovery_timeout_ms: 0 },
    { initial_delay_ms: 40000, max_delay_ms: 1000 }
  ])
    assert.throws(
      () => validateImConfig({ ...config, codex_retry: retry }),
      /IM_RETRY_CONFIG_INVALID/
    );
});

test("IM limits allow a quiet 15-minute tool and preserve explicit watchdog overrides", () => {
  const f = fixture(async function* () {});
  const controller = new AbortController();
  const watchdog = new InvocationWatchdog(f.request.runtimeLimits, controller, () => {}, f.time);
  watchdog.canonical(event("tool_call.create", { toolCallId: "long-tool" }));
  f.time.tick(15 * 60_000);
  assert.equal(controller.signal.aborted, false);
  watchdog.canonical(event("tool_call.update", { toolCallId: "long-tool", status: "completed" }));
  watchdog.canonical(event("run.completed"));
  watchdog.finish();
  assert.equal(f.timers.size, 0);

  const explicit = fixture(async function* () {}, {
    context: {
      schema: "octo.context-envelope/v3",
      items: [
        {
          namespace: "octo.execution",
          name: "limits",
          payload: {
            run_timeout_ms: 60_000,
            tool_timeout_ms: 10_000,
            first_frame_timeout_ms: 20_000,
            model_idle_policy: "enforce"
          }
        }
      ]
    }
  });
  assert.equal(explicit.request.runtimeLimits.runTimeoutMs, 60_000);
  assert.equal(explicit.request.runtimeLimits.toolTimeoutMs, 10_000);
  assert.equal(explicit.request.runtimeLimits.firstFrameTimeoutMs, 20_000);
  assert.equal(explicit.request.runtimeLimits.modelIdlePolicy, "enforce");
});

test("active tools pass 120 seconds and ten minutes; one day still cancels", async () => {
  const f = fixture(async function* ({ time, signal }) {
    yield event("tool_call.create", { id: "long-tool", name: "exec", args: {}, status: "running" });
    time.tick(900_000);
    assert.equal(signal.aborted, false);
    yield progress();
    time.tick(86_400_000 - 900_000);
    assert.equal(signal.aborted, true);
    yield event("run.cancelled");
  });
  const result = await f.collect();
  assert.equal(result.at(-1).payload.code, "IM_TASK_DEADLINE");
  assert.equal(f.cancellations.length, 1);
  assert.equal(f.timers.size, 0);
});

for (const kind of ["executing_tool", "waiting_approval", "waiting_input"]) {
  test(`IM and Core exclude activity-only ${kind}, then allow a fresh model wait`, () => {
    const f = fixture(async function* () {});
    const controller = new AbortController();
    const watchdog = new InvocationWatchdog(f.request.runtimeLimits, controller, () => {}, f.time);
    let timeouts = 0;
    const waiting = new ImModelWait(
      f.time,
      () => {},
      () => timeouts++
    );
    waiting.start();
    const started = event("activity.started", {
      activityId: "blocking",
      kind,
      subject: { type: kind === "executing_tool" ? "tool" : "interaction", id: "subject" }
    });
    watchdog.canonical(started);
    waiting.accept(started);
    f.time.tick(900_000);
    assert.equal(controller.signal.aborted, false);
    assert.equal(timeouts, 0);
    const finished = event("activity.finished", { activityId: "blocking" });
    watchdog.canonical(finished);
    waiting.accept(finished);
    f.time.tick(299_999);
    assert.equal(controller.signal.aborted, false);
    assert.equal(timeouts, 0);
    f.time.tick(1);
    assert.equal(timeouts, 1);
    assert.equal(controller.signal.aborted, false);
    waiting.stop();
    watchdog.finish();
    assert.equal(f.timers.size, 0);
  });
}

test("temporary Codex failure retries with frozen context, new identities and remaining deadline", async () => {
  const context = {
    schema: "octo.context-envelope/v3",
    items: [{ namespace: "extra.retry-fixture", name: "background", payload: { text: "frozen" } }]
  };
  const f = fixture(
    async function* ({ calls, time }) {
      time.tick(1_000);
      yield calls.length === 1 ? failed() : event("run.completed");
    },
    { context }
  );
  const events = await f.collect();
  assert.equal(f.calls.length, 2);
  assert.notEqual(f.calls[0].runId, f.calls[1].runId);
  assert.notEqual(f.calls[0].invocationId, f.calls[1].invocationId);
  assert.equal(f.calls[0].agentSessionId, f.calls[1].agentSessionId);
  assert.equal(f.calls[1].runtimeLimits.runTimeoutMs, 86_400_000 - 31_000);
  assert.equal(f.calls[1].runMetadata.eventId, f.calls[0].runMetadata.eventId);
  assert.equal(f.calls[1].runMetadata.triggerOccurrenceId, "msg");
  assert.deepEqual(
    f.calls[1].context.items.filter((i) => i.namespace === "extra.retry-fixture"),
    f.calls[0].context.items.filter((i) => i.namespace === "extra.retry-fixture")
  );
  assert.deepEqual(f.waits, [30_000]);
  assert.equal(events.filter((e) => e.type === "run.failed").length, 0);
  assert.equal(events.at(-1).type, "run.completed");
  assert.equal(f.timers.size, 0);
});

test("Provider retry notice keeps the same invoke and does not renew recovery time", async () => {
  const f = fixture(
    async function* ({ time, signal }) {
      yield notice();
      time.tick(1000);
      yield event("usage.update", {});
      time.tick(1000);
      yield notice();
      time.tick(1000);
      assert.equal(signal.aborted, true);
      yield event("run.cancelled");
    },
    { config: { codex_retry: { recovery_timeout_ms: 3000 } } }
  );
  assert.equal((await f.collect()).at(-1).payload.code, "IM_RETRY_RECOVERY_TIMEOUT");
  assert.equal(f.calls.length, 1);
});

test("per-episode and total retry caps include native notices", async () => {
  for (const progressBetween of [false, true]) {
    const f = fixture(
      async function* ({ signal }) {
        for (let i = 0; i < 6 && !signal.aborted; i++) {
          yield notice();
          if (progressBetween) yield progress();
        }
        yield event("run.cancelled");
      },
      { config: { codex_retry: { max_consecutive_retries: 2, max_total_retries: 3 } } }
    );
    const result = await f.collect();
    assert.equal(result.at(-1).payload.code, "IM_RETRY_LIMIT_EXCEEDED");
    assert.equal(result.filter((e) => e.type === "run.notice").length, progressBetween ? 4 : 3);
    assert.equal(f.calls.length, 1);
  }
});

test("failed invocations stop at retry caps instead of resetting the task budget", async () => {
  const f = fixture(
    async function* () {
      yield failed();
    },
    { config: { codex_retry: { max_consecutive_retries: 2, recovery_timeout_ms: 120000 } } }
  );
  assert.equal((await f.collect()).at(-1).type, "run.failed");
  assert.equal(f.calls.length, 3, "initial attempt plus two retries");
  assert.equal(f.task.stopReason, "IM_RETRY_LIMIT_EXCEEDED");
});

test("retry policy excludes credentials, unknown failure, cancellation and unsafe replays", async () => {
  for (const prefix of [
    event("tool_call.create", { id: "tool", name: "shell" }),
    event("interaction.requested", { interactionId: "approval" })
  ]) {
    const f = fixture(async function* () {
      yield prefix;
      yield failed();
    });
    await f.collect();
    assert.equal(f.calls.length, 1);
  }
  for (const terminal of [
    failed(401),
    failed(403),
    failed(400),
    event("run.failed"),
    event("run.cancelled")
  ]) {
    const f = fixture(async function* () {
      yield terminal;
    });
    await f.collect();
    assert.equal(f.calls.length, 1);
  }
  for (const options of [
    { adapter: "claude-code" },
    { config: { codex_retry: { enabled: false } } }
  ]) {
    const f = fixture(async function* () {
      yield failed();
    }, options);
    await f.collect();
    assert.equal(f.calls.length, 1);
  }
});

test("display cancellation preserves observation and suppresses transient-failure retries", async () => {
  let observer;
  const f = fixture(async function* ({ signal }) {
    observer = signal;
    yield progress();
    yield failed();
    signal.throwIfAborted();
  });
  const iterator = f.task.events();
  await iterator.next();
  assert.deepEqual(
    await Promise.all([
      f.task.cancelExecution("display failed"),
      f.task.cancelExecution("display failed again")
    ]),
    [true, true]
  );
  assert.equal(observer.aborted, false);
  assert.equal((await iterator.next()).value.type, "run.failed");
  assert.equal((await iterator.next()).done, true);
  assert.equal(f.task.attempts[0].outcome, "run.failed");
  assert.equal(f.calls.length, 1);
  assert.equal(f.cancellations.length, 1);
  assert.deepEqual(f.waits, []);
  assert.equal(f.timers.size, 0);
});

test("unknown stream result never causes another invocation", async () => {
  const f = fixture(async function* () {
    yield progress();
    throw new Error("stream lost");
  });
  await assert.rejects(f.collect(), /stream lost/);
  assert.equal(f.calls.length, 1);
  assert.equal(f.timers.size, 0);
});

for (const outcome of [
  "completed",
  "failed",
  "cancelled",
  "missing",
  "lost",
  "after-terminal",
  "abandoned",
  "cancel-unknown",
  "untyped-error"
]) {
  test(`IM drain reconciles missing registration only with a fully consumed terminal: ${outcome}`, async () => {
    const cancellation =
      outcome === "untyped-error"
        ? new Error("INVOCATION_NOT_TRACKED")
        : new KernelError(
            outcome === "cancel-unknown" ? "OPERATION_OUTCOME_UNKNOWN" : "INVOCATION_NOT_TRACKED"
          );
    const f = fixture(
      async function* () {
        yield progress();
        if (outcome === "lost") throw new KernelError("RUN_OUTCOME_UNKNOWN");
        if (outcome === "missing") return;
        yield event(`run.${["failed", "cancelled"].includes(outcome) ? outcome : "completed"}`);
        if (outcome === "after-terminal") throw new KernelError("STREAM_GAP");
      },
      {
        cancel: async () => {
          throw cancellation;
        }
      }
    );
    const iterator = f.task.events();
    await iterator.next();
    let settled = false;
    const draining = f.task.drain().finally(() => {
      settled = true;
    });
    const result = Promise.allSettled([draining]);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, ["cancel-unknown", "untyped-error"].includes(outcome));
    if (outcome === "abandoned") await iterator.return();
    else if (["missing", "lost", "after-terminal"].includes(outcome)) {
      await assert.rejects(
        iterator.next(),
        new RegExp(
          {
            missing: "IM_RUN_WITHOUT_TERMINAL",
            lost: "RUN_OUTCOME_UNKNOWN",
            "after-terminal": "STREAM_GAP"
          }[outcome]
        )
      );
    } else {
      assert.equal(
        (await iterator.next()).value.type,
        `run.${["failed", "cancelled"].includes(outcome) ? outcome : "completed"}`
      );
      assert.equal((await iterator.next()).done, true);
    }
    const [actual] = await result;
    if (["completed", "failed", "cancelled"].includes(outcome))
      assert.equal(actual.status, "fulfilled");
    else {
      assert.equal(actual.status, "rejected");
      assert.equal(actual.reason, cancellation);
    }
    assert.equal(f.calls.length, 1);
    assert.equal(f.cancellations.length, 1);
    assert.equal(f.timers.size, 0);
  });
}

test("retry-after exceeding recovery or total budget is not shortened", async () => {
  const f = fixture(
    async function* () {
      yield failed(429);
    },
    { config: { run_timeout_ms: 15000 } }
  );
  await f.collect();
  assert.equal(f.calls.length, 1);
  assert.equal(f.task.stopReason, "IM_RETRY_WAIT_EXCEEDS_BUDGET");
  assert.deepEqual(f.waits, []);
});

test("cancel and reset stop backoff promptly without starting a new attempt", async () => {
  for (const reset of [true, false]) {
    let waiting;
    const gate = new Promise((resolve) => {
      waiting = resolve;
    });
    const f = fixture(
      async function* () {
        yield failed();
      },
      {
        wait: async (_ms, signal) => {
          waiting();
          await new Promise((resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          });
        }
      }
    );
    const collecting = f.collect();
    await gate;
    if (reset) f.task.stopRetries();
    else assert.equal(await f.task.cancel(), true);
    assert.equal((await collecting).at(-1).type, reset ? "run.failed" : "run.cancelled");
    assert.equal(f.calls.length, 1);
    assert.equal(f.timers.size, 0);
  }
});
