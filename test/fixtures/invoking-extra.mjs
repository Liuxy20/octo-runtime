export const name = "invoking";
export default function extra(ctx, config) {
  return async () => {
    let state = "starting";
    const execution = (async () => {
      for await (const event of ctx.adapterHost.invoke(config.input, { signal: ctx.signal })) {
        state = event.type;
      }
    })().catch((error) => {
      if (!ctx.signal.aborted) throw error;
    });
    void execution.catch(() => {
      state = "failed";
    });
    ctx.onStatus(() => ({ state }));
    ctx.onDispose(() => execution);
  };
}
