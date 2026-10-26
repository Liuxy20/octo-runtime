import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { attachKernel, createKernelService } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { invocationInput } from "@mininglamp-oss/octo-runtime-protocol";
import { componentEndpoint } from "@mininglamp-oss/octo-runtime-host-sdk";
import { invokeRequest } from "./runtime-fixture.js";
export async function kernelFixture(t, overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), "ok-"));
  const endpoint =
    process.platform === "win32" ? componentEndpoint(directory) : join(directory, "k.sock");
  let server, client, cleanup;
  const close = () =>
    (cleanup ??= (async () => {
      client?.close();
      const result = await server?.close();
      if (result && !result.complete)
        throw new Error("Kernel fixture cleanup incomplete", { cause: result });
      await rm(directory, { recursive: true, force: true });
    })());
  // 构造和初始化也可能失败；同一清理操作既负责立即回滚，也负责测试结束后的收尾。
  t.after(close);
  try {
    server = createKernelService({
      endpoint,
      workerEntrypoint: resolve("packages/octo-runtime-executor-kernel/dist/runner.js"),
      manifest: resolve("test/fixtures/adapters.json"),
      ...overrides
    });
    await server.initialize();
    client = attachKernel({ endpoint });
    return { directory, endpoint, server, client };
  } catch (error) {
    try {
      await close();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Kernel fixture initialization cleanup failed",
        {
          cause: error
        }
      );
    }
    throw error;
  }
}
export const kernelInput = (prompt = "kernel fixture", fields = {}) =>
  invocationInput(
    invokeRequest({
      prompt,
      runId: randomUUID(),
      invocationId: randomUUID(),
      approvalMode: "full_access",
      ...fields
    }),
    "canonical",
    "test"
  );
export async function frames(client, ref, cursor = 0) {
  const result = [];
  for await (const frame of client.subscribe(ref, cursor)) result.push(frame);
  return result;
}
