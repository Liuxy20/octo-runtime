export const name = "independent";
export default function (context, config) {
  let current = { pid: process.pid, count: 0, text: "", errors: [] };
  context.onStatus(() => current);
  return async (dependencies) => {
    const update = async () => {
      try {
        const items = await dependencies.loadContexts?.({}, { signal: context.signal });
        current = { ...current, text: items?.[0]?.payload.text ?? "", count: current.count + 1 };
      } catch (error) {
        current = { ...current, errors: [...current.errors, error.message].slice(-32) };
      }
    };
    if (config.pending) {
      for (let index = 0; index < 9; index++) void update();
    } else {
      await update();
      const timer = setInterval(() => void update(), 100);
      context.onDispose(() => clearInterval(timer));
    }
    context.onDispose(() => {
      if (config.failDispose) throw new Error("private-error-not-for-output");
    });
  };
}
