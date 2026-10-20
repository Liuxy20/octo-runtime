export const name = "startup-proxy";
export default function (context) {
  return async (dependencies) => {
    void dependencies.loadContexts({}, { signal: context.signal }).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 100));
    throw new Error("private-startup-error");
  };
}
