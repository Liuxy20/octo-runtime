import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createKernelService,
  createExtraService,
  componentEndpoint
} from "@mininglamp-oss/octo-runtime/host";
import * as plugin from "./plugin.mjs";
import { attachKernel, type RunRef } from "@mininglamp-oss/octo-runtime/executor-kernel";
import { type InvokeInput } from "@mininglamp-oss/octo-runtime/protocol";
import type { JsonObject, ExtraPluginModule } from "@mininglamp-oss/octo-runtime/extra";
import { verifyBuiltinExtras } from "./builtin-extras.mjs";
import { verifyKernelInvoke } from "./kernel-invoke.mjs";
import { verifyGatewayStore } from "./gateway-store.mjs";
import { recoveryProbe } from "./recovery-kernel-probe.mjs";

const endpoint = componentEndpoint(resolve("h"));
const owner = createKernelService({
  endpoint,
  workerEntrypoint: resolve("compiled/worker.mjs")
});
await owner.initialize();
assert.equal((await owner.client.status()).pid, process.pid);
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
    await verifyKernelInvoke(endpoint, input);
    assert.equal((await recoveryProbe(client, input)).confirmed, true);
    for await (const _frame of owner.client.invoke({
      ...input,
      invocationId: "owned-invoke",
      runId: "owned-invoke"
    }))
      void _frame;
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
      const native = [];
      for await (const frame of observer.invoke({
        ...input,
        protocol_mode: "native",
        invocationId: "public-native-invoke",
        runId: "public-native-invoke-run"
      }))
        native.push(frame);
      assert.ok(native.some((frame) => frame.kind === "native"));
      assert.equal(native.at(-1)?.kind, "control");
    } finally {
      observer.close();
    }
    const extra = createExtraService({
      endpoint,
      module: plugin,
      dependencies: {},
      config: {
        resultFile: resolve("result.json"),
        input: JSON.parse(
          JSON.stringify({ ...input, invocationId: "release-extra", runId: "release-extra-run" })
        ) as JsonObject
      }
    });
    await extra.initialize();
    assert.equal((await extra.status()).pid, process.pid);
    try {
      const result = JSON.parse(await readFile("result.json", "utf8")) as { terminal: string };
      assert.equal(result.terminal, "run.completed");
      assert.equal((await owner.client.status()).execution_ready, true);
      const database = new DatabaseSync(resolve("business.sqlite"));
      try {
        database.exec("CREATE TABLE business (text TEXT); INSERT INTO business VALUES ('kept')");
        interface Dependencies {
          read(): string;
        }
        class BusinessDependencies implements Dependencies {
          readonly #database: DatabaseSync;
          constructor(database: DatabaseSync) {
            this.#database = database;
          }
          read(): string {
            return String(this.#database.prepare("SELECT text FROM business").get()?.text);
          }
        }
        const module: ExtraPluginModule<Dependencies> = {
          name: "business-fixture",
          default(ctx) {
            const state = { text: "", pid: process.pid };
            ctx.onStatus(() => state);
            return (dependencies) => {
              state.text = dependencies.read();
            };
          }
        };
        const business = createExtraService({
          endpoint,
          module,
          config: {},
          dependencies: new BusinessDependencies(database)
        });
        await business.initialize();
        assert.equal((await business.status()).plugin.text, "kept");
        assert.equal((await business.status()).plugin.pid, process.pid);
        assert.equal((await business.close()).complete, true);
        assert.equal(database.prepare("SELECT text FROM business").get()?.text, "kept");
        await verifyBuiltinExtras(endpoint);
        await verifyGatewayStore(endpoint);
      } finally {
        database.close();
      }
    } finally {
      assert.equal((await extra.close()).complete, true);
    }
    assert.equal((await owner.client.status()).execution_ready, true);
  } finally {
    client.close();
  }
} finally {
  assert.equal((await owner.close()).complete, true);
}
