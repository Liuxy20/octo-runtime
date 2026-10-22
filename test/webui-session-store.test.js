import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import timers from "node:timers/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { SessionStore } from "../packages/octo-runtime-extra-webui/dist/store.js";

const waits = [20, 50, 100, 200, 400, 800, 1600];
const realPlatform = process.platform;
const failure = (code) => Object.assign(new Error(code), { code });
const originalSession = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "saved",
  projectPath: "/project",
  updatedAt: 1,
  revision: 3,
  adapter: "codex",
  model: "",
  effort: "",
  messages: [{ id: "m1", role: "user", content: "saved", createdAt: 1 }],
  providerSession: { sessionId: "saved-provider", extension: { saved: true } }
};
function mutate(records) {
  Object.assign(records[0], {
    title: "failed",
    revision: 4,
    messages: [{ id: "m2", role: "assistant", content: "failed", createdAt: 2 }],
    providerSession: { sessionId: "failed-provider" }
  });
}
function patch(t, object, method, implementation) {
  const mock = t.mock.method(object, method, implementation);
  syncBuiltinESMExports();
  return mock;
}
function restore(t) {
  t.mock.restoreAll();
  syncBuiltinESMExports();
}
function platform(t, value) {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { ...descriptor, value });
  t.after(() => Object.defineProperty(process, "platform", descriptor));
}
async function fixture(t, log) {
  const home = await fs.mkdtemp(join(tmpdir(), "octo-store-"));
  t.after(async () => {
    restore(t);
    await fs.rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const path = join(home, "sessions.json");
  const original = JSON.stringify({ version: 1, sessions: [originalSession] });
  await fs.writeFile(path, original);
  const store = new SessionStore(path, log);
  await store.open();
  return {
    home,
    path,
    store,
    async unchanged() {
      assert.equal(await fs.readFile(path, "utf8"), original);
      assert.deepEqual(store.records, [originalSession]);
    },
    async noTemporary() {
      assert.deepEqual(await fs.readdir(home), ["sessions.json"]);
    },
    async recover() {
      await store.change((records) => {
        assert.deepEqual(records, [originalSession]);
        records[0].title = "recovered";
        records[0].revision++;
      });
      const loaded = new SessionStore(path);
      await loaded.open();
      assert.deepEqual(loaded.records, [{ ...originalSession, title: "recovered", revision: 4 }]);
      assert.deepEqual(store.records, loaded.records);
    }
  };
}

// 将 POSIX mode 检查与会话功能验收分开。
test(
  "POSIX session files retain private 0600 permissions",
  { skip: process.platform === "win32" },
  async (t) => {
    const f = await fixture(t);
    await f.store.change((records) => {
      records[0].title = "private";
    });
    assert.equal((await fs.stat(f.path)).mode & 0o777, 0o600);
  }
);

for (const mode of ["partial write", "close", "write and close", "replace", "cleanup"]) {
  test(
    "failed " + mode + " preserves disk, memory and original error; queue recovers",
    async (t) => {
      const diagnostics = [];
      const f = await fixture(t, (...args) => diagnostics.push(args));
      const primary = failure("EIO");
      const secondary = failure("EBUSY");
      const realOpen = fs.open;
      const realUnlink = fs.unlink;
      const replaceCalls = patch(t, fs, "rename", async () => {
        throw primary;
      });
      const cleanupCalls = patch(t, fs, "unlink", async (path) => {
        if (mode === "cleanup") throw secondary;
        return realUnlink(path);
      });
      if (["partial write", "close", "write and close"].includes(mode)) {
        patch(t, fs, "open", async (...args) => {
          const handle = await realOpen(...args);
          return {
            async writeFile(text) {
              if (mode !== "close") {
                await handle.writeFile(text.slice(0, 10));
                throw primary;
              }
              await handle.writeFile(text);
            },
            async close() {
              await handle.close();
              if (mode === "write and close") throw secondary;
              if (mode === "close") throw primary;
            }
          };
        });
      }
      let operations = 0;
      await assert.rejects(
        f.store.change((records) => {
          operations++;
          mutate(records);
        }),
        (e) => e === primary
      );
      assert.equal(operations, 1);
      assert.equal(replaceCalls.mock.callCount(), ["replace", "cleanup"].includes(mode) ? 1 : 0);
      assert.equal(cleanupCalls.mock.callCount(), 1);
      await f.unchanged();
      if (mode === "cleanup") {
        assert.equal((await fs.readdir(f.home)).filter((p) => p.endsWith(".tmp")).length, 1);
        assert.deepEqual(diagnostics, [
          ["warn", "webui.store.temporary_cleanup_failed", { code: "EBUSY" }]
        ]);
      } else {
        await f.noTemporary();
        assert.deepEqual(
          diagnostics,
          mode === "write and close"
            ? [["warn", "webui.store.close_failed", { code: "EBUSY" }]]
            : []
        );
      }
      restore(t);
      await f.recover();
    }
  );
}

test("exclusive open failure does not unlink a file owned by another attempt", async (t) => {
  const f = await fixture(t);
  const primary = failure("EEXIST");
  let other;
  const realWrite = fs.writeFile;
  patch(t, fs, "open", async (path) => {
    other = path;
    await realWrite(path, "other owner's file");
    throw primary;
  });
  const cleanup = patch(t, fs, "unlink", async () => assert.fail("must not unlink"));
  await assert.rejects(f.store.change(mutate), (e) => e === primary);
  assert.equal(cleanup.mock.callCount(), 0);
  assert.equal(await fs.readFile(other, "utf8"), "other owner's file");
  await f.unchanged();
  restore(t);
  await f.recover();
});

test("failed initial creation leaves no store and the next save can create it", async (t) => {
  const f = await fixture(t);
  await fs.unlink(f.path);
  f.store.records = [];
  const primary = failure("EIO");
  patch(t, fs, "rename", async () => {
    throw primary;
  });
  await assert.rejects(
    f.store.change((records) => records.push(originalSession)),
    (e) => e === primary
  );
  assert.deepEqual(f.store.records, []);
  assert.deepEqual(await fs.readdir(f.home), []);
  await assert.rejects(fs.stat(f.path), { code: "ENOENT" });
  restore(t);
  await f.store.change((records) => records.push(originalSession));
  const loaded = new SessionStore(f.path);
  await loaded.open();
  assert.deepEqual(loaded.records, [originalSession]);
});

test("unreleased handle and throwing diagnostics cannot replace a write error", async (t) => {
  const f = await fixture(t, () => {
    throw new Error("diagnostic unavailable");
  });
  const primary = failure("ENOSPC");
  const realOpen = fs.open;
  let handle;
  patch(t, fs, "open", async (...args) => {
    handle = await realOpen(...args);
    return {
      async writeFile() {
        await handle.writeFile("{");
        throw primary;
      },
      async close() {
        throw failure("EIO");
      }
    };
  });
  const unlink = patch(t, fs, "unlink", async () => {
    throw failure("EPERM");
  });
  try {
    await assert.rejects(f.store.change(mutate), (e) => e === primary);
    await f.unchanged();
    assert.equal(unlink.mock.callCount(), 1);
    assert.equal((await fs.readdir(f.home)).length, 2);
  } finally {
    restore(t);
    await handle?.close();
  }
  await f.recover();
});

test("Windows transient EPERM retries the same replacement inside the queue", async (t) => {
  const f = await fixture(t, () => assert.fail("successful saves need no diagnostic"));
  platform(t, "win32");
  const entered = Promise.withResolvers();
  const resume = Promise.withResolvers();
  const delays = [];
  patch(t, timers, "setTimeout", async (ms) => {
    delays.push(ms);
    if (delays.length === 1) {
      entered.resolve();
      await resume.promise;
    }
  });
  const realRename = fs.rename;
  const paths = [];
  patch(t, fs, "rename", async (...args) => {
    paths.push(args);
    if (paths.length <= 2) throw failure("EPERM");
    return realRename(...args);
  });
  const cleanup = patch(t, fs, "unlink", async () => assert.fail("no post-commit cleanup"));
  let firstCalls = 0,
    secondCalls = 0;
  const first = f.store.change((records) => {
    firstCalls++;
    records[0].revision++;
    return "committed";
  });
  await entered.promise;
  const second = f.store.change((records) => {
    secondCalls++;
    assert.equal(records[0].revision, 4);
    records[0].revision++;
  });
  try {
    assert.equal(secondCalls, 0);
    await f.unchanged();
  } finally {
    resume.resolve();
  }
  assert.equal(await first, "committed");
  await second;
  assert.equal(firstCalls, 1);
  assert.equal(secondCalls, 1);
  assert.deepEqual(delays, [20, 50]);
  assert.deepEqual(paths[0], paths[1]);
  assert.deepEqual(paths[1], paths[2]);
  assert.notEqual(paths[2][0], paths[3][0]);
  assert.equal(cleanup.mock.callCount(), 0);
  const loaded = new SessionStore(f.path);
  await loaded.open();
  assert.deepEqual(loaded.records, [{ ...originalSession, revision: 5 }]);
  assert.deepEqual(f.store.records, loaded.records);
  await f.noTemporary();
});

for (const scenario of [
  { os: "win32", codes: ["EPERM"], attempts: 8, delays: waits },
  { os: "win32", codes: ["EPERM", "EACCES"], attempts: 2, delays: [20] },
  { os: "win32", codes: ["EACCES"], attempts: 1, delays: [] },
  { os: "win32", codes: ["EBUSY"], attempts: 1, delays: [] },
  { os: "linux", codes: ["EPERM"], attempts: 1, delays: [] }
]) {
  test(
    "replacement failure is bounded and retains the final error: " +
      scenario.os +
      " " +
      scenario.codes.join("/"),
    async (t) => {
      const f = await fixture(t);
      platform(t, scenario.os);
      const errors = [];
      const delays = [];
      patch(t, timers, "setTimeout", async (ms) => {
        delays.push(ms);
      });
      patch(t, fs, "rename", async (path, dest) => {
        const code = scenario.codes[Math.min(errors.length, scenario.codes.length - 1)];
        const error = Object.assign(failure(code), { syscall: "rename", path, dest });
        errors.push(error);
        throw error;
      });
      await assert.rejects(f.store.change(mutate), (e) => e === errors.at(-1));
      assert.equal(errors.length, scenario.attempts);
      assert.deepEqual(delays, scenario.delays);
      assert(delays.reduce((a, b) => a + b, 0) <= 3170);
      await f.unchanged();
      await f.noTemporary();
      restore(t);
      // 平台模拟仅用于注入分支；恢复保存使用实际系统。
      Object.defineProperty(process, "platform", { value: realPlatform });
      await f.recover();
    }
  );
}
// 原生文件句柄验证实际 Windows 替换行为；不将受控占用者当作 Issue 的原始占用者。
async function holdFile(t, path) {
  const script =
    "$h=[IO.File]::Open('" +
    path.replaceAll("'", "''") +
    "',[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite);" +
    "try {[Console]::Out.WriteLine('READY');[Console]::Out.Flush();[Console]::In.ReadLine() | Out-Null} finally {$h.Dispose()}";
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"]
  });
  let output = "";
  const exited = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error("holder exit " + code))
    );
  });
  // 注册立即回收，异常路径也只处理本测试启动的句柄进程。
  t.after(async () => {
    child.stdin.end();
    await exited;
  });
  await Promise.race([
    new Promise((resolve) =>
      child.stdout.on("data", (chunk) => {
        output += chunk;
        if (output.includes("READY")) resolve();
      })
    ),
    exited.then(() => {
      throw new Error("holder exited before READY");
    }),
    timers.setTimeout(10000, null, { ref: false }).then(() => {
      child.kill();
      throw new Error("holder timeout");
    })
  ]);
  return async () => {
    child.stdin.end();
    await exited;
  };
}

for (const transient of [true, false]) {
  test(
    "native Windows file lock " +
      (transient ? "recovers during save" : "exhausts then queue recovers"),
    { skip: process.platform !== "win32", timeout: 20000 },
    async (t) => {
      const f = await fixture(t);
      const release = await holdFile(t, f.path);
      const realRename = fs.rename;
      const errors = [];
      patch(t, fs, "rename", async (...args) => {
        try {
          return await realRename(...args);
        } catch (error) {
          errors.push(error);
          if (transient) await release();
          throw error;
        }
      });
      try {
        if (transient) {
          let callbacks = 0;
          await f.store.change((records) => {
            callbacks++;
            records[0].revision++;
          });
          assert.equal(callbacks, 1);
          assert.equal(errors[0]?.code, "EPERM");
          assert.equal(errors[0]?.syscall, "rename");
          const loaded = new SessionStore(f.path);
          await loaded.open();
          assert.deepEqual(loaded.records, [{ ...originalSession, revision: 4 }]);
          assert.deepEqual(f.store.records, loaded.records);
        } else {
          await assert.rejects(
            f.store.change(mutate),
            (e) => e === errors.at(-1) && e.code === "EPERM"
          );
          assert.equal(errors.length, 8);
          await f.unchanged();
        }
        await f.noTemporary();
      } finally {
        restore(t);
        await release();
      }
      if (!transient) await f.recover();
    }
  );
}
