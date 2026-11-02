import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { kernelFixture } from "../kernel-fixture.js";

for (const mode of ["native", "canonical"])
  test(
    `${mode}: Kernel public invoke preserves approvals and local failure`,
    { timeout: 15000 },
    async (t) => {
      const f = await kernelFixture(t, {
        // 此用例刻意让一个 fake Provider 清理失败，原生 Kernel 必须保留 incomplete。
        expectedCleanupComplete: false,
        adapters: (
          await import(
            (await import("node:url")).pathToFileURL(
              resolve("test/manual/codex-approval-worker.mjs")
            ).href
          )
        ).adapters
      });
      const run = async (scenario) => {
        const events = [];
        for await (const event of f.client.invoke({
          invocationId: randomUUID(),
          runId: randomUUID(),
          inputs: [{ type: "text", text: scenario }],
          contexts: {
            schema: "octo.context-envelope/v3",
            items: [{ namespace: "octo.execution", name: "adapter", payload: { type: "codex" } }]
          },
          protocol_mode: mode,
          approvalMode: "full_access",
          workdir: process.cwd()
        }))
          events.push(event);
        return events;
      };
      // 同一 Kernel 上故障调用与成功调用并行，确保不回收共享内核或兄弟 Provider。
      const [success, failed, cleanupFailed] = await Promise.all([
        run("success"),
        run("transport-error"),
        run("transport-error-cleanup-error")
      ]);
      for (const result of [failed, cleanupFailed]) {
        const failure =
          mode === "native"
            ? result.find((event) => event.control?.type === "error")?.control.failure
            : result.at(-1).payload.failure;
        assert.equal(failure?.reasonCode, "CODEX_STDIN_WRITE_FAILED");
        assert.equal(failure.code, "OH-ADP-3004");
      }
      if (mode === "native") {
        assert.equal(success.at(-1).control.state, "completed");
        assert.equal(success.filter((e) => e.control?.status === "resolved").length, 256);
        assert.equal(failed.at(-1).control.state, "failed");
        const failure = failed.find((e) => e.control?.type === "error").control.failure;
        assert.equal(failure.reasonCode, "CODEX_STDIN_WRITE_FAILED");
        assert.equal(failure.code, "OH-ADP-3004");
      } else {
        assert.equal(success.at(-1).type, "run.completed");
        assert.equal(
          success.filter(
            (e) => e.type === "interaction.resolved" && e.payload.status === "resolved"
          ).length,
          256
        );
        assert.equal(failed.at(-1).type, "run.failed");
        assert.equal(failed.at(-1).payload.failure.reasonCode, "CODEX_STDIN_WRITE_FAILED");
      }
      const cleanup = await f.server.close();
      assert.equal(cleanup.complete, false);
      assert.deepEqual(cleanup.pendingResources, ["kernel"]);
    }
  );
