export const name = "channel-gateway";

export default function extra(context, config) {
  context.onDispose(() => {
    if (config.mode === "hang") return new Promise(() => {});
    throw new Error("DISPOSAL_FAILED");
  });
  return () => {
    setInterval(() => {}, 1000);
    if (config.mode === "startup-failure") throw new Error("STARTUP_FAILED");
  };
}
