import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentExecutor } from "@mininglamp-oss/octo-runtime/executor-core";
import { createCodexAdapter } from "@mininglamp-oss/octo-runtime/adapters/codex";
import {
  createExtraService,
  createKernelService,
  componentEndpoint,
  type ExtraExecution,
  type ExtraServiceOptions
} from "@mininglamp-oss/octo-runtime/host";
import type {
  ExtraContext,
  ExtraExecutionContext,
  HostFrame,
  CanonicalEvent,
  InvokeInput
} from "@mininglamp-oss/octo-runtime/extra";
import * as gateway from "@mininglamp-oss/octo-runtime/extras/channel-gateway";

// 严格类型验收只在本专项编译，不加入默认 CI selector；反例函数不在运行期执行。
export function configurationTypes(
  executor: AgentExecutor,
  context: ExtraContext,
  input: InvokeInput
) {
  const direct: ExtraExecution = { kind: "direct", executor };
  const ipc: ExtraExecution = { kind: "ipc", endpoint: "/tmp/example.sock" };
  const options: ExtraServiceOptions = {
    execution: direct,
    module: gateway,
    config: {},
    dependencies: {}
  };
  // @ts-expect-error direct 禁止 endpoint，包括 exactOptionalPropertyTypes 下的 undefined。
  const mixed: ExtraExecution = { kind: "direct", executor, endpoint: undefined };
  // @ts-expect-error ipc 禁止 executor。
  const mixedIpc: ExtraExecution = { kind: "ipc", endpoint: "socket", executor };
  // @ts-expect-error 不能同时提供新旧执行选择。
  const both: ExtraServiceOptions = { ...options, endpoint: "/tmp/example.sock" };
  // @ts-expect-error 必须提供执行选择。
  const missing: ExtraServiceOptions = { module: gateway, config: {}, dependencies: {} };
  // @ts-expect-error IPC 兼容入口只在 IPC 存在。
  void context.kernel.list();
  if (context.kernel) void context.kernel.list();
  const native: AsyncGenerator<HostFrame> = context.execution.invoke({
    ...input,
    protocol_mode: "native"
  });
  const canonical: AsyncGenerator<CanonicalEvent> = context.execution.invoke({
    ...input,
    protocol_mode: "canonical"
  });
  // @ts-expect-error canonical 不能作为 native 输出。
  const wrong: AsyncGenerator<HostFrame> = canonical;
  void [ipc, mixed, mixedIpc, both, missing, native, wrong];
}

const fake = process.argv[3]!;
const adapter = () => createCodexAdapter({ command: process.execPath, appServerArgs: [fake] });
if (process.argv[2] === "kernel") {
  // 独立消费者验收：此进程是显式 Kernel 宿主，不是产品执行 worker。
  const home = process.argv[4]!;
  const kernel = createKernelService({
    home,
    endpoint: componentEndpoint(home),
    adapters: [adapter()]
  });
  await kernel.initialize();
  process.send?.({ ready: true, pid: process.pid });
  await once(process, "message");
  const result = await kernel.close();
  process.send?.({ closed: result.complete });
  process.disconnect?.();
  assert.equal(result.complete, true);
} else {
  const executor = new AgentExecutor();
  executor.register(adapter());
  const home = await mkdtemp("/tmp/public-extra-312-");
  const child = fork(fileURLToPath(import.meta.url), ["kernel", fake, home], {
    stdio: ["ignore", "pipe", "pipe", "ipc"]
  });
  const exited = once(child, "exit");
  let diagnostics = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    diagnostics = (diagnostics + chunk.toString()).slice(-4000);
  });
  const ready = await Promise.race([
    once(child, "message"),
    exited.then(() => {
      throw new Error("KERNEL_HOST_EXITED", { cause: diagnostics });
    })
  ]);
  assert.equal((ready[0] as { ready: boolean }).ready, true);
  assert.notEqual((ready[0] as { pid: number }).pid, process.pid);
  try {
    for (const selection of [
      { kind: "direct", executor },
      { kind: "ipc", endpoint: componentEndpoint(home) }
    ] as const) {
      const channel = createExtraService({
        execution: selection,
        home,
        module: gateway,
        config: { bots: [] },
        dependencies: {}
      });
      // direct 真正省略 Home；Channel 与测试消费者共享宿主的同一执行器。
      const directChannel =
        selection.kind === "direct"
          ? createExtraService({
              execution: selection,
              module: gateway,
              config: { bots: [] },
              dependencies: {}
            })
          : channel;
      let execution!: ExtraExecutionContext;
      const consumer = createExtraService({
        execution: selection,
        home,
        module: {
          name: "public-consumer",
          default(ctx) {
            execution = ctx.execution;
            return () => {};
          }
        },
        config: {},
        dependencies: {}
      });
      try {
        await directChannel.initialize();
        await consumer.initialize();
        const input: InvokeInput = {
          inputs: [{ type: "text", text: "normal" }],
          contexts: {
            schema: "octo.context-envelope/v3",
            items: [{ namespace: "octo.execution", name: "adapter", payload: { type: "codex" } }]
          },
          workdir: home,
          approvalMode: "full_access"
        };
        let completed = false;
        for await (const frame of execution.invoke({ ...input, protocol_mode: "native" }))
          if (
            frame.kind === "control" &&
            frame.control.type === "state" &&
            frame.control.state === "completed"
          )
            completed = true;
        assert.equal(completed, true);
        assert.equal((await directChannel.status()).execution.kind, selection.kind);
      } finally {
        assert.equal((await consumer.close()).complete, true);
        assert.equal((await directChannel.close()).complete, true);
      }
    }
    assert.equal(executor.status().available, true);
    console.log(
      JSON.stringify({
        direct: "pass",
        independentKernelIpc: "pass",
        publicCodex: "pass",
        strictTypes: "pass"
      })
    );
  } finally {
    assert.equal((await executor.shutdown()).cleanup, "complete");
    const closed = once(child, "message");
    child.send("close");
    assert.equal(((await closed)[0] as { closed: boolean }).closed, true);
    const [code] = await exited;
    assert.equal(code, 0);
    await rm(home, { recursive: true, force: true });
  }
}
