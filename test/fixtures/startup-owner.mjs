import { startOwnedKernel } from "@mininglamp-oss/octo-runtime-host-sdk";

process.on("message", (message) => {
  if (message === "exit") process.exit(0);
});
const kernel = await startOwnedKernel(JSON.parse(process.argv[2]));
process.send?.({ type: "ready" });
process.once("disconnect", () => void kernel.stop());
