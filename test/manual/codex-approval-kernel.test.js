import { withAgentEnvItems } from "../../packages/octo-runtime-adapter-sdk/dist/index.js";
import { invokeClient } from "../../test-support/invoke-client.js";
import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { kernelFixture } from "../kernel-fixture.js";
for (const mode of ["native", "canonical"])
  test(
    `${mode}: Kernel public invoke preserves approvals and local failure`,
    { timeout: 15000 },
    async (t) => {
      const { createApprovalHost } = await import("./codex-approval-worker.mjs");
      const host = createApprovalHost();
      t.after(() => host.owner.close({ deadline: performance.now() + 2500 }));
      const f = await kernelFixture(t, {
        // 此用例刻意让一个 fake Provider 清理失败，原生 Kernel 必须保留 incomplete。
        expectedCleanupComplete: false,
        adapters: host.adapters,
        serviceProcesses: () => host.owner.processes(),
        async finalizeHostResources(deadline) {
          if (!(await host.owner.close({ deadline })).complete)
            throw new Error("ENGINE_CLEANUP_INCOMPLETE");
        }
      });
      const run = async (scenario) => {
        const workdir = resolve(f.directory, scenario);
        await mkdir(workdir, { recursive: true });
        const events = [];
        for await (const event of invokeClient(f.client, {
          invocationId: randomUUID(),
          runId: randomUUID(),
          inputs: [{ type: "text", text: scenario }],
          agentEnv: withAgentEnvItems(
            {
              ...{
                schema: "octo.context-envelope/v3",
                items: [
                  { namespace: "octo.execution", name: "adapter", payload: { type: "codex" } }
                ]
              }
            },
            [
              { namespace: "octo.execution", name: "workspace", payload: { path: workdir } },
              {
                namespace: "octo.security",
                name: "approval_policy",
                payload: { mode: "full_access" }
              }
            ]
          ),
          protocol_mode: mode
        }))
          events.push(event);
        return events;
      };
      // fake 按调用方目录隔离服务；同一 Kernel 并行故障不能回收兄弟 Provider。
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
      host.owner.beginShutdown();
      const cleanup = await f.server.close();
      assert.equal(cleanup.complete, false);
      assert.deepEqual(cleanup.pendingResources, ["kernel"]);
    }
  );
