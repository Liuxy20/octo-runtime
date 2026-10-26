import assert from "node:assert/strict";
import test from "node:test";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawnJsonLines } from "../packages/octo-runtime-adapter-sdk/dist/index.js";

for (const pipe of ["stdout", "stderr"]) {
  test(`${pipe} errors and late cleanup errors remain invocation-local`, async (t) => {
    const child = Object.assign(new EventEmitter(), {
      pid: undefined,
      exitCode: null,
      signalCode: null,
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill() {
        this.exitCode = 1;
        setImmediate(() => {
          this.stdout.end();
          this.stderr.end();
          this.emit("close", 1, null);
        });
        return true;
      }
    });
    t.mock.method(childProcess, "spawn", () => child);
    syncBuiltinESMExports();
    t.after(() => {
      t.mock.restoreAll();
      syncBuiltinESMExports();
    });
    const fault = Object.assign(new Error(`read ${pipe} ENOTCONN`), { code: "ENOTCONN" });
    const result = Array.fromAsync(spawnJsonLines({ command: "fixture", parseLine: JSON.parse }));
    child[pipe].emit("error", fault);
    await assert.rejects(result, (error) => error === fault);
    assert.doesNotThrow(() => child.stdout.emit("error", fault));
    assert.doesNotThrow(() => child.stderr.emit("error", fault));
  });
}

test("native nonexistent command preserves spawn errno after output pipe errors", async () => {
  await assert.rejects(
    Array.fromAsync(
      spawnJsonLines({
        command: `octo-missing-${process.pid}-${Date.now()}`,
        input: "request\n",
        parseLine: JSON.parse
      })
    ),
    { code: "ENOENT" }
  );
});
