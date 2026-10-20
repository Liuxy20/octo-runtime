import assert from "node:assert/strict";
import { attachKernel, type KernelClient } from "@mininglamp-oss/octo-runtime/executor-kernel";
import type { InvokeInput, HostFrame, CanonicalEvent } from "@mininglamp-oss/octo-runtime/protocol";

export async function verifyKernelInvoke(endpoint: string, input: InvokeInput): Promise<void> {
  const client: KernelClient = attachKernel({ endpoint });
  try {
    const native: HostFrame[] = [];
    for await (const frame of client.invoke({
      ...input,
      invocationId: "direct-native",
      runId: "direct-native",
      protocol_mode: "native"
    })) {
      native.push(frame);
      // @ts-expect-error A native frame is not a canonical event.
      const event: CanonicalEvent = frame;
      void event;
    }
    assert.ok(native.some((frame) => frame.kind === "native"));
    const terminal = native.at(-1);
    assert.ok(terminal?.kind === "control" && terminal.control.type === "state");
    assert.equal(terminal.control.state, "completed");
    const canonical: CanonicalEvent[] = [];
    for await (const event of client.invoke({
      ...input,
      invocationId: "direct-canonical",
      runId: "direct-canonical",
      protocol_mode: "canonical"
    })) {
      canonical.push(event);
      // @ts-expect-error A canonical event has no source-frame identity.
      const frame: HostFrame = event;
      void frame;
    }
    assert.equal(canonical.at(-1)?.type, "run.completed");
    const variable: InvokeInput = {
      ...input,
      invocationId: "direct-variable",
      runId: "direct-variable"
    };
    for await (const value of client.invoke(variable)) {
      const union: HostFrame | CanonicalEvent = value;
      void union;
      // @ts-expect-error Variable mode must remain a union.
      const frame: HostFrame = value;
      void frame;
    }
    assert.deepEqual(client.invocations.snapshot(), []);
    assert.equal("stop" in client, false);
  } finally {
    client.close();
  }
}
