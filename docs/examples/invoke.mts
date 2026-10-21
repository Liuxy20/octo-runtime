import type { KernelClient } from "@mininglamp-oss/octo-runtime/executor-kernel";
import { InvokeInput, type CanonicalEvent } from "@mininglamp-oss/octo-runtime/protocol";

/** 消费同一调用到终态；业务方处理交互和投递，服务所有者负责最终关闭。 */
export async function invokeOnce(
  client: KernelClient,
  input: InvokeInput,
  consume: (event: CanonicalEvent) => void | Promise<void>,
  signal?: AbortSignal
): Promise<void> {
  InvokeInput.check(input);
  let outcome: string | undefined;
  for await (const event of client.invoke({ ...input, protocol_mode: "canonical" }, { signal })) {
    await consume(event);
    if (["run.completed", "run.failed", "run.cancelled"].includes(event.type)) outcome = event.type;
  }
  if (outcome !== "run.completed") throw new Error(outcome ?? "RUN_TERMINAL_MISSING");
}
