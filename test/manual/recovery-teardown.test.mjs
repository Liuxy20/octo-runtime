// 显式手动专项：pnpm build 后 node --test test/manual/recovery-teardown.test.mjs。
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  cleanupRecovery,
  finishRecovery,
  trackRecoveryChild
} from "../../test-support/recovery-cleanup.mjs";
import { terminateFixtureProcess } from "../../test-support/fixture-process.mjs";
import { withTimeout } from "../runtime-fixture.js";

const success = { failed: false };
const closed = { complete: true, errors: [] };
function fakeChild(component, kill) {
  const child = new EventEmitter();
  Object.assign(child, { pid: 12345, exitCode: null, signalCode: null, kill });
  return trackRecoveryChild(child, component);
}
function exit(entry, signal = "SIGTERM") {
  entry.child.signalCode = signal;
  entry.child.emit("exit", null, signal);
  entry.child.emit("close", null, signal);
}
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

test("every close stage runs and incomplete service details survive", async () => {
  for (const extraResult of [
    "sync-throw",
    new Error("EXTRA_REJECTED"),
    { complete: false, errors: [{ code: "PENDING_RUN" }], pendingResources: ["runs"] }
  ]) {
    const calls = [];
    const child = fakeChild("owned-child", () => {
      setImmediate(() => {
        calls.push("child-exit");
        exit(child);
      });
      return true;
    });
    const result = await cleanupRecovery({
      children: [child],
      client: {
        close() {
          calls.push("client");
          throw new Error("CLIENT_THROW");
        }
      },
      services: [
        {
          component: "channel-gateway",
          close() {
            calls.push("extra");
            if (extraResult === "sync-throw") throw new Error("EXTRA_REJECTED");
            if (extraResult instanceof Error) return Promise.reject(extraResult);
            return extraResult;
          }
        },
        {
          component: "executor-kernel",
          async close() {
            await delay(5);
            calls.push("kernel");
            return closed;
          }
        }
      ]
    });
    assert.deepEqual(calls, ["client", "extra", "kernel", "child-exit"]);
    assert.equal(result.complete, false);
    assert.equal(result.errors.length, 2);
    if (extraResult instanceof Error) assert.equal(result.errors[1].cause, extraResult);
    else if (extraResult !== "sync-throw") assert.equal(result.errors[1].cause.cause, extraResult);
    const diagnostics = [];
    assert.throws(
      () => finishRecovery(success, result, (row) => diagnostics.push(row)),
      AggregateError
    );
    assert.match(diagnostics.join("\n"), /EXTRA_REJECTED|PENDING_RUN/);
  }
});

test("signal failure and forced exit timeout cannot skip the remaining child", async () => {
  for (const signalFailure of ["throw", "false"]) {
    const signals = [];
    const kernel = fakeChild("executor-kernel", (signal) => {
      signals.push(`kernel:${signal}`);
      setImmediate(() => exit(kernel));
      return true;
    });
    const gateway = fakeChild("channel-gateway", (signal) => {
      signals.push(`gateway:${signal}`);
      if (signalFailure === "throw") throw new Error("SIGNAL_DENIED");
      return false;
    });
    const children = [kernel, gateway];
    const result = await cleanupRecovery({ children, gracefulMs: 10, forceMs: 10 });
    assert.deepEqual(signals, ["gateway:SIGTERM", "gateway:SIGKILL", "kernel:SIGTERM"]);
    assert.equal(children[0], kernel);
    assert.equal(kernel.exitObserved, true);
    assert.equal(result.complete, false);
    const diagnostics = [];
    const original = new Error("ORIGINAL_FAILURE");
    assert.throws(
      () =>
        finishRecovery({ failed: true, error: original }, result, (row) => diagnostics.push(row)),
      (error) => {
        assert.equal(error.cause, original);
        assert.equal(error.errors[0], original);
        return true;
      }
    );
    assert.match(diagnostics.join("\n"), /ORIGINAL_FAILURE/);
    assert.match(diagnostics.join("\n"), /FIXTURE_SHUTDOWN_TIMEOUT/);
    assert.match(diagnostics.join("\n"), /FIXTURE_FORCE_SHUTDOWN_TIMEOUT/);
  }
});

test("successful force kill retains graceful timeout and awaits the next child", async () => {
  const signals = [];
  const kernel = fakeChild("executor-kernel", (signal) => {
    signals.push(`kernel:${signal}`);
    setImmediate(() => exit(kernel));
    return true;
  });
  const gateway = fakeChild("channel-gateway", (signal) => {
    signals.push(`gateway:${signal}`);
    if (signal === "SIGKILL") setImmediate(() => exit(gateway, signal));
    return true;
  });
  const result = await cleanupRecovery({ children: [kernel, gateway], gracefulMs: 10 });
  assert.equal(result.complete, true);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].cause.message, "FIXTURE_SHUTDOWN_TIMEOUT");
  assert.deepEqual(signals, ["gateway:SIGTERM", "gateway:SIGKILL", "kernel:SIGTERM"]);
  assert.equal(kernel.exitObserved, true);
});

test("already exited and failed spawn are observed without unnecessary signals", async () => {
  const entry = fakeChild("exited", () => {
    throw new Error("unexpected signal");
  });
  exit(entry);
  assert.deepEqual(await cleanupRecovery({ children: [entry] }), { complete: true, errors: [] });
  const failed = fakeChild("missing", entry.child.kill);
  failed.child.pid = undefined;
  const cause = Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
  failed.child.emit("error", cause);
  await delay(10);
  const result = await cleanupRecovery({ children: [failed] });
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].cause, cause);
});

test("native close request timeout still forces exit and visits the dependency", async () => {
  const kernel = fakeChild("executor-kernel", () => {
    exit(kernel);
    return true;
  });
  const gateway = fakeChild("channel-gateway", () => {
    exit(gateway, "SIGKILL");
    return true;
  });
  gateway.requestClose = () => new Promise(() => {});
  const result = await cleanupRecovery({ children: [kernel, gateway], gracefulMs: 10 });
  assert.equal(result.complete, true);
  assert.ok(result.errors.some((error) => error.cause.message === "FIXTURE_CLOSE_REQUEST_TIMEOUT"));
  assert.equal(kernel.exitObserved, true);
});

test("process exit without pipe closure is incomplete and cannot skip the dependency", async () => {
  const kernel = fakeChild("executor-kernel", () => {
    exit(kernel);
    return true;
  });
  const gateway = fakeChild("channel-gateway", () => {
    gateway.child.signalCode = "SIGTERM";
    gateway.child.emit("exit", null, "SIGTERM");
    return true;
  });
  const result = await cleanupRecovery({ children: [kernel, gateway], gracefulMs: 10 });
  assert.equal(result.complete, false);
  assert.equal(gateway.exitObserved, true);
  assert.equal(gateway.closeObserved, false);
  assert.equal(kernel.closeObserved, true);
});

test("body-only failures preserve identity including falsy thrown values", () => {
  finishRecovery(success, { errors: [] });
  for (const original of [new Error("BODY_ONLY"), undefined, null, false, 0, ""]) {
    let caught = false;
    try {
      finishRecovery({ failed: true, error: original }, { errors: [] });
    } catch (error) {
      caught = true;
      assert.equal(error, original);
    }
    assert.equal(caught, true);
  }
});

for (const { mode, action, bodyFailure = false } of [
  { mode: "cli", action: "pause" },
  { mode: "cli", action: "pause", bodyFailure: true },
  { mode: "cli", action: "normal" },
  { mode: "cli", action: "kill" },
  { mode: "sdk", action: "normal" }
]) {
  test(
    `Gateway ${mode}/${action} preserves independent Kernel and reaps environment (body failure=${bodyFailure})`,
    { skip: process.platform === "win32", timeout: 100000 },
    async (t) => {
      const directory = await mkdtemp(join(tmpdir(), "recovery-teardown-"));
      // 外层 node:test 的内部标记不可传给独立运行器，否则 Node 会跳过嵌套测试发现。
      const runnerEnv = { ...process.env };
      delete runnerEnv.NODE_TEST_CONTEXT;
      const runner = spawn(
        process.execPath,
        [
          "--test",
          "--test-reporter=tap",
          `--test-name-pattern=^${mode}:`,
          "test/recovery-dual-mode.test.js"
        ],
        {
          cwd: resolve("."),
          env: {
            ...runnerEnv,
            OCTO_RECOVERY_OUTAGE: "0",
            OCTO_RECOVERY_TEARDOWN_PROBE: directory,
            OCTO_RECOVERY_GATEWAY_STOP: action,
            OCTO_RECOVERY_TEARDOWN_BODY_FAILURE: bodyFailure ? "1" : "0"
          },
          stdio: ["ignore", "pipe", "pipe"]
        }
      );
      let output = "";
      runner.stdout.on("data", (chunk) => {
        output += chunk;
      });
      runner.stderr.on("data", (chunk) => {
        output += chunk;
      });
      const exited = new Promise((resolve, reject) => {
        runner.once("close", resolve);
        runner.once("error", reject);
      });
      exited.catch(() => {});
      let state;
      const failure = { failed: false, error: undefined };
      try {
        const code = await withTimeout(exited, 90000, "OUTER_RUNNER_TIMEOUT");
        assert.equal(code, action === "pause" ? 1 : 0, output);
        if (action === "pause") assert.match(output, /FIXTURE_SHUTDOWN_TIMEOUT/);
        if (bodyFailure) assert.match(output, /FIXTURE_ORIGINAL_BODY_FAILURE/);
        state = JSON.parse(await readFile(join(directory, "state.json"), "utf8"));
        const events = (await readFile(join(directory, "events.jsonl"), "utf8"))
          .trim()
          .split("\n")
          .map((row) => JSON.parse(row));
        const index = (component, stage, event) =>
          events.findIndex(
            (row) => row.component === component && row.stage === stage && row.event === event
          );
        const term = index("channel-gateway", "SIGTERM", "attempt");
        const kill = index("channel-gateway", "SIGKILL", "attempt");
        const gatewayExit = index("channel-gateway", "forced-exit", "done");
        const kernelTerm = index("executor-kernel", "native-close", "attempt");
        if (action === "pause") {
          assert.ok(
            term >= 0 && kill > term && gatewayExit > kill && kernelTerm > gatewayExit,
            JSON.stringify(events)
          );
          // 预算从关闭操作开始计时；磁盘事件记录晚于起点，不能用两条 wall clock 相减。
          // Node 对小数毫秒 timer 截断，允许不足 1 ms 的调度精度差，不缩短 7000 ms 预算。
          assert.equal(events[term].gracefulUntil, events[term].gracefulStartedAt + 7000);
          assert.ok(events[kill].monotonicAt + 1 >= events[term].gracefulUntil);
          assert.equal(events[kill].kernelAlive, true);
          assert.ok(events.some((row) => row.event === "paused" && row.rpcSucceeded));
        }
        const independent = events.findIndex((row) => row.event === "kernel-independent");
        assert.ok(independent >= 0 && independent < kernelTerm, JSON.stringify(events));
        assert.equal(events[independent].unrelatedCompleted, true);
        assert.equal(events[independent].freshCompleted, true);
        assert.ok(index("executor-kernel", "graceful-exit", "done") > kernelTerm);
        assert.deepEqual(state.workers, [], "native Kernel starts no execution workers");
        for (const pid of [...state.children.map((row) => row.pid), ...state.workers])
          assert.equal(alive(pid), false, `leaked pid ${pid}`);
        assert.equal(alive(state.testPid), false, "test-file runner must also exit");
        t.diagnostic(
          JSON.stringify({
            bodyFailure,
            mode,
            action,
            pids: state,
            gatewayGracefulMs: action === "pause" ? events[kill].at - events[term].at : undefined,
            independent: events[independent],
            allExited: true
          })
        );
      } catch (error) {
        failure.failed = true;
        failure.error = error;
      } finally {
        // 兜底只操作本次握手登记的 PID；主断言在兜底之前，不能借兜底伪造成功。
        const errors = [];
        const attempt = async (operation) => {
          try {
            await operation();
          } catch (error) {
            errors.push(error);
          }
        };
        await attempt(async () => {
          state ??= await readFile(join(directory, "state.json"), "utf8").then(
            JSON.parse,
            (error) => {
              if (error.code === "ENOENT") return undefined;
              throw error;
            }
          );
        });
        for (const pid of [
          ...(state?.children ?? []).map((row) => row.pid),
          ...(state?.workers ?? []),
          state?.testPid,
          runner.pid
        ]) {
          await attempt(async () => {
            if (!pid || !alive(pid)) return;
            await terminateFixtureProcess(pid);
            errors.push(new Error(`Unexpected fallback required for pid ${pid}`));
          });
        }
        await attempt(() => withTimeout(exited, 3000, "OUTER_RUNNER_EXIT_TIMEOUT"));
        if (!errors.length) {
          if (state?.home) await attempt(() => rm(state.home, { recursive: true, force: true }));
          await attempt(() => rm(directory, { recursive: true, force: true }));
        }
        if (errors.length) t.diagnostic(`Fallback errors; retained evidence: ${directory}`);
        finishRecovery(failure, { errors }, (message) => t.diagnostic(message));
      }
    }
  );
}
