import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { RuntimeLogging } from "../../packages/octo-runtime-adapter-sdk/dist/index.js";

const mode = process.env.OCTO_EXTRA_STARTUP_FIXTURE;
const pause = async (stage) => {
  process.send?.({ type: "fixture.stage", stage });
  await new Promise((resolve) => setTimeout(resolve, mode === "lease-late" ? 4400 : 300));
  if (process.connected) process.send?.({ type: "fixture.stage.finished", stage });
};
if (mode === "config") {
  const original = fs.readFile;
  fs.readFile = async (...args) => {
    if (String(args[0]) === process.env.OCTO_EXTRA_STARTUP_CONFIG) await pause("config");
    return original(...args);
  };
}
if (mode === "lease" || mode === "lease-late") {
  const original = fs.open;
  fs.open = async (...args) => {
    if (String(args[0]) === `${process.env.OCTO_EXTRA_STARTUP_ENDPOINT}.owner`)
      await pause("lease");
    return original(...args);
  };
}
if (mode === "unlink") {
  const original = fs.rm;
  fs.rm = async (...args) => {
    if (String(args[0]) === process.env.OCTO_EXTRA_STARTUP_ENDPOINT)
      throw Object.assign(new Error("fixture unlink failure"), { code: "EACCES" });
    return original(...args);
  };
}
const close = RuntimeLogging.prototype.close;
RuntimeLogging.prototype.close = function () {
  if (process.connected) process.send?.({ type: "fixture.logs.closed" });
  if (mode === "logs-close") return Promise.reject(new Error("fixture logging close failure"));
  return close.call(this);
};
syncBuiltinESMExports();
