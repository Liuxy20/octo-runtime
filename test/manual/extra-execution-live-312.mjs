// 显式手动 non-gating：使用宿主现有 Codex 安装与认证，只打印终态和清理元数据。
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { AgentExecutor } from "@mininglamp-oss/octo-runtime/executor-core";
import { createCodexAdapter } from "@mininglamp-oss/octo-runtime/adapters/codex";
import {
  createExtraService,
  createKernelService,
  componentEndpoint
} from "@mininglamp-oss/octo-runtime/host";
if (process.argv[2] !== "--run")
  throw new Error("Explicit --run is required for real Provider requests");
const home = await mkdtemp("/tmp/extra-live-312-");
try {
  for (const kind of ["direct", "ipc"]) {
    const executor = kind === "direct" ? new AgentExecutor() : undefined;
    executor?.register(createCodexAdapter());
    const kernel = executor
      ? undefined
      : createKernelService({
          home,
          endpoint: componentEndpoint(home),
          adapters: [createCodexAdapter()]
        });
    let execution;
    const extra = createExtraService({
      ...(executor
        ? { execution: { kind, executor } }
        : { home, execution: { kind, endpoint: componentEndpoint(home) } }),
      module: {
        name: "live-verification",
        default(ctx) {
          execution = ctx.execution;
          return () => {};
        }
      },
      config: {},
      dependencies: {}
    });
    let terminal, extraCleanup, ownerCleanup;
    const started = Date.now();
    try {
      await kernel?.initialize();
      await extra.initialize();
      for await (const frame of execution.invoke(
        {
          inputs: [
            { type: "text", text: "Reply with exactly READY. Do not use tools or modify files." }
          ],
          contexts: {
            schema: "octo.context-envelope/v3",
            items: [{ namespace: "octo.execution", name: "adapter", payload: { type: "codex" } }]
          },
          workdir: home,
          approvalMode: "full_access",
          runtimeLimits: { runTimeoutMs: 60000 }
        },
        { signal: AbortSignal.timeout(65000) }
      )) {
        if (
          frame.kind === "control" &&
          frame.control.type === "state" &&
          frame.control.state !== "running"
        )
          terminal = frame.control.state;
      }
    } finally {
      extraCleanup = await extra.close();
      ownerCleanup = executor
        ? (await executor.shutdown()).cleanup === "complete"
        : (await kernel.close()).complete;
      console.log(
        JSON.stringify({
          kind,
          terminal: terminal ?? "unknown",
          extraCleanup: extraCleanup.complete,
          ownerCleanup,
          durationMs: Date.now() - started
        })
      );
    }
    assert.equal(terminal, "completed");
    assert.equal(extraCleanup.complete, true);
    assert.equal(ownerCleanup, true);
  }
} finally {
  await rm(home, { recursive: true, force: true });
}
