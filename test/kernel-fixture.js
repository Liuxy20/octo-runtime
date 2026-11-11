import { withAgentEnvItems } from "../packages/octo-runtime-adapter-sdk/dist/index.js";
import { testAdapter } from "./fixtures/test-adapter.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { attachKernel, createKernelService } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { invocationInput } from "@mininglamp-oss/octo-runtime-protocol";
import { componentEndpoint } from "@mininglamp-oss/octo-runtime-host-sdk";
import { invokeRequest } from "./runtime-fixture.js";
export async function kernelFixture(t, overrides = {}) {
  const { expectedCleanupComplete = true, ...configuration } = overrides;
  const directory = await mkdtemp(join(tmpdir(), "ok-"));
  const endpoint =
    process.platform === "win32" ? componentEndpoint(directory) : join(directory, "k.sock");
  let server, client, cleanup;
  const close = () =>
    (cleanup ??= (async () => {
      client?.close();
      const result = await server?.close();
      if (result && result.complete !== expectedCleanupComplete)
        throw new Error("Kernel fixture cleanup incomplete", { cause: result });
      await rm(directory, { recursive: true, force: true });
    })());
  // 构造和初始化也可能失败；同一清理操作既负责立即回滚，也负责测试结束后的收尾。
  t.after(close);
  try {
    server = createKernelService({
      home: directory,
      endpoint,
      adapters: [testAdapter],
      ...configuration
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
export const kernelInput = (prompt = "kernel fixture", fields = {}) => {
  if (fields.agentEnv !== undefined) withAgentEnvItems(fields.agentEnv, []);
  return invocationInput(
    invokeRequest({
      prompt,
      runId: randomUUID(),
      invocationId: randomUUID(),
      ...fields,
      // full_access 是测试调用方基线；调用者显式提交的审批条目拥有最终决定权。
      agentEnv: withAgentEnvItems(
        withAgentEnvItems(undefined, [
          { namespace: "octo.security", name: "approval_policy", payload: { mode: "full_access" } }
        ]),
        fields.agentEnv?.items ?? []
      )
    }),
    "canonical",
    "test"
  );
};
export async function frames(client, ref, cursor = 0) {
  const result = [];
  for await (const frame of client.subscribe(ref, cursor)) result.push(frame);
  return result;
}
