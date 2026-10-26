import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import {
  InvocationManifest,
  processStartIdentity,
  reapOrphanedInvocationManifest
} from "../packages/octo-runtime-executor-kernel/dist/invocation-manifest.js";

test("failed Windows tree cleanup preserves evidence across a later leader exit and refuses replacement", async (t) => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  const directory = await mkdtemp(join(tmpdir(), "oh-incomplete-reap-"));
  const path = join(directory, "invocations.json");
  const original = {
    schemaVersion: 1,
    kernelPid: 2147483646,
    worker: { pid: 12345, started: "windows:100", entrypoint: "fixture" },
    invocations: []
  };
  await writeFile(path, JSON.stringify(original));
  t.after(async () => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    Object.defineProperty(process, "platform", platform);
    await rm(directory, { recursive: true, force: true });
  });
  Object.defineProperty(process, "platform", { ...platform, value: "win32" });
  let leaderAlive = true;
  t.mock.method(process, "kill", (pid, signal) => {
    assert.equal(signal, 0, "must never signal the leader before tree cleanup");
    if (pid === 12345 && leaderAlive) return true;
    throw Object.assign(new Error("gone"), { code: "ESRCH" });
  });
  let kills = 0;
  t.mock.method(childProcess, "execFile", (file, args, options, callback) => {
    if (file === "powershell.exe") callback(null, "100", "");
    else {
      assert.equal(file, "taskkill.exe");
      assert.deepEqual(args, ["/PID", "12345", "/T", "/F"]);
      assert.equal(options.timeout, 5000);
      kills++;
      callback(Object.assign(new Error("denied"), { code: 1 }), "", "");
    }
  });
  syncBuiltinESMExports();
  assert.equal((await reapOrphanedInvocationManifest(path)).reason, "cleanup_incomplete");
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), {
    ...original,
    cleanupIncomplete: true
  });
  assert.equal((await reapOrphanedInvocationManifest(path)).reason, "cleanup_incomplete");
  assert.equal(kills, 2, "a still-identifiable worker is retried on the next recovery attempt");
  leaderAlive = false;
  await assert.rejects(InvocationManifest.open(path), { code: "ORPHAN_CLEANUP_INCOMPLETE" });
  assert.equal(kills, 2);
  assert.equal(JSON.parse(await readFile(path, "utf8")).cleanupIncomplete, true);
});

test(
  "Windows orphan recovery reaps live owned descendants and protects an unrelated process",
  {
    skip: process.platform !== "win32",
    timeout: 90_000
  },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "oh-native-tree-"));
    const path = join(directory, "invocations.json");
    const tree = spawn(
      process.execPath,
      [fileURLToPath(new URL("./fixtures/windows-owned-tree.mjs", import.meta.url)), "root"],
      {
        stdio: ["ignore", "ignore", "ignore", "ipc"]
      }
    );
    const unrelated = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
      stdio: "ignore"
    });
    let pids = [];
    t.after(async () => {
      for (const pid of [tree.pid, ...pids, unrelated.pid]) {
        try {
          process.kill(pid, "SIGKILL");
        } catch (error) {
          if (error.code !== "ESRCH") throw error;
        }
      }
      await rm(directory, { recursive: true, force: true });
    });
    [pids] = await once(tree, "message");
    const started = await processStartIdentity(tree.pid);
    assert.ok(started);
    const manifest = {
      schemaVersion: 1,
      kernelPid: 2147483646,
      worker: { pid: tree.pid, started: `${started}-mismatch`, entrypoint: "fixture" },
      invocations: []
    };
    await writeFile(path, JSON.stringify(manifest));
    assert.equal((await reapOrphanedInvocationManifest(path)).reason, "identity_mismatch");
    assert.doesNotThrow(() => process.kill(tree.pid, 0));
    manifest.worker.started = started;
    await writeFile(path, JSON.stringify(manifest));
    assert.deepEqual(await reapOrphanedInvocationManifest(path), {
      found: true,
      reaped: true,
      pid: tree.pid
    });
    for (const pid of [tree.pid, ...pids])
      assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    assert.doesNotThrow(() => process.kill(unrelated.pid, 0));
    await assert.rejects(readFile(path), { code: "ENOENT" });
  }
);

test("Windows identity queries stay fresh and preserve registration failures", async (t) => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  const directory = await mkdtemp(join(tmpdir(), "oh-identity-query-"));
  t.after(async () => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    Object.defineProperty(process, "platform", platform);
    await rm(directory, { recursive: true, force: true });
  });
  Object.defineProperty(process, "platform", { ...platform, value: "win32" });
  const failure = Object.assign(new Error("identity query timed out"), {
    code: "ETIMEDOUT",
    killed: true
  });
  let result = "100";
  t.mock.method(childProcess, "execFile", (_file, _args, _options, callback) => {
    assert.equal(_options.timeout, 40_000);
    callback(result === "failure" ? failure : null, result, "");
  });
  syncBuiltinESMExports();
  assert.equal(await processStartIdentity(1234), "windows:100");
  result = "200";
  assert.equal(await processStartIdentity(1234), "windows:200");
  result = "invalid";
  assert.equal(await processStartIdentity(1234), undefined);
  result = "failure";
  assert.equal(await processStartIdentity(1234), undefined);
  const path = join(directory, "invocations.json");
  const { manifest } = await InvocationManifest.open(path);
  try {
    await assert.rejects(manifest.setWorker(1234, "/worker.js"), (error) => {
      assert.match(error.message, /cannot identify worker process 1234/);
      assert.equal(error.cause, failure);
      return true;
    });
    assert.equal(JSON.parse(await readFile(path, "utf8")).worker, undefined);
  } finally {
    await manifest.close();
  }
});

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
