import { setTimeout as delay } from "node:timers/promises";
import { writeFile } from "node:fs/promises";
export const name = "invoking";
export default function extra(ctx, config) {
  return async () => {
    let state = "starting";
    const execution = (async () => {
      for await (const event of ctx.kernel.invoke(config.input, { signal: ctx.signal })) {
        state = event.type;
      }
      if (config.deliveryFile) {
        state = "delivering";
        await delay(150);
        await writeFile(config.deliveryFile, "delivered");
        state = "delivered";
      }
    })().catch((error) => {
      if (!ctx.signal.aborted) throw error;
    });
    void execution.catch(() => {
      state = "failed";
    });
    ctx.onStatus(() => ({ state }));
    ctx.onDispose(async () => {
      await execution;
      if (config.failDispose) throw new Error("DELIVERY_DISPOSE_FAILED");
    });
  };
}
