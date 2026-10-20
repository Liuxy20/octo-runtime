import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join, resolve } from "node:path";

const [home, mode] = process.argv.slice(2);
const endpoint = join(home, "kernel.sock");
const manifest = join(home, "kernel-invocations.json");
const remove = fs.rm;
let closing = false;
fs.rm = async (file, ...args) => {
  if (closing && file === (mode === "manifest" ? manifest : endpoint))
    throw Object.assign(new Error("fixture cleanup failure"), { code: "EACCES" });
  return remove(file, ...args);
};
syncBuiltinESMExports();
const { startKernelServer } = await import("@mininglamp-oss/octo-runtime-executor-kernel");
const server = await startKernelServer({
  endpoint,
  stateDirectory: home,
  workerEntrypoint: resolve("test/fixtures/direct-adapter-host.js")
});
const { worker } = JSON.parse(await fs.readFile(manifest, "utf8"));
closing = true;
let code;
try {
  await server.close();
} catch (error) {
  code = error.message;
}
process.on("message", () => process.disconnect());
process.send?.({ code, worker: worker.pid });
