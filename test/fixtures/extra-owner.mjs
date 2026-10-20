import { startExtra } from "@mininglamp-oss/octo-runtime-host-sdk";

process.on("message", (message) => {
  if (message === "exit") process.exit(0);
});
const extra = await startExtra(JSON.parse(process.argv[2]));
process.send?.({ type: "ready" });
process.once("disconnect", () => void extra.stop());
