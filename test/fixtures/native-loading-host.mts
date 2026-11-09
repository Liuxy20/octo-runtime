import { withAgentEnvItems } from "@mininglamp-oss/octo-runtime-adapter-sdk";
import { testAdapter } from "./test-adapter.js";
import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readdir } from "node:fs/promises";
import { createKernelService } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { InvokeInput } from "@mininglamp-oss/octo-runtime-protocol";
// SDK 宿主直接构造服务；Adapter、Core、Kernel 和 Extra 均在本进程，调用仍走 RPC。
const home = process.cwd();
const endpoint =
  process.platform === "win32" ? `\\\\.\\pipe\\octo-native-${process.pid}` : join(home, "k.sock");
const kernel = createKernelService({
  home,
  endpoint,
  adapters: [
    testAdapter as unknown as import("@mininglamp-oss/octo-runtime-executor-kernel").HostedAdapter
  ]
});
try {
  await kernel.initialize();
  assert.equal((await kernel.status()).pid, process.pid);
  const input = InvokeInput.check({
    inputs: [{ type: "text", text: "native-selected" }],
    agentEnv: withAgentEnvItems(
      {
        ...{
          schema: "octo.context-envelope/v3",
          items: [{ namespace: "octo.execution", name: "adapter", payload: { type: "test" } }]
        }
      },
      [
        { namespace: "octo.execution", name: "workspace", payload: { path: home } },
        { namespace: "octo.security", name: "approval_policy", payload: { mode: "full_access" } }
      ]
    )
  });
  const events = [];
  const { inputs: parts, sessionId, providerSession, agentEnv, ...content } = input;
  for await (const event of kernel.client.invoke(
    { ...content, parts, protocol_mode: "canonical" },
    sessionId,
    providerSession,
    agentEnv
  ))
    events.push(event);
  assert.equal(events.at(-1)?.type, "run.completed");
  const cancelled = kernel.client.invoke(
    {
      ...content,
      parts: [{ type: "text", text: "wait-for-cancel" }],
      protocol_mode: "canonical"
    },
    sessionId,
    providerSession,
    agentEnv
  );
  const timer = setTimeout(() => {
    void kernel.client.interrupt(cancelled.invocationId, "selected-cancel");
  }, 100);
  try {
    const cancelledEvents = [];
    for await (const event of cancelled) cancelledEvents.push(event);
    assert.equal(cancelledEvents.at(-1)?.type, "run.cancelled");
  } finally {
    clearTimeout(timer);
  }
  assert.equal((await kernel.client.status()).execution_ready, true);
} finally {
  assert.equal((await kernel.close()).complete, true);
}
assert.ok((await readdir(home)).every((name) => !name.includes("manifest")));
console.log("Native SDK selection, invocation, cancellation, caller PID and cleanup passed.");
