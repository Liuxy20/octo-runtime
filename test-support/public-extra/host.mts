import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { startOwnedKernel, startExtra, componentEndpoint } from "@mininglamp-oss/octo-runtime/host";
import { attachKernel, type RunRef } from "@mininglamp-oss/octo-runtime/executor-kernel";
import { type InvokeInput } from "@mininglamp-oss/octo-runtime/protocol";
import type { JsonObject } from "@mininglamp-oss/octo-runtime/extra";

const endpoint = componentEndpoint(resolve("h"));
const owner = await startOwnedKernel({
  endpoint,
  workerEntrypoint: resolve("compiled/worker.mjs")
});
try {
  const client = attachKernel({ endpoint });
  try {
    const input: InvokeInput = {
      inputs: [{ type: "text", text: "release" }],
      contexts: {
        schema: "octo.context-envelope/v3",
        items: [
          { namespace: "octo.execution", name: "adapter", payload: { type: "release-fixture" } },
          { namespace: "octo.security", name: "approval_policy", payload: { mode: "full_access" } }
        ]
      },
      protocol_mode: "native",
      invocationId: "release-native",
      runId: "release-native-run"
    };
    const { ref }: { ref: RunRef } = await client.submit(input);
    client.close();
    const observer = attachKernel({ endpoint });
    try {
      const frames = [];
      for await (const frame of observer.subscribe(ref)) frames.push(frame);
      assert.equal(frames.at(-1)?.kind, "control");
      const terminal = (await observer.get(ref)).terminal;
      assert.ok(terminal?.kind === "control" && terminal.control.type === "state");
      assert.equal(terminal.control.state, "completed");
      assert.equal("stop" in observer, false);
    } finally {
      observer.close();
    }
    const extra = await startExtra({
      endpoint,
      declaration: {
        name: "public-extra",
        module: resolve("compiled/plugin.mjs"),
        config: {
          resultFile: resolve("result.json"),
          input: JSON.parse(
            JSON.stringify({ ...input, invocationId: "release-extra", runId: "release-extra-run" })
          ) as JsonObject
        }
      }
    });
    try {
      const result = JSON.parse(await readFile("result.json", "utf8")) as { terminal: string };
      assert.equal(result.terminal, "run.completed");
      assert.equal((await owner.client.status()).execution_ready, true);
    } finally {
      assert.equal((await extra.stop()).complete, true);
    }
    assert.equal((await owner.client.status()).execution_ready, true);
  } finally {
    client.close();
  }
} finally {
  assert.equal((await owner.stop()).complete, true);
}
