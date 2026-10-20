import { attachKernel, type RunRef } from "@mininglamp-oss/octo-runtime-executor-kernel";
import {
  createInputInvoke,
  identifyInvokeInput,
  type InvokeInput,
  type InvokeEnvironment
} from "@mininglamp-oss/octo-runtime-protocol";
import type { ExtraAdapterHost } from "./extras.js";

/** 每个 Extra 只控制自己接纳的执行，业务调用不接触 Kernel 的进程生命周期。 */
export function createExtraPort(endpoint: string, owner: AbortSignal) {
  const client = attachKernel({ endpoint });
  const refs = new Map<string, RunRef>();
  const starting = new Set<Promise<unknown>>();
  let acceptanceUnknown = false;
  const invokeFrames = async function* (input: InvokeInput, environment: InvokeEnvironment = {}) {
    owner.throwIfAborted();
    if (refs.size + starting.size >= 128) throw new Error("EXTRA_RUN_CAPACITY_EXHAUSTED");
    const identified = identifyInvokeInput(input);
    if (refs.has(identified.invocationId)) throw new Error("EXECUTION_IDENTITY_CONFLICT");
    const accepted = client.submit(identified, {
      ...environment,
      signal: AbortSignal.any([owner, ...(environment.signal ? [environment.signal] : [])])
    });
    starting.add(accepted);
    let ref: RunRef;
    try {
      ref = (await accepted).ref;
      refs.set(identified.invocationId, ref);
    } catch (error) {
      if (error instanceof Error && error.message === "ACCEPTANCE_UNKNOWN")
        acceptanceUnknown = true;
      throw error;
    } finally {
      starting.delete(accepted);
    }
    const cancel = () => {
      void client.cancel(ref, "caller_aborted").catch(() => undefined);
    };
    environment.signal?.addEventListener("abort", cancel, { once: true });
    if (environment.signal?.aborted) cancel();
    try {
      yield* client.subscribe(ref);
      refs.delete(identified.invocationId);
    } finally {
      environment.signal?.removeEventListener("abort", cancel);
    }
  };
  const port: ExtraAdapterHost = {
    list: () => client.list(),
    invoke: createInputInvoke(invokeFrames),
    async cancel(id, reason) {
      const ref = refs.get(id);
      return { cancelled: ref ? (await client.cancel(ref, reason)).accepted : false };
    },
    async respondInteraction(id, response) {
      const ref = refs.get(id);
      if (!ref) throw new Error("EXTRA_INVOCATION_NOT_ACTIVE");
      await client.respond(ref, response);
    }
  };
  const cancelOwned = async (): Promise<void> => {
    await Promise.allSettled([...starting]);
    const result = await Promise.allSettled(
      [...refs.values()].map(async (ref) => {
        await client.cancel(ref, "Extra shutdown");
        for await (const frame of client.subscribe(ref)) void frame;
      })
    );
    refs.clear();
    if (acceptanceUnknown || result.some((item) => item.status === "rejected"))
      throw new Error("EXTRA_RUN_CLEANUP_INCOMPLETE");
  };
  return {
    port,
    cancelOwned,
    disconnect: () => client.close(),
    async close(): Promise<void> {
      try {
        await cancelOwned();
      } finally {
        client.close();
      }
    }
  };
}
