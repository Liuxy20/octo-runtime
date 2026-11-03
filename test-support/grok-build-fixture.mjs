import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { mock } from "node:test";

/** 仅在同步创建本次夹具时替换 spawn；返回真实 OS 管道，不注入合成 end 事件。 */
export function withGrokOutputPipe(createClient, onSpawn = () => {}) {
  const spawn = childProcess.spawn;
  const replacement = mock.method(childProcess, "spawn", (command, args, options) => {
    // Windows 的 fd 0–2 不能由 fs.close 关闭；fd3 由夹具独占并可在进程存活时关闭。
    const child = spawn(command, args, {
      ...options,
      env: { ...options.env, OCTO_GROK_OUTPUT_FD: "3" },
      stdio: ["pipe", "ignore", "pipe", "pipe"]
    });
    child.stdout = child.stdio[3];
    onSpawn(child);
    return child;
  });
  syncBuiltinESMExports();
  try {
    return createClient();
  } finally {
    replacement.mock.restore();
    syncBuiltinESMExports();
  }
}

/** 在任何客户端监听之前记录父端真实 EOF 与 PID 存活事实，不改变流或清理时序。 */
export function observeGrokFixture(child) {
  const started = performance.now();
  const events = [];
  const record = (event, details = {}) =>
    events.push({ event, ms: performance.now() - started, ...details });
  child.stdout.once("end", () => {
    let alive = false;
    try {
      process.kill(child.pid, 0);
      alive = true;
    } catch (error) {
      record("pid-probe-error", { code: error.code });
    }
    record("stdout-eof", { alive, exitCode: child.exitCode, signalCode: child.signalCode });
  });
  child.once("exit", (code, signal) => record("exit", { code, signal }));
  const closed = new Promise((resolve) =>
    child.once("close", () => {
      record("close");
      resolve();
    })
  );
  return { child, events, record, closed };
}
