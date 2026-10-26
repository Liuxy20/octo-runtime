import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

const level = process.argv[2];
if (level !== "leaf") {
  const child = spawn(
    process.execPath,
    [fileURLToPath(import.meta.url), level === "root" ? "branch" : "leaf"],
    {
      stdio: ["ignore", "ignore", "ignore", "ipc"]
    }
  );
  const [descendants] = await once(child, "message");
  process.send([child.pid, ...descendants]);
} else process.send([]);
setInterval(() => {}, 1000);
