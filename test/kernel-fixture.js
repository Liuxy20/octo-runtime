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
  const server = createKernelService({
    endpoint,
    workerEntrypoint: resolve("packages/octo-runtime-executor-kernel/dist/runner.js"),
    manifest: resolve("test/fixtures/adapters.json"),
    ...overrides
  });
  await server.initialize();
  const client = attachKernel({ endpoint });
  t.after(async () => {
    client.close();
    await server.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, endpoint, server, client };
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
