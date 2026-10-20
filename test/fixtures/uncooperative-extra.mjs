import { writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";

export const name = "uncooperative";
export default function (context, config) {
  const handle = setInterval(() => {}, 100);
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 100)"], {
    stdio: "ignore",
    windowsHide: true
  });
  if (config.mode === "unref") child.unref();
  context.onDispose(async () => {
    await writeFile(config.disposed, "disposing");
    if (config.mode === "dispose") await new Promise(() => {});
    if (config.mode !== "unref") child.kill();
    clearInterval(handle);
  });
  return async () => {
    await writeFile(config.pidFile, JSON.stringify({ extra: process.pid, child: child.pid }));
    if (config.mode === "initialize") await new Promise(() => {});
  };
}
