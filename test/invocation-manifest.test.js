import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import {
  InvocationManifest,
  processStartIdentity,
  reapOrphanedInvocationManifest
} from "../packages/octo-runtime-executor-kernel/dist/invocation-manifest.js";

test(
  "Windows process identity remains stable without management module loading",
  { skip: process.platform !== "win32" },
  async (t) => {
    const expected = await processStartIdentity(process.pid);
    assert.match(expected, /^windows:\d+$/);
    const execFile = childProcess.execFile;
    t.mock.method(childProcess, "execFile", (file, args, ...rest) => {
      if (file === "powershell.exe") {
        // 仍执行真实查询，只移除 Get-Process 所属模块并禁止自动加载，暴露隐藏的 cmdlet 依赖。
        args = [
          ...args.slice(0, -1),
          `Remove-Module Microsoft.PowerShell.Management -ErrorAction SilentlyContinue; $PSModuleAutoLoadingPreference='None'; ${args.at(-1)}`
        ];
      }
      return execFile(file, args, ...rest);
    });
    syncBuiltinESMExports();
    t.after(() => {
      t.mock.restoreAll();
      syncBuiltinESMExports();
    });
    assert.equal(await processStartIdentity(process.pid), expected);
  }
);

test("invocation manifest persists only process and invocation metadata", async () => {
  const directory = await mkdtemp(join(tmpdir(), "oh-invocation-manifest-"));
  const path = join(directory, "run", "invocations.json");
  const { manifest, reap } = await InvocationManifest.open(path);
  try {
    assert.deepEqual(reap, { found: false, reaped: false });
    await manifest.setWorker(process.pid, "/test/worker.js");
    await manifest.begin({ invocationId: "invoke-1", runId: "run-1", adapterType: "codex" });
    const persisted = JSON.parse(await readFile(path, "utf8"));
    assert.equal(persisted.schemaVersion, 1);
    assert.equal(persisted.kernelPid, process.pid);
    assert.equal(persisted.worker.pid, process.pid);
    assert.deepEqual(Object.keys(persisted.invocations[0]).sort(), [
      "adapterType",
      "invocationId",
      "runId",
      "startedAt"
    ]);
    assert.doesNotMatch(JSON.stringify(persisted), /prompt|token|secret|providerOptions/);
    await manifest.end("invoke-1");
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")).invocations, []);
  } finally {
    await manifest.close();
    await assert.rejects(readFile(path, "utf8"), (error) => error.code === "ENOENT");
    await rm(directory, { recursive: true, force: true });
  }
});

test("orphan reaper requires matching process start identity before killing the process group", async () => {
  if (process.platform === "win32") return;
  const directory = await mkdtemp(join(tmpdir(), "oh-invocation-orphan-"));
  const path = join(directory, "invocations.json");
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    detached: true,
    stdio: "ignore"
  });
  try {
    const started = await processStartIdentity(child.pid);
    assert.ok(started);
    await writeFile(
      path,
      JSON.stringify({
        schemaVersion: 1,
        kernelPid: 2_147_483_646,
        updatedAt: new Date().toISOString(),
        worker: { pid: child.pid, started, entrypoint: "/test/worker.js" },
        invocations: [
          {
            invocationId: "invoke-orphan",
            runId: "run-orphan",
            adapterType: "codex",
            startedAt: new Date().toISOString()
          }
        ]
      })
    );
    const result = await reapOrphanedInvocationManifest(path);
    assert.deepEqual(result, { found: true, reaped: true, pid: child.pid });
    if (child.exitCode === null && child.signalCode === null) {
      await new Promise((resolve) => child.once("exit", resolve));
    }
  } finally {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      /* Already reaped. */
    }
    await rm(directory, { recursive: true, force: true });
  }
});
