import test from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { once } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { resolve } from "node:path";
import { WorkerSupervisor } from "../packages/octo-runtime-executor-kernel/dist/supervisor.js";
import { waitFor } from "./runtime-fixture.js";

async function windowsSupervisor(t, incomplete = false) {
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  const children = [];
  const spawn = childProcess.spawn;
  t.mock.method(childProcess, "spawn", (...args) => {
    const child = spawn(...args);
    children.push(child);
    return child;
  });
  syncBuiltinESMExports();
  const supervisor = new WorkerSupervisor({
    entrypoint: resolve("test/fixtures/heartbeat-worker.mjs")
  });
  t.after(async () => {
    Object.defineProperty(process, "platform", platform);
    try {
      // 先停止监督，避免测试回收本身又触发替代 worker。
      if (incomplete) await assert.rejects(supervisor.close(), /WORKER_CLEANUP_INCOMPLETE/);
      else await supervisor.close();
    } finally {
      // 平台分支模拟不提供原生 taskkill；只强杀本测试创建的 worker，并等待真实退出。
      try {
        for (const child of children) {
          if (child.exitCode !== null || child.signalCode !== null) continue;
          const exited = once(child, "exit");
          child.kill("SIGKILL");
          await exited;
        }
      } finally {
        Object.defineProperty(process, "platform", platform);
        t.mock.restoreAll();
        syncBuiltinESMExports();
      }
    }
  });
  await supervisor.start();
  // 使用真实 worker，但只切换父进程的恢复分支；不把本测试当作 Windows 原生树回收验收。
  Object.defineProperty(process, "platform", { ...platform, value: "win32" });
  return { supervisor, child: children[0] };
}

test(
  "Windows recovery replaces a worker that exited before cleanup began",
  { timeout: 8000 },
  async (t) => {
    const { supervisor, child } = await windowsSupervisor(t);
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    await exited;
    await waitFor(
      () => supervisor.status.generation === 2 && supervisor.status.state === "ready",
      3000
    );
    assert.equal(supervisor.status.restart_attempt, 1);
    assert.equal(supervisor.status.recovery, undefined);
    assert.notEqual(supervisor.status.pid, child.pid);
    assert.deepEqual(
      (await supervisor.client.list()).map((adapter) => adapter.type),
      ["test"]
    );
  }
);

test(
  "Windows recovery retains an observed tree cleanup failure after the leader exits",
  { timeout: 8000 },
  async (t) => {
    const { supervisor, child } = await windowsSupervisor(t, true);
    const execFile = childProcess.execFile;
    let treeAttempts = 0;
    t.mock.method(childProcess, "execFile", (file, args, ...rest) => {
      if (file !== "taskkill" || args[1] !== String(child.pid))
        return execFile(file, args, ...rest);
      treeAttempts++;
      rest.at(-1)(Object.assign(new Error("fixture tree cleanup denied"), { code: "EPERM" }));
    });
    syncBuiltinESMExports();
    // leader 仍活着时先触发失联，让首次树回收真正失败，再模拟 leader 退出。
    child.emit("error", new Error("fixture worker transport lost"));
    await waitFor(() => supervisor.status.state === "exhausted");
    assert.equal(treeAttempts, 1);
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
    }
    const firstRetry = supervisor.status.recovery.retry_at;
    await waitFor(() => supervisor.status.recovery.retry_at !== firstRetry, 3000);
    assert.equal(supervisor.status.state, "exhausted");
    assert.equal(supervisor.status.recovery.code, "PROCESS_TREE_CLEANUP_INCOMPLETE");
    assert.equal(supervisor.status.generation, 1);
    assert.equal(supervisor.status.restart_attempt, 0);
    assert.equal(treeAttempts, 1, "an exited leader must not become a new taskkill target");
  }
);
