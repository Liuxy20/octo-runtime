import { testAdapter as faultAdapter } from "./fixtures/pipe-fault-adapter.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { kernelFixture, kernelInput, frames } from "./kernel-fixture.js";

test(
  "native Kernel survives Provider spawn/output faults with an active sibling and later invocations",
  {
    timeout: 90_000
  },
  async (t) => {
    const f = await kernelFixture(t, {
      adapters: [faultAdapter]
    });
    const before = await f.client.status();
    const gate = join(f.directory, "release-sibling");
    const sibling = await f.client.submit(kernelInput("sibling", { runMetadata: { gate } }));
    const observer = f.client.subscribe(sibling.ref);
    while (true) {
      const { value, done } = await observer.next();
      assert.equal(done, false);
      if (value.kind === "canonical" && value.event.type === "message.delta") break;
    }
    for (const fault of ["missing", "stdout", "stderr"]) {
      const failed = await f.client.submit(kernelInput(fault));
      const events = await frames(f.client, failed.ref);
      assert.equal(events.at(-1).control.state, "failed", JSON.stringify(events));
      const current = await f.client.status();
      assert.equal(current.execution_ready, true);
      assert.equal(current.kernel_instance_id, before.kernel_instance_id);
      assert.equal(current.pid, before.pid);
    }
    if (process.platform === "win32") {
      // 不改系统 long-path 策略；长 cwd 在旧 Windows 上产生真实 ENOENT/ENOTCONN，支持时正常完成。
      let longCwd = f.directory;
      while (longCwd.length < 277) longCwd = join(longCwd, "long-cwd-segment");
      await mkdir(longCwd, { recursive: true });
      const native = await f.client.submit(kernelInput("normal", { workdir: longCwd }));
      const result = await frames(f.client, native.ref);
      const state = result.at(-1).control.state;
      assert.ok(["failed", "completed"].includes(state), JSON.stringify(result));
      if (state === "failed") {
        assert.ok(
          result.some(
            (frame) =>
              frame.kind === "canonical" &&
              frame.event.type === "run.failed" &&
              ["ENOENT", "ENOTCONN"].includes(frame.event.payload.code)
          ),
          JSON.stringify(result)
        );
      }
      t.diagnostic(`native Windows cwd length=${longCwd.length}, outcome=${state}`);
      assert.equal((await f.client.status()).kernel_instance_id, before.kernel_instance_id);
      assert.equal((await f.client.status()).pid, before.pid);
    }
    await writeFile(gate, "release");
    const tail = await Array.fromAsync(observer);
    assert.equal(tail.at(-1).control.state, "completed");
    const next = await f.client.submit(kernelInput("normal"));
    assert.equal((await frames(f.client, next.ref)).at(-1).control.state, "completed");
    const cleanup = await f.server.close();
    assert.equal(cleanup.complete, true, JSON.stringify(cleanup));
  }
);
