import { randomUUID } from "node:crypto";
import type { KernelClient } from "@mininglamp-oss/octo-runtime/executor-kernel";
import type {
  InvokeInput,
  CanonicalEvent,
  InteractionRequestedPayload,
  InteractionResponse
} from "@mininglamp-oss/octo-runtime/protocol";
import { invokeOnce } from "./invoke.mts";

/** 用户界面决定回复；在原 client、原 invocation 下响应，并继续消费到终态。 */
export async function invokeInteractive(
  client: KernelClient,
  input: InvokeInput,
  ask: (request: InteractionRequestedPayload) => Promise<InteractionResponse>,
  consume: (event: CanonicalEvent) => void | Promise<void>
): Promise<void> {
  const invocationId = input.invocationId ?? randomUUID();
  await invokeOnce(client, { ...input, invocationId }, async (event) => {
    await consume(event);
    if (event.type === "interaction.requested") {
      const response = await ask(event.payload);
      await client.respondInteraction(invocationId, response);
    }
  });
}
