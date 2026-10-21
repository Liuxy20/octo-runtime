import { appendFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import threads, { isMainThread, parentPort, workerData } from "node:worker_threads";
import { fileURLToPath } from "node:url";

// 不配合的日志线程仅供验证现有 RuntimeLogging 的一秒超时，无生产注入开关。
if (!isMainThread && workerData?.issue38StalledWorker) {
  parentPort.on("message", () => {});
}

// Delay one real log write inside the logging thread, below its existing one-second close bound.
if (!isMainThread && workerData?.issue38SlowLogWorker) {
  const { HourlyLogWriter } =
    await import("../packages/octo-runtime-adapter-sdk/dist/hourly-log.js");
  const write = HourlyLogWriter.prototype.write;
  HourlyLogWriter.prototype.write = function (line) {
    if (JSON.parse(line).event === "fixture.close_tail")
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, workerData.delayMs);
    return write.call(this, line);
  };
  await import(workerData.source);
}

export async function serveCloseFixture(options = {}) {
  const mark = (event, data = {}) => {
    if (options.trace)
      appendFileSync(
        options.trace,
        `${JSON.stringify({ event, pid: process.pid, time: Date.now() + (options.traceClockOffsetMs ?? 0), ...data })}\n`
      );
  };
  process.on("exit", (code) => mark("host.exit", { code }));
  process.stdin.on("end", () => mark("stdin.end"));
  mark("host.started");
  if (options.mode === "leader-first" || options.mode === "drained-then-exit") {
    const tool = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
      detached: true,
      windowsHide: true
    });
    tool.unref();
    mark("tool.started", { toolPid: tool.pid });
    process.stdin.once("end", () => {
      if (options.mode === "drained-then-exit")
        process.send({ type: "worker.drained", cleanup: "complete" }, () => process.exit(0));
      else process.exit(0);
    });
    createInterface({ input: process.stdin }).on("line", (line) => {
      const message = JSON.parse(line);
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: [] })}\n`);
    });
    return;
  }
  if (options.mode === "unresponsive" || options.mode === "not-ready") {
    setInterval(() => {}, 1000);
    createInterface({ input: process.stdin }).on("line", (line) => {
      const message = JSON.parse(line);
      if (options.mode !== "not-ready")
        process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: [] })}\n`);
    });
    return;
  }
  if (options.stalledWorker || options.logWriteDelayMs) {
    const OriginalWorker = threads.Worker;
    threads.Worker = class extends OriginalWorker {
      constructor(url, settings) {
        super(new URL(import.meta.url), {
          ...settings,
          workerData: options.stalledWorker
            ? { issue38StalledWorker: true }
            : {
                ...settings.workerData,
                issue38SlowLogWorker: true,
                source: url.href,
                delayMs: options.logWriteDelayMs
              }
        });
      }
    };
    syncBuiltinESMExports();
  }
  const { AgentExecutor } = await import("../packages/octo-runtime-executor-core/dist/index.js");
  const { serveWorker } = await import("../packages/octo-runtime-executor-kernel/dist/index.js");
  const { RuntimeLogging } = await import("../packages/octo-runtime-adapter-sdk/dist/index.js");
  const { testAdapter } = await import("../test/fixtures/test-adapter.js");
  if (options.shutdownDelayMs || options.cleanupIncomplete) {
    const shutdown = AgentExecutor.prototype.shutdown;
    let stopping;
    AgentExecutor.prototype.shutdown = function (...args) {
      return (stopping ??= (async () => {
        mark("shutdown.started");
        const result = await shutdown.apply(this, args);
        if (options.shutdownDelayMs) await delay(options.shutdownDelayMs);
        mark("shutdown.finished");
        return options.cleanupIncomplete
          ? { ...result, cleanup: "incomplete", unresolvedInvocationIds: ["fixture-cleanup"] }
          : result;
      })());
    };
  }
  const close = RuntimeLogging.prototype.close;
  RuntimeLogging.prototype.close = async function () {
    mark("logging.close.started");
    if (options.loggingDelayMs) await delay(options.loggingDelayMs);
    if (options.logWriteDelayMs) this.kernel("info", "fixture.close_tail");
    await close.call(this);
    mark("logging.close.finished");
  };
  const adapter = options.tool
    ? {
        ...testAdapter,
        async *invoke(request) {
          const tool = spawn(
            process.execPath,
            [fileURLToPath(new URL(import.meta.url)), "tool", options.trace, String(options.tool)],
            {
              stdio: ["pipe", "ignore", "ignore"],
              detached: options.tool === "detached",
              windowsHide: true
            }
          );
          const exited = once(tool, "exit");
          mark("tool.started", { toolPid: tool.pid });
          try {
            if (!request.signal.aborted)
              await new Promise((resolve) =>
                request.signal.addEventListener("abort", resolve, { once: true })
              );
            mark("provider.cancelled", { toolPid: tool.pid });
          } finally {
            tool.stdin.end();
            if (options.tool === "detached") {
              tool.unref();
              mark("tool.left-running", { toolPid: tool.pid });
            } else {
              await exited;
              mark("tool.reaped", { toolPid: tool.pid });
            }
          }
          yield { protocolVersion: 2, type: "run.cancelled", payload: {} };
        }
      }
    : testAdapter;
  serveWorker([adapter]);
}

if (isMainThread && process.argv[2] === "tool") {
  appendFileSync(
    process.argv[3],
    `${JSON.stringify({ event: "tool.ready", pid: process.pid, time: Date.now() })}\n`
  );
  const timer = setInterval(() => {}, 1000);
  process.stdin.resume();
  process.stdin.once("end", () => {
    if (process.argv[4] === "detached") return;
    clearInterval(timer);
    appendFileSync(
      process.argv[3],
      `${JSON.stringify({ event: "tool.exit", pid: process.pid, time: Date.now() })}\n`
    );
  });
}
