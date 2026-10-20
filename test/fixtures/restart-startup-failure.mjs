import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const config = JSON.parse(
  await readFile(process.argv[process.argv.indexOf("--config") + 1], "utf8")
);
const path = join(config.stateDirectory, "launch-count");
const count = Number(await readFile(path, "utf8").catch(() => "0")) + 1;
await writeFile(path, String(count));
if (count > 1) {
  process.send({ type: "component.failed", error: "KERNEL_START_FAILED" });
  process.send({ type: "component.stopped", complete: false });
  process.disconnect();
} else {
  process.on("message", (message) => {
    if (message.type !== "component.stop") return;
    process.send({ type: "component.stopped", request_id: message.request_id, complete: true });
    process.disconnect();
  });
  process.send({ type: "component.ready" });
}
