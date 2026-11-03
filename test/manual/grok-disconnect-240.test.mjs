import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createProcessCleanup } from "../../packages/octo-runtime-adapter-sdk/dist/process-cleanup.js";
import { observeGrokFixture, withGrokOutputPipe } from "../../test-support/grok-build-fixture.mjs";

const fixture = fileURLToPath(new URL("../fixtures/grok-build-acp-host.mjs", import.meta.url));

// 手动专项：没有 Adapter 时先证明真正的管道 EOF；kill 只在观察完成后由本测试 disposer 发起。
for (const mode of ["disconnect", "disconnect_diagnostic"]) {
  test(
    `${mode}: real output EOF leaves the Provider alive before owned cleanup`,
    { timeout: 5000 },
    async (t) => {
      let observation;
      const originalSpawn = childProcess.spawn;
      const child = withGrokOutputPipe(
        () =>
          childProcess.spawn(process.execPath, [fixture], {
            env: { ...process.env, OCTO_GROK_FIXTURE: mode },
            detached: process.platform !== "win32"
          }),
        (child) => {
          observation = observeGrokFixture(child);
        }
      );
      assert.equal(childProcess.spawn, originalSpawn);
      const cleanup = createProcessCleanup(child, { processGroup: process.platform !== "win32" });
      t.after(async () => {
        observation.record("owned-cleanup-start");
        await cleanup();
        await observation.closed;
        for (const stream of [child.stdin, child.stdout, child.stderr])
          assert.equal(stream.destroyed, true);
        assert.throws(() => process.kill(child.pid, 0), /ESRCH/);
        t.diagnostic(JSON.stringify({ mode, pid: child.pid, events: observation.events }));
      });
      let output = "";
      let stderr = "";
      child.stdout.on("data", (value) => {
        output += value;
      });
      child.stderr.on("data", (value) => {
        stderr += value;
      });
      const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
      const eof = once(child.stdout, "end", { signal: t.signal });
      for (const [index, method] of [
        "initialize",
        "authenticate",
        "session/new",
        "session/prompt"
      ].entries()) {
        child.stdin.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: index + 1,
            method,
            params: { methodId: "cached_token", sessionId: "grok-session-1" }
          }) + "\n"
        );
        if (method !== "session/prompt") {
          const response = await lines.next();
          assert.equal(response.done, false);
          assert.equal(JSON.parse(response.value).id, index + 1);
        }
      }
      await eof;
      assert.deepEqual(
        output
          .trim()
          .split("\n")
          .map(JSON.parse)
          .map((entry) => entry.id),
        [1, 2, 3]
      );
      assert.equal(child.exitCode, null);
      assert.equal(child.signalCode, null);
      assert.doesNotThrow(() => process.kill(child.pid, 0));
      // 再经过一轮事件循环仍存活，避免仅凭 exit 回调尚未调度推断存活。
      await new Promise(setImmediate);
      assert.doesNotThrow(() => process.kill(child.pid, 0));
      assert.equal(observation.events.find((entry) => entry.event === "stdout-eof")?.alive, true);
      assert.equal(
        observation.events.some((entry) => entry.event === "exit"),
        false
      );
      assert.equal(
        stderr,
        mode === "disconnect_diagnostic" ? "CONFIG_INVALID: missing provider credential\n" : ""
      );
    }
  );
}

test("fixture spawn interception is restored when construction throws", () => {
  const originalSpawn = childProcess.spawn;
  const failure = new Error("fixture construction failure");
  assert.throws(
    () =>
      withGrokOutputPipe(() => {
        throw failure;
      }),
    (error) => error === failure
  );
  assert.equal(childProcess.spawn, originalSpawn);
});
