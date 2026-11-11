import type { KernelClient } from "@mininglamp-oss/octo-runtime-client";
import { InvokeInput, type CanonicalEvent } from "@mininglamp-oss/octo-runtime-client/protocol";

/** 消费同一调用到终态；业务方处理交互和投递，服务所有者负责最终关闭。 */
export async function invokeOnce(
  client: KernelClient,
  input: InvokeInput,
  consume: (event: CanonicalEvent) => void | Promise<void>,
  signal?: AbortSignal
): Promise<void> {
  InvokeInput.check(input);
  const { inputs: parts, sessionId, providerSession, agentEnv, ...content } = input;
  const run = client.invoke(
    { ...content, parts, protocol_mode: "canonical" },
    sessionId,
    providerSession,
    agentEnv
  );
  const interrupt = () => {
    void client.interrupt(run.invocationId).catch(() => undefined);
  };
  signal?.addEventListener("abort", interrupt, { once: true });
  if (signal?.aborted) interrupt();
  let outcome: string | undefined;
  try {
    for await (const event of run) {
      await consume(event);
      if (["run.completed", "run.failed", "run.cancelled"].includes(event.type))
        outcome = event.type;
    }
  } finally {
    signal?.removeEventListener("abort", interrupt);
  }
  if (outcome !== "run.completed") throw new Error(outcome ?? "RUN_TERMINAL_MISSING");
}
