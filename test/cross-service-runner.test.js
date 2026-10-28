import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { PassThrough } from "node:stream";
import test from "node:test";
import { NodeCommandRunner } from "../packages/octo-runtime-cross-service/dist/index.js";
import { runCommand } from "../packages/octo-runtime-cross-service/dist/common.js";

const taskCommand = "C:\\Windows\\System32\\schtasks.exe";
const windowsOnly = { skip: process.platform !== "win32" };

function mockCommands(t, respond) {
  const calls = [];
  const timers = [];
  t.mock.method(childProcess, "spawn", (command, args, options) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    let closed = false;
    const finish = (code = 0) => {
      if (closed) return;
      closed = true;
      child.stdout.end();
      child.stderr.end();
      // close follows stream end in a real child; flush any final decoder state first.
      timers.push(setImmediate(() => child.emit("close", code)));
    };
    child.kill = () => {
      finish(1);
      return true;
    };
    const call = { command, args, options, child, finish };
    calls.push(call);
    timers.push(setImmediate(() => respond(call)));
    return child;
  });
  syncBuiltinESMExports();
  t.after(() => {
    for (const timer of timers) clearTimeout(timer);
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  return calls;
}

function replyCodePage(call, codePage) {
  if (!/cmd\.exe$/i.test(call.command)) return false;
  assert.deepEqual(call.args.slice(0, 2), ["/d", "/c"]);
  assert.match(call.args[2], /System32[\\/]chcp\.com$/i);
  call.child.stdout.write(`Active code page: ${codePage}\r\n`);
  call.finish();
  return true;
}

test("runner preserves UTF-8 output, BOM and exact argv for non-native commands", async (t) => {
  const text = "\uFEFF中文 UTF-8";
  const bytes = Buffer.from(text);
  const calls = mockCommands(t, ({ child, finish }) => {
    child.stdout.write(bytes.subarray(0, 4));
    child.stdout.write(bytes.subarray(4));
    child.stderr.write(bytes);
    finish(7);
  });
  const args = ["with spaces", "& not a shell", 'quoted"value'];
  const result = await new NodeCommandRunner().run(process.execPath, args);
  assert.equal(result.stdout, text);
  assert.equal(result.stderr, text);
  assert.equal(result.exitCode, 7);
  assert.deepEqual(result.args, args);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.shell, false);
});

for (const [codePage, bytes, expected] of [
  [936, Buffer.from([0xd6, 0xd0, 0xce, 0xc4]), "中文"],
  [850, Buffer.from([0x82, 0x9b]), "éø"],
  [437, Buffer.from([0x82, 0x9b]), "é¢"],
  [65001, Buffer.from("中文"), "中文"]
]) {
  test(
    `Windows native runner decodes CP${codePage} across chunks and retains error context`,
    windowsOnly,
    async (t) => {
      const calls = mockCommands(t, (call) => {
        if (replyCodePage(call, codePage)) return;
        assert.equal(call.command, taskCommand);
        for (const byte of bytes) {
          call.child.stdout.write(Buffer.from([byte]));
          call.child.stderr.write(Buffer.from([byte]));
        }
        call.finish(5);
      });
      const runner = new NodeCommandRunner();
      const args = ["/Query", "/TN", "\\fixture with spaces"];
      const result = await runner.run(taskCommand, args);
      assert.equal(result.stdout, expected);
      assert.equal(result.stderr, expected);
      assert.equal(result.exitCode, 5);
      assert.equal(result.command, taskCommand);
      assert.deepEqual(result.args, args);
      await assert.rejects(runCommand(runner, "windows-user-task", taskCommand, args), (error) => {
        assert.equal(error.code, "COMMAND_FAILED");
        assert.equal(error.exitCode, 5);
        assert.equal(error.command, taskCommand);
        assert.equal(error.detail, expected);
        return true;
      });
      assert.equal(calls.filter((call) => /cmd\.exe$/i.test(call.command)).length, 1);
      for (const call of calls) {
        assert.equal(call.options.shell, false);
        assert.equal(call.options.windowsHide, true);
      }
    }
  );
}

test(
  "Windows native capture stays bounded and flushes incomplete trailing bytes",
  windowsOnly,
  async (t) => {
    mockCommands(t, (call) => {
      if (replyCodePage(call, 936)) return;
      call.child.stdout.write(Buffer.alloc(90_000, 0x61));
      call.child.stdout.write(Buffer.from([0xd6, 0xd0, 0xce, 0xc4]));
      call.child.stderr.write(Buffer.from([0xd6]));
      call.finish();
    });
    const result = await new NodeCommandRunner().run(taskCommand, ["/Query"]);
    assert.equal(result.stdout.length, 64 * 1024);
    assert.ok(result.stdout.endsWith("中文"));
    assert.equal(result.stderr, "\uFFFD");
  }
);

test(
  "Windows code-page lookup failure is explicit and is retried instead of guessing",
  windowsOnly,
  async (t) => {
    let attempt = 0;
    const calls = mockCommands(t, (call) => {
      if (/cmd\.exe$/i.test(call.command) && attempt++ === 0) {
        call.child.stderr.write("code-page query failed");
        call.finish(5);
        return;
      }
      if (replyCodePage(call, 850)) return;
      call.child.stdout.write(Buffer.from([0x9b]));
      call.finish();
    });
    const runner = new NodeCommandRunner();
    await assert.rejects(runner.run(taskCommand, ["/Query"]), /code.page/i);
    assert.equal(calls.length, 1);
    assert.equal((await runner.run(taskCommand, ["/Query"])).stdout, "ø");
  }
);

for (const output of ["no code page", "Active code page: 99999"]) {
  test(`Windows native runner rejects unsupported lookup: ${output}`, windowsOnly, async (t) => {
    const calls = mockCommands(t, (call) => {
      call.child.stdout.write(output);
      call.finish();
    });
    await assert.rejects(new NodeCommandRunner().run(taskCommand, []), /code.page/i);
    assert.equal(calls.length, 1);
  });
}

test("Windows code-page lookup and manager share the command timeout", windowsOnly, async (t) => {
  mockCommands(t, (call) => {
    if (/cmd\.exe$/i.test(call.command)) {
      const timer = setTimeout(() => replyCodePage(call, 936), 80);
      t.after(() => clearTimeout(timer));
    } else {
      const timer = setTimeout(() => call.finish(0), 80);
      t.after(() => clearTimeout(timer));
    }
  });
  const result = await new NodeCommandRunner().run(taskCommand, ["/Query"], { timeoutMs: 120 });
  assert.equal(result.exitCode, 124);
  assert.match(result.stderr, /timed out after 120ms/);
  assert.equal(result.command, taskCommand);
});

test(
  "Windows lookup timeout does not launch the manager or poison later calls",
  windowsOnly,
  async (t) => {
    let attempt = 0;
    const calls = mockCommands(t, (call) => {
      if (/cmd\.exe$/i.test(call.command) && attempt++ === 0) return;
      if (replyCodePage(call, 936)) return;
      call.finish();
    });
    const runner = new NodeCommandRunner();
    const first = runner.run(taskCommand, ["/Query"], { timeoutMs: 10 });
    // The production timeout is unref'ed; keep the fake child alive like a real process.
    const keepAlive = setTimeout(() => {}, 1000);
    t.after(() => clearTimeout(keepAlive));
    const result = await first;
    assert.equal(result.exitCode, 124);
    assert.equal(result.command, taskCommand);
    assert.equal(calls.length, 1);
    assert.equal((await runner.run(taskCommand, ["/Query"])).exitCode, 0);
  }
);

test("Windows native spawn errors retain the original errno", windowsOnly, async (t) => {
  const cause = Object.assign(new Error("fixture missing executable"), { code: "ENOENT" });
  mockCommands(t, (call) => {
    if (replyCodePage(call, 936)) return;
    call.child.emit("error", cause);
    call.finish(1);
  });
  await assert.rejects(
    new NodeCommandRunner().run(taskCommand, ["/Query"]),
    (error) => error === cause
  );
});

test("Windows native exit code 124 is not misreported as a timeout", windowsOnly, async (t) => {
  mockCommands(t, (call) => {
    if (replyCodePage(call, 936)) return;
    call.child.stderr.write(Buffer.from([0xd6, 0xd0, 0xce, 0xc4]));
    call.finish(124);
  });
  const result = await new NodeCommandRunner().run(taskCommand, ["/Query"]);
  assert.equal(result.exitCode, 124);
  assert.equal(result.stderr, "中文");
});

test("Windows concurrent lookup budgets are independent", windowsOnly, async (t) => {
  const calls = mockCommands(t, (call) => {
    if (/cmd\.exe$/i.test(call.command)) {
      const timer = setTimeout(() => replyCodePage(call, 936), 50);
      t.after(() => clearTimeout(timer));
      return;
    }
    call.child.stdout.write(Buffer.from([0xd6, 0xd0, 0xce, 0xc4]));
    call.finish();
  });
  const runner = new NodeCommandRunner();
  const [short, long] = await Promise.all([
    runner.run(taskCommand, ["short"], { timeoutMs: 10 }),
    runner.run(taskCommand, ["long"], { timeoutMs: 2000 })
  ]);
  assert.equal(short.exitCode, 124);
  assert.equal(long.stdout, "中文");
  assert.equal(calls.filter((call) => call.command === taskCommand).length, 1);
});
