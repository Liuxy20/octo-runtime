import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import { waitFor } from "./runtime-fixture.js";

for (const signal of ["SIGTERM", "SIGINT"]) {
  test(
    `Windows child.kill(${signal}) is forced termination, separate from console cancellation`,
    { timeout: 5_000, skip: process.platform !== "win32" },
    async (t) => {
      const child = spawn(
        process.execPath,
        [
          "-e",
          `
        process.on('SIGTERM', () => process.stdout.write('HANDLED'));
        process.on('SIGINT', () => process.stdout.write('HANDLED'));
        setInterval(() => {}, 1000);
        process.stdout.write('ready');
      `
        ],
        { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }
      );
      t.after(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      });
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
      child.stderr.resume();
      const exited = once(child, "close");
      await waitFor(() => output.includes("ready"), 2_000);
      child.kill(signal);
      const [code, observedSignal] = await exited;
      assert.deepEqual({ code, signal: observedSignal }, { code: null, signal });
      assert.doesNotMatch(output, /HANDLED/);
      assert.throws(() => process.kill(child.pid, 0), { code: "ESRCH" });
      t.diagnostic(
        `forced child.kill: code=${code}, signal=${observedSignal}; JS handler not invoked`
      );
    }
  );
}
