import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { componentEndpoint, createKernelService } from "@mininglamp-oss/octo-runtime/host";
import { adapters } from "./worker.mjs";
import { verifyKernelInvoke } from "./kernel-invoke.mjs";

const home = resolve("public-sdk-home");
await mkdir(home, { recursive: true });
const endpoint = componentEndpoint(home);
const kernel = createKernelService({ home, endpoint, adapters });
try {
  await kernel.initialize();
  await verifyKernelInvoke(endpoint, {
    inputs: [{ type: "text", text: "public SDK" }],
    agentEnv: {
      workdir: process.cwd(),
      schema: "octo.context-envelope/v3",
      items: [
        { namespace: "octo.execution", name: "adapter", payload: { type: "release-fixture" } },
        { namespace: "octo.security", name: "approval_policy", payload: { mode: "full_access" } }
      ]
    }
  });
  assert.equal((await kernel.client.status()).execution_ready, true);
} finally {
  assert.equal((await kernel.close()).complete, true);
}
