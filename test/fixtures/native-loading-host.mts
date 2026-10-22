import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readdir } from "node:fs/promises";
import { createKernelService } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { createExtraService } from "@mininglamp-oss/octo-runtime-host-sdk";
import { InvokeInput } from "@mininglamp-oss/octo-runtime-protocol";
import * as selectedExtra from "./native-loading-extra.mjs";

// SDK 宿主直接构造服务；只有执行 worker 使用内部子进程，Extra 与宿主函数在本进程。
const home = process.cwd();
const endpoint =
  process.platform === "win32" ? `\\\\.\\pipe\\octo-native-${process.pid}` : join(home, "k.sock");
const kernel = createKernelService({
  endpoint,
  workerEntrypoint: fileURLToPath(new URL("./native-worker.mjs", import.meta.url))
});
let released = false;
const extra = createExtraService({
  endpoint,
  module: selectedExtra,
  config: {},
  dependencies: {
    readValue: () => "native",
    released: () => {
      released = true;
    }
  }
});
try {
  await kernel.initialize();
  await extra.initialize();
  assert.equal((await kernel.status()).pid, process.pid);
  assert.equal((await extra.status()).pid, process.pid);
  assert.deepEqual((await extra.status()).plugin, { value: "native", pid: process.pid });
  const input = InvokeInput.check({
    approvalMode: "full_access",
    workdir: home,
    inputs: [{ type: "text", text: "native-selected" }],
    contexts: {
      schema: "octo.context-envelope/v3",
      items: [{ namespace: "octo.execution", name: "adapter", payload: { type: "test" } }]
    }
  });
  const events = [];
  for await (const event of kernel.client.invoke({ ...input, protocol_mode: "canonical" }))
    events.push(event);
  assert.equal(events.at(-1)?.type, "run.completed");
  const cancellation = new AbortController();
  const cancelled = kernel.client.invoke(
    {
      ...input,
      inputs: [{ type: "text", text: "wait-for-cancel" }],
      protocol_mode: "canonical"
    },
    { signal: cancellation.signal }
  );
  const timer = setTimeout(() => cancellation.abort(new Error("selected-cancel")), 100);
  try {
    await assert.rejects(async () => {
      for await (const event of cancelled) void event;
    }, /selected-cancel/);
  } finally {
    clearTimeout(timer);
  }
  assert.equal((await extra.close()).complete, true);
  assert.equal(released, true);
  assert.equal((await kernel.client.status()).execution_ready, true);
} finally {
  await extra.close();
  assert.equal((await kernel.close()).complete, true);
}
assert.ok((await readdir(home)).every((name) => !name.includes("manifest")));
console.log("Native SDK selection, invocation, cancellation, caller PID and cleanup passed.");
