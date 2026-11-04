import { componentEndpoint } from "@mininglamp-oss/octo-runtime/host";
import { InvokeInput, type CanonicalEvent } from "@mininglamp-oss/octo-runtime/protocol";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createDshKernel } from "./dsh-service.mts";
import { invokeOnce } from "./invoke.mts";

/** 宿主创建本次服务和临时目录；消费真实终态并检查清理，不接管已有 Home。 */
export async function runDshExample(
  dshBin: string,
  consume: (event: CanonicalEvent) => void | Promise<void>,
  signal?: AbortSignal
): Promise<void> {
  if (!isAbsolute(dshBin)) throw new Error("DSH_BIN must be an absolute JavaScript entry path");
  const directory = await mkdtemp(join(process.platform === "darwin" ? "/tmp" : tmpdir(), "ord-"));
  const kernel = createDshKernel(directory, componentEndpoint(directory), dshBin);
  const errors: unknown[] = [];
  try {
    await kernel.initialize({ signal });
    const input = InvokeInput.check({
      invocationId: randomUUID(),
      inputs: [{ type: "text", text: "Reply with a short greeting without using tools." }],
      contexts: {
        schema: "octo.context-envelope/v3",
        items: [
          { namespace: "octo.execution", name: "adapter", payload: { type: "dsh" } },
          { namespace: "octo.security", name: "approval_policy", payload: { mode: "full_access" } }
        ]
      }
    });
    await invokeOnce(
      kernel.client,
      input,
      async (event) => {
        if (event.type === "interaction.requested") {
          await kernel.client.respondInteraction(input.invocationId!, {
            interactionId: event.payload.interactionId,
            outcome: "cancelled"
          });
        }
        await consume(event);
      },
      signal
    );
  } catch (error) {
    errors.push(error);
  } finally {
    try {
      const cleanup = await kernel.close();
      if (!cleanup.complete)
        errors.push(new Error("KERNEL_CLEANUP_INCOMPLETE", { cause: cleanup }));
      else await rm(directory, { recursive: true, force: true });
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, "DSH_EXAMPLE_FAILED");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const dshBin = process.env.DSH_BIN;
  if (!dshBin) throw new Error("Usage: DSH_BIN=<absolute JS entry> node dsh-invoke.mts");
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error("Interrupted"));
  process.once("SIGINT", cancel);
  try {
    await runDshExample(
      dshBin,
      (event) => {
        console.log(JSON.stringify(event));
      },
      controller.signal
    );
  } finally {
    process.removeListener("SIGINT", cancel);
  }
}
