import { writeFile } from "node:fs/promises";

if (process.env.OCTO_EXTRA_STARTUP_FIXTURE === "import") {
  process.send?.({ type: "fixture.stage", stage: "import" });
  await new Promise((resolve) => setTimeout(resolve, 300));
  if (process.connected) process.send?.({ type: "fixture.stage.finished", stage: "import" });
}
export const name = "startup";
export default function (context, config) {
  context.onStatus(() => ({ phase: "ready" }));
  context.onDispose(async () => {
    await writeFile(config.disposed, "disposed");
    if (config.failDispose) throw new Error("fixture disposal failure");
  });
  return async () => {
    await writeFile(config.started, "started");
    if (config.waitForAbort) {
      process.send?.({ type: "fixture.stage", stage: "initialize" });
      await new Promise((resolve) =>
        context.signal.addEventListener("abort", resolve, { once: true })
      );
    }
  };
}
