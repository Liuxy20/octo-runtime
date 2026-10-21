import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { Server } from "node:net";
import { createKernelService, spawnWorker } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { componentEndpoint } from "@mininglamp-oss/octo-runtime-host-sdk";
import { invocationInput } from "@mininglamp-oss/octo-runtime-protocol";
import { invokeRequest, waitFor } from "./runtime-fixture.js";
import { WorkerSupervisor } from "../packages/octo-runtime-executor-kernel/dist/supervisor.js";

const windows = { skip: process.platform !== "win32", timeout: 15000 };
async function fixture(t, options = {}) {
  const home = await mkdtemp(join(tmpdir(), "host-close-"));
  const trace = join(home, "trace.jsonl");
  const entrypoint = join(home, "host.mjs");
  await writeFile(trace, "");
  await writeFile(
    entrypoint,
    `import { serveCloseFixture } from ${JSON.stringify(new URL("../test-support/fake-host-close.mjs", import.meta.url).href)}; await serveCloseFixture(${JSON.stringify({ ...options, trace })});`
  );
  const hosts = [];
  const cleanups = [];
  t.after(async () => {
    for (const host of hosts) await host.close();
    for (const cleanup of cleanups) await cleanup();
    // 只删除本次 mkdtemp 的目录，测试清理不计作产品资源回收证据。
    assert.equal(home.startsWith(join(tmpdir(), "host-close-")), true);
    await rm(home, { recursive: true, force: true });
  });
  return {
    home,
    trace,
    entrypoint,
    onCleanup(callback) {
      cleanups.push(callback);
    },
    async start() {
      const host = await spawnWorker({
        entrypoint,
        env: { ...process.env, OCTO_RUNTIME_LOGS_DIRECTORY: join(home, "logs") }
      });
      const mark = (event, data = {}) =>
        appendFileSync(
          trace,
          `${JSON.stringify({ event, pid: host.child.pid, time: Date.now(), ...data })}\n`
        );
      host.child.on("message", (message) => {
        if (message?.type === "worker.drained")
          mark("worker.drained", { cleanup: message.cleanup });
      });
      host.child.once("exit", (code, signal) => mark("host.reaped", { code, signal }));
      hosts.push(host);
      return host;
    },
    async events() {
      return (await readFile(trace, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse);
    },
    async logs() {
      const directory = join(home, "logs");
      const files = (await readdir(directory)).filter((name) => /^kernel-.*\.log$/.test(name));
      return (await Promise.all(files.map((name) => readFile(join(directory, name), "utf8"))))
        .join("\n")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(JSON.parse);
    }
  };
}
function input(id = "host-close") {
  return invocationInput(
    invokeRequest({
      prompt: "private-close-fixture",
      runId: id,
      invocationId: id,
      approvalMode: "full_access"
    }),
    "canonical",
    "test"
  );
}
async function invoke(host) {
  const events = [];
  for await (const event of host.client.invoke(input())) events.push(event);
  assert.equal(events.at(-1).type, "run.completed");
}
function stopped(pid) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    if (error.code === "ESRCH") return true;
    throw error;
  }
}

test(
  "Windows SDK close includes delayed successful tree cleanup in its budget",
  windows,
  async (t) => {
    const f = await fixture(t, { mode: "unresponsive" });
    const options = {
      endpoint: componentEndpoint(f.home),
      stateDirectory: join(f.home, "run"),
      workerEntrypoint: f.entrypoint
    };
    const kernel = createKernelService(options);
    await kernel.initialize();
    const pid = (await kernel.client.status()).worker.pid;
    const execFile = childProcess.execFile;
    const closeServer = Server.prototype.close;
    let pending;
    let cleanupStarted;
    let commandTimeout;
    f.onCleanup(async () => {
      await pending;
      childProcess.execFile = execFile;
      Server.prototype.close = closeServer;
      syncBuiltinESMExports();
      await kernel.close();
      if (!stopped(pid)) process.kill(pid, "SIGKILL");
      await waitFor(() => stopped(pid));
    });
    // 服务先关闭自己的 socket；这个耗时也必须从后续 worker 的预算扣除。
    Server.prototype.close = function (callback) {
      if (this.address() !== options.endpoint) return closeServer.call(this, callback);
      return closeServer.call(this, (error) => setTimeout(() => callback(error), 300));
    };
    // 实际服务和 worker；仅把 taskkill 建模为耗时 1.5 秒后成功终止本次 PID。
    childProcess.execFile = (...args) => {
      if (args[0] !== "taskkill" || args[1]?.[1] !== String(pid)) return execFile(...args);
      cleanupStarted = Date.now();
      commandTimeout = args[2].timeout;
      pending = new Promise((resolve) => {
        setTimeout(
          () => {
            if (commandTimeout < 1500) args.at(-1)(new Error("fixture taskkill timeout"));
            else {
              process.kill(pid, "SIGKILL");
              args.at(-1)(null);
            }
            resolve();
          },
          Math.min(1500, commandTimeout)
        );
      });
    };
    syncBuiltinESMExports();
    const started = Date.now();
    const result = await kernel.close();
    const elapsed = Date.now() - started;
    t.diagnostic(
      `delayed cleanup: start=${cleanupStarted - started} ms, timeout=${commandTimeout} ms, close=${elapsed} ms, workerStopped=${stopped(pid)}`
    );
    assert.ok(elapsed < 5000, `elapsed=${elapsed}`);
    assert.equal(result.complete, true, JSON.stringify(result));
    assert.equal(stopped(pid), true);
    assert.equal(existsSync(join(options.stateDirectory, "kernel-invocations.json")), false);
    const replacement = createKernelService(options);
    f.onCleanup(() => replacement.close());
    await replacement.initialize();
    assert.equal((await replacement.close()).complete, true);
  }
);

test(
  "Windows SDK tree cleanup timeout finishes within the remaining budget",
  windows,
  async (t) => {
    const f = await fixture(t, { mode: "unresponsive" });
    const stateDirectory = join(f.home, "run");
    const kernel = createKernelService({
      endpoint: componentEndpoint(f.home),
      stateDirectory,
      workerEntrypoint: f.entrypoint
    });
    await kernel.initialize();
    const pid = (await kernel.client.status()).worker.pid;
    const execFile = childProcess.execFile;
    let command;
    let commandFinished = false;
    f.onCleanup(async () => {
      childProcess.execFile = execFile;
      syncBuiltinESMExports();
      if (command && command.exitCode === null && command.signalCode === null)
        command.kill("SIGKILL");
      if (!stopped(pid)) process.kill(pid, "SIGKILL");
      await waitFor(() => stopped(pid));
      await kernel.close();
    });
    // 用真实不退出的子进程替代本次 taskkill，验证 execFile 的实际超时与命令回收。
    childProcess.execFile = (...args) => {
      if (args[0] !== "taskkill" || args[1]?.[1] !== String(pid)) return execFile(...args);
      command = execFile(
        process.execPath,
        ["-e", "setInterval(() => {}, 1000)"],
        args[2],
        (...result) => {
          commandFinished = true;
          args.at(-1)(...result);
        }
      );
      return command;
    };
    syncBuiltinESMExports();
    const started = Date.now();
    const result = await kernel.close();
    const elapsed = Date.now() - started;
    t.diagnostic(`tree cleanup timeout: close=${elapsed} ms, commandFinished=${commandFinished}`);
    assert.ok(elapsed < 5000, `elapsed=${elapsed}`);
    assert.equal(commandFinished, true, "cleanup must settle before the service returns");
    assert.equal(stopped(command.pid), true);
    assert.equal(result.complete, false);
    assert.deepEqual(result.pendingResources, ["kernel"]);
    assert.equal(await kernel.closed, result);
    assert.equal((await kernel.status()).phase, "failed");
    assert.equal(stopped(pid), false);
    assert.equal(existsSync(join(stateDirectory, "kernel-invocations.json")), true);
  }
);

for (const cleanupIncomplete of [false, true]) {
  test(
    `Windows SDK preserves the final log near the full drain bound: incomplete=${cleanupIncomplete}`,
    windows,
    async (t) => {
      const f = await fixture(t, {
        shutdownDelayMs: 2490,
        logWriteDelayMs: 950,
        cleanupIncomplete
      });
      const stateDirectory = join(f.home, "run");
      const kernel = createKernelService({
        endpoint: componentEndpoint(f.home),
        stateDirectory,
        workerEntrypoint: f.entrypoint,
        env: { ...process.env, OCTO_RUNTIME_LOGS_DIRECTORY: join(f.home, "logs") }
      });
      f.onCleanup(() => kernel.close());
      await kernel.initialize();
      const pid = (await kernel.client.status()).worker.pid;
      const execFile = childProcess.execFile;
      let cleanupStarted;
      f.onCleanup(() => {
        childProcess.execFile = execFile;
        syncBuiltinESMExports();
      });
      // Model a fast successful taskkill so its startup latency cannot hide premature log termination.
      childProcess.execFile = (...args) => {
        if (args[0] !== "taskkill" || args[1]?.[1] !== String(pid)) return execFile(...args);
        cleanupStarted = Date.now();
        process.kill(pid, "SIGKILL");
        args.at(-1)(null);
      };
      syncBuiltinESMExports();
      const started = Date.now();
      const result = await kernel.close();
      const elapsed = Date.now() - started;
      const logs = await f.logs();
      const trace = await f.events();
      t.diagnostic(
        `full drain: cleanupStart=${cleanupStarted - started} ms, close=${elapsed} ms, tail=${logs.some((row) => row.event === "fixture.close_tail")}, complete=${result.complete}`
      );
      assert.equal(logs.filter((row) => row.event === "fixture.close_tail").length, 1);
      assert.equal(result.complete, !cleanupIncomplete, JSON.stringify(result));
      assert.equal(stopped(pid), true);
      assert.equal(existsSync(join(stateDirectory, "kernel-invocations.json")), cleanupIncomplete);
      assert.ok(elapsed >= 3400 && elapsed < 5000, `elapsed=${elapsed}`);
      assert.ok(
        trace.some((row) => row.event === "logging.close.finished" && row.time <= cleanupStarted)
      );
    }
  );
}

test(
  "Windows SDK still bounds a worker that stalls after starting shutdown",
  windows,
  async (t) => {
    const f = await fixture(t, { shutdownDelayMs: 6000 });
    const stateDirectory = join(f.home, "run");
    const kernel = createKernelService({
      endpoint: componentEndpoint(f.home),
      stateDirectory,
      workerEntrypoint: f.entrypoint
    });
    f.onCleanup(() => kernel.close());
    await kernel.initialize();
    const pid = (await kernel.client.status()).worker.pid;
    const started = Date.now();
    const result = await kernel.close();
    const elapsed = Date.now() - started;
    const trace = await f.events();
    t.diagnostic(`stalled shutdown: close=${elapsed} ms`);
    assert.ok(elapsed >= 3700 && elapsed < 5000, `elapsed=${elapsed}`);
    assert.equal(result.complete, true, JSON.stringify(result));
    assert.equal(stopped(pid), true);
    assert.equal(existsSync(join(stateDirectory, "kernel-invocations.json")), false);
    assert.ok(trace.some((row) => row.event === "shutdown.started"));
    assert.ok(!trace.some((row) => row.event === "shutdown.finished"));
  }
);

test("Windows heartbeat recovery skips the normal log drain grace", windows, async (t) => {
  const f = await fixture(t, { mode: "unresponsive" });
  const supervisor = new WorkerSupervisor({ entrypoint: f.entrypoint });
  f.onCleanup(() => supervisor.close());
  await supervisor.start();
  const previous = supervisor.status;
  await waitFor(() => supervisor.status.state === "recovering", 7000);
  const started = Date.now();
  await waitFor(() => supervisor.status.generation > previous.generation, 2000);
  t.diagnostic(`heartbeat recovery: ${Date.now() - started} ms after failure detection`);
  assert.equal(supervisor.status.state, "ready");
  assert.equal(stopped(previous.pid), true);
});

test("Windows drain notification cannot hide leader exit before taskkill", windows, async (t) => {
  const f = await fixture(t, { mode: "drained-then-exit" });
  const host = await spawnWorker({ entrypoint: f.entrypoint });
  const toolPid = (await f.events()).find((row) => row.event === "tool.started").toolPid;
  const execFile = childProcess.execFile;
  let pending;
  let leaderAliveAtCleanup;
  f.onCleanup(async () => {
    await pending;
    childProcess.execFile = execFile;
    syncBuiltinESMExports();
    for (const pid of [host.child.pid, toolPid]) if (!stopped(pid)) process.kill(pid, "SIGKILL");
    await waitFor(() => stopped(host.child.pid) && stopped(toolPid));
  });
  // 只固定命令启动窗口：通知已到达，但 taskkill 查树前 leader 自行退出。
  childProcess.execFile = (...args) => {
    if (args[0] !== "taskkill" || args[1]?.[1] !== String(host.child.pid)) return execFile(...args);
    leaderAliveAtCleanup = host.child.exitCode === null;
    pending = (async () => {
      await waitFor(() => host.child.exitCode !== null);
      await new Promise((resolve) => {
        execFile(...args.slice(0, -1), (...result) => {
          args.at(-1)(...result);
          resolve();
        });
      });
    })();
  };
  syncBuiltinESMExports();
  await assert.rejects(host.close(), { code: "PROCESS_TREE_CLEANUP_INCOMPLETE" });
  assert.equal(leaderAliveAtCleanup, true, "the exit must occur after the launcher's first check");
  assert.equal(stopped(toolPid), false, "detached tool demonstrates unconfirmed reclamation");
});

test(
  "Windows Host immediate close drains logs through the existing shutdown",
  windows,
  async (t) => {
    const f = await fixture(t);
    const host = await f.start();
    await host.close();
    // Windows 由 launcher 在排空通知后执行 taskkill；不能把任意非零退出当作健康关闭。
    assert.equal(host.child.exitCode, 1);
    assert.equal(host.child.signalCode, null);
    assert.equal(host.child.stdin.writableEnded, true);
    assert.deepEqual(
      (await f.logs())
        .map((row) => row.event)
        .filter((event) => ["adapter.registered", "host.ready"].includes(event)),
      ["adapter.registered", "host.ready"]
    );
    const events = (await f.events()).map((row) => row.event);
    assert.ok(events.indexOf("stdin.end") < events.indexOf("logging.close.finished"));
    assert.ok(events.indexOf("logging.close.finished") < events.indexOf("worker.drained"));
    assert.ok(events.indexOf("worker.drained") < events.indexOf("host.reaped"));
  }
);

test(
  "Windows Host completed close is shared, preserves records and supports subsequent startup",
  windows,
  async (t) => {
    const f = await fixture(t);
    for (let i = 0; i < 2; i++) {
      const host = await f.start();
      await invoke(host);
      const first = host.close(),
        second = host.close();
      assert.equal(first, second);
      await Promise.all([first, second]);
      assert.equal(host.close(), first);
      assert.equal(host.child.exitCode, 1);
    }
    const logs = await f.logs();
    assert.equal(
      logs.filter((row) => row.event === "invoke.finished" && row.data.status === "completed")
        .length,
      2
    );
    assert.doesNotMatch(JSON.stringify(logs), /private-close-fixture/);
  }
);

test(
  "Windows Host close gives slow shutdown its budget and leaves an independent Host usable",
  windows,
  async (t) => {
    const f = await fixture(t, { shutdownDelayMs: 2400, loggingDelayMs: 800 });
    const other = await fixture(t);
    const host = await f.start(),
      sibling = await other.start();
    const started = Date.now();
    await host.close();
    assert.ok(Date.now() - started >= 3200);
    assert.equal(host.child.exitCode, 1);
    await invoke(sibling);
    assert.ok((await f.events()).some((row) => row.event === "logging.close.finished"));
  }
);

test("Windows Host unresponsive EOF falls back within a bound", windows, async (t) => {
  const f = await fixture(t, { mode: "unresponsive" });
  const host = await f.start();
  const started = Date.now();
  await host.close();
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 3000 && elapsed < 5000, `elapsed=${elapsed}`);
  assert.notEqual(host.child.exitCode, null);
  assert.equal(stopped(host.child.pid), true);
  assert.ok((await f.events()).some((row) => row.event === "stdin.end"));
});

test(
  "Windows Host cleanup rejection releases pipes and preserves the shared error",
  windows,
  async (t) => {
    const f = await fixture(t, { mode: "unresponsive" });
    // 预期 close 拒绝，单独回收本次 Host，避免通用 fixture 重复等待该拒绝。
    const host = await spawnWorker({ entrypoint: f.entrypoint });
    const kill = host.child.kill.bind(host.child);
    const execFile = childProcess.execFile;
    f.onCleanup(async () => {
      childProcess.execFile = execFile;
      syncBuiltinESMExports();
      if (host.child.exitCode === null && host.child.signalCode === null) {
        const closed = once(host.child, "close");
        kill("SIGKILL");
        await closed;
      }
    });
    let attempts = 0;
    // 新 launcher 使用 taskkill；只让本次 PID 的命令失败，保留真实 cleanup。
    childProcess.execFile = (...args) => {
      if (args[0] === "taskkill" && args[1]?.[1] === String(host.child.pid)) {
        attempts++;
        args.at(-1)(Object.assign(new Error("fixture termination denied"), { code: "EPERM" }));
        return;
      }
      return execFile(...args);
    };
    syncBuiltinESMExports();
    const closing = host.close();
    assert.equal(host.close(), closing);
    let cleanupError;
    await assert.rejects(closing, (error) => {
      assert.equal(error.code, "PROCESS_TREE_CLEANUP_INCOMPLETE");
      cleanupError = error;
      return true;
    });
    for (const name of ["stdin", "stdout", "stderr"])
      assert.equal(
        host.child[name].destroyed,
        true,
        `${name} must be released after cleanup rejection`
      );
    assert.equal(stopped(host.child.pid), false);
    assert.equal(host.close(), closing);
    await assert.rejects(host.close(), (error) => error === cleanupError);
    assert.equal(attempts, 1);
  }
);

test("Windows Host logger timeout retains bounded lossy logging semantics", windows, async (t) => {
  const f = await fixture(t, { stalledWorker: true });
  const host = await f.start();
  await invoke(host);
  const started = Date.now();
  await host.close();
  assert.ok(Date.now() - started >= 900);
  assert.ok(Date.now() - started < 4000);
  assert.equal(host.child.exitCode, 1);
  assert.ok((await f.events()).some((row) => row.event === "logging.close.finished"));
});

test(
  "Windows worker exiting during EOF cannot hide a surviving detached tool",
  windows,
  async (t) => {
    const f = await fixture(t, { mode: "leader-first" });
    const host = await spawnWorker({ entrypoint: f.entrypoint });
    const toolPid = (await f.events()).find((row) => row.event === "tool.started").toolPid;
    f.onCleanup(async () => {
      if (!stopped(host.child.pid)) host.child.kill("SIGKILL");
      if (!stopped(toolPid)) process.kill(toolPid, "SIGKILL");
      await waitFor(() => stopped(host.child.pid) && stopped(toolPid));
    });
    assert.equal(stopped(toolPid), false);
    const closing = host.close();
    assert.equal(host.close(), closing);
    await assert.rejects(closing, { code: "PROCESS_TREE_CLEANUP_INCOMPLETE" });
    assert.equal(host.child.exitCode, 0);
    assert.equal(stopped(toolPid), false, "fixture must exercise the unconfirmed descendant");
    assert.equal(host.close(), closing);
    for (const name of ["stdin", "stdout", "stderr"])
      assert.equal(host.child[name].destroyed, true);
  }
);

test("Windows worker drains logs before tree cleanup reaps a detached tool", windows, async (t) => {
  const f = await fixture(t, { tool: "detached" });
  const host = await f.start();
  const outcome = (async () => {
    try {
      for await (const event of host.client.invoke(input())) void event;
    } catch (error) {
      return error;
    }
  })();
  let toolPid;
  await waitFor(async () => {
    const events = await f.events();
    toolPid = events.find((row) => row.event === "tool.started")?.toolPid;
    return events.some((row) => row.event === "tool.ready");
  });
  f.onCleanup(async () => {
    if (!stopped(toolPid)) process.kill(toolPid, "SIGKILL");
    await waitFor(() => stopped(toolPid));
  });
  await host.close();
  assert.match(String(await outcome), /client closed/);
  assert.equal(stopped(host.child.pid), true);
  assert.equal(stopped(toolPid), true, "tree cleanup must reap the detached tool before success");
  const events = await f.events();
  assert.ok(events.some((row) => row.event === "tool.left-running"));
  assert.ok(events.some((row) => row.event === "logging.close.finished"));
});

test(
  "Windows Host already exited and broken stdin do not wait the normal grace",
  windows,
  async (t) => {
    for (const broken of [false, true]) {
      const f = await fixture(t, { mode: "unresponsive" });
      const host = await f.start();
      if (broken) host.child.stdin.destroy(new Error("fixture broken stdin"));
      else {
        const exited = once(host.child, "exit");
        host.child.kill("SIGKILL");
        await exited;
      }
      const started = Date.now();
      await host.close();
      assert.ok(Date.now() - started < 2000);
      assert.equal(stopped(host.child.pid), true);
    }
  }
);

test("Windows Host readiness timeout retains direct startup rollback", windows, async (t) => {
  const f = await fixture(t, { mode: "not-ready" });
  const started = Date.now();
  await assert.rejects(
    spawnWorker({ entrypoint: f.entrypoint, readyTimeoutMs: 300 }),
    /readiness timed out/
  );
  assert.ok(Date.now() - started < 2000);
  for (const row of await f.events()) assert.equal(stopped(row.pid), true);
});

test(
  "Windows worker incomplete drain remains a shared close failure after tree cleanup",
  windows,
  async (t) => {
    const f = await fixture(t, { cleanupIncomplete: true });
    const host = await spawnWorker({ entrypoint: f.entrypoint });
    f.onCleanup(async () => {
      if (!stopped(host.child.pid)) host.child.kill("SIGKILL");
      await waitFor(() => stopped(host.child.pid));
    });
    const closing = host.close();
    let originalError;
    await assert.rejects(closing, (error) => {
      assert.equal(error.code, "EXECUTOR_CLEANUP_INCOMPLETE");
      originalError = error;
      return true;
    });
    assert.equal(stopped(host.child.pid), true);
    assert.equal(host.close(), closing);
    await assert.rejects(host.close(), (error) => error === originalError);
    for (const name of ["stdin", "stdout", "stderr"])
      assert.equal(host.child[name].destroyed, true);
  }
);

test(
  "Windows Host SDK retains worker cleanup failure and blocks replacement",
  windows,
  async (t) => {
    const f = await fixture(t, { cleanupIncomplete: true });
    const stateDirectory = join(f.home, "run");
    const options = {
      endpoint: componentEndpoint(f.home),
      stateDirectory,
      workerEntrypoint: f.entrypoint
    };
    // #71 的服务在当前进程构造；只检查内部 worker 退出，失败仍须保留端点所有权。
    const kernel = createKernelService(options);
    f.onCleanup(() => kernel.close());
    await kernel.initialize();
    const status = await kernel.client.status();
    assert.equal(status.pid, process.pid);
    const closing = kernel.close();
    assert.equal(kernel.close(), closing);
    const cleanup = await closing;
    assert.equal(cleanup.complete, false, JSON.stringify(cleanup));
    assert.ok(
      cleanup.errors.some((error) => error.code === "KERNEL_CLEANUP_INCOMPLETE"),
      JSON.stringify(cleanup)
    );
    assert.deepEqual(cleanup.pendingResources, ["kernel"]);
    assert.equal(await kernel.closed, cleanup);
    assert.equal((await kernel.status()).phase, "failed");
    assert.equal(stopped(status.worker.pid), true);
    assert.equal(existsSync(join(stateDirectory, "kernel-invocations.json")), true);
    const replacement = createKernelService(options);
    f.onCleanup(() => replacement.close());
    await assert.rejects(
      replacement.initialize(),
      (error) =>
        error.cause?.message ===
        "cannot replace live or unverifiable invocation manifest (kernel_alive)"
    );
    assert.equal(await kernel.close(), cleanup);
  }
);

test(
  "Windows cooperative Provider receives EOF cancellation and reaps its owned tool",
  windows,
  async (t) => {
    const f = await fixture(t, { tool: true });
    const host = await f.start();
    const outcome = (async () => {
      try {
        for await (const event of host.client.invoke(input())) void event;
      } catch (error) {
        return error;
      }
    })();
    let toolPid;
    await waitFor(() => {
      toolPid = readFileSync(f.trace, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(JSON.parse)
        .find((row) => row.event === "tool.started")?.toolPid;
      return !!toolPid;
    });
    f.onCleanup(async () => {
      if (toolPid && !stopped(toolPid)) {
        process.kill(toolPid, "SIGKILL");
        await waitFor(() => stopped(toolPid));
      }
    });
    await host.close();
    assert.match(String(await outcome), /client closed/);
    const events = await f.events();
    assert.ok(events.some((row) => row.event === "provider.cancelled"));
    assert.ok(events.some((row) => row.event === "tool.reaped"));
    assert.equal(stopped(toolPid), true);
    assert.equal(host.child.exitCode, 1);
  }
);

test(
  "Windows Host SDK Kernel worker slow close preserves logs and starts again",
  { ...windows, timeout: 25000 },
  async (t) => {
    const f = await fixture(t, { shutdownDelayMs: 2400, loggingDelayMs: 800 });
    for (let i = 0; i < 2; i++) {
      const kernel = createKernelService({
        endpoint: componentEndpoint(f.home),
        stateDirectory: join(f.home, "run"),
        workerEntrypoint: f.entrypoint,
        env: { ...process.env, OCTO_RUNTIME_LOGS_DIRECTORY: join(f.home, "logs") }
      });
      f.onCleanup(() => kernel.close());
      await kernel.initialize();
      const status = await kernel.client.status();
      assert.equal(status.pid, process.pid);
      assert.equal(status.execution_ready, true);
      const events = [];
      for await (const event of kernel.client.invoke(input(`sdk-close-${i}`))) events.push(event);
      assert.equal(events.at(-1).type, "run.completed");
      const started = Date.now();
      const closing = kernel.close();
      assert.equal(kernel.close(), closing);
      const cleanup = await closing;
      const elapsed = Date.now() - started;
      t.diagnostic(`SDK slow close ${i + 1}: ${elapsed} ms`);
      assert.ok(elapsed >= 3200 && elapsed < 5000, `elapsed=${elapsed}`);
      assert.equal(cleanup.complete, true, JSON.stringify(cleanup));
      assert.equal(await kernel.closed, cleanup);
      assert.equal((await kernel.status()).phase, "closed");
      assert.equal(existsSync(join(f.home, "run", "kernel-invocations.json")), false);
      assert.equal(stopped(status.worker.pid), true);
    }
    const trace = await f.events();
    const workers = trace.filter((row) => row.event === "host.started");
    assert.equal(workers.length, 2);
    assert.ok(workers.every((row) => stopped(row.pid)));
    assert.equal(trace.filter((row) => row.event === "logging.close.finished").length, 2);
    assert.equal(
      trace.filter((row) => row.event === "host.exit").length,
      0,
      "worker must remain alive after drain until the launcher reaps its tree"
    );
    assert.equal(
      (await f.logs()).filter(
        (row) => row.event === "invoke.finished" && row.data.status === "completed"
      ).length,
      2
    );
  }
);

test(
  "Windows Host SDK worker EOF fallback completes cleanup and supports subsequent startup",
  { ...windows, timeout: 30000 },
  async (t) => {
    const f = await fixture(t, { mode: "unresponsive" });
    const stateDirectory = join(f.home, "run");
    for (let i = 0; i < 2; i++) {
      const kernel = createKernelService({
        endpoint: componentEndpoint(f.home),
        stateDirectory,
        workerEntrypoint: f.entrypoint
      });
      f.onCleanup(() => kernel.close());
      await kernel.initialize();
      const status = await kernel.client.status();
      assert.equal(status.pid, process.pid);
      assert.equal(status.execution_ready, true);
      const manifest = join(stateDirectory, "kernel-invocations.json");
      assert.equal(existsSync(manifest), true);
      const started = Date.now();
      const cleanup = await kernel.close();
      const elapsed = Date.now() - started;
      t.diagnostic(`SDK EOF fallback close ${i + 1}: ${elapsed} ms`);
      assert.ok(elapsed >= 2800 && elapsed < 5000, `elapsed=${elapsed}`);
      assert.equal(cleanup.complete, true, JSON.stringify(cleanup));
      assert.equal(await kernel.closed, cleanup);
      assert.equal((await kernel.status()).phase, "closed");
      assert.equal(existsSync(manifest), false);
      assert.equal(stopped(status.worker.pid), true);
    }
  }
);
