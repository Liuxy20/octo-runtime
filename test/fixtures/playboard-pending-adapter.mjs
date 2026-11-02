import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// 卡在真实顶层 import，并拥有跨进程组的两层后代；人工停止不得等待导出或调用工厂。
const mode = process.argv[2];
if (mode === "grandchild") {
  process.on("SIGINT", () => {});
  process.on("SIGTERM", () => {});
  setInterval(() => {}, 1000);
  process.send({ grandchild: process.pid });
} else {
  const child = spawn(
    process.execPath,
    [fileURLToPath(import.meta.url), mode === "child" ? "grandchild" : "child"],
    {
      detached: process.platform !== "win32",
      stdio: ["ignore", "ignore", "ignore", "ipc"]
    }
  );
  child.on("message", (ids) => {
    if (mode === "child") process.send({ ...ids, child: process.pid });
    else process.stderr.write(`PLAYBOARD_IMPORT_READY=${JSON.stringify(ids)}\n`);
  });
  if (mode === "child") {
    process.on("SIGINT", () => {});
    process.on("SIGTERM", () => {});
  }
  setInterval(() => {}, 1000);
}
await new Promise(() => {});
export const pendingAdapter = {};
