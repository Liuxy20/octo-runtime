import { randomUUID } from "node:crypto";
import { attachKernel, type KernelClient } from "@mininglamp-oss/octo-runtime/executor-kernel";
import type { InvokeInput } from "@mininglamp-oss/octo-runtime/protocol";

/** Attach only: use unique execution identities, never replay unknown admission or expose bodies. */
export async function recoveryProbe(client: KernelClient, template: InvokeInput) {
  const input = { ...template, runId: randomUUID(), invocationId: randomUUID() };
  const before = await client.status();
  let lastSeq = 0;
  let terminal: string | undefined;
  const { ref } = await client.submit(input);
  for await (const frame of client.subscribe(ref)) {
    if (frame.seq !== lastSeq + 1) throw new Error("PROBE_SEQUENCE_GAP");
    lastSeq = frame.seq;
    if (frame.kind === "control" && frame.control.type === "state") terminal = frame.control.state;
  }
  const result = await client.get(ref);
  return { before, ref, lastSeq, terminal, confirmed: result.terminal !== undefined };
}

export async function recoveryMatrix(
  endpoint: string,
  oldInput: InvokeInput,
  freshInput: InvokeInput
) {
  const existing = attachKernel({ endpoint });
  try {
    // Callers can also retain their own client and use recoveryProbe across manual checkpoints.
    const baseline = await recoveryProbe(existing, oldInput);
    const fresh = attachKernel({ endpoint });
    try {
      const trials = [];
      for (const [clientKind, client] of [
        ["existing", existing],
        ["fresh", fresh]
      ] as const)
        for (const [sessionKind, input] of [
          ["existing", oldInput],
          ["fresh", freshInput]
        ] as const)
          trials.push({ clientKind, sessionKind, evidence: await recoveryProbe(client, input) });
      return { baseline, trials };
    } finally {
      fresh.close();
    }
  } finally {
    existing.close();
  }
}
