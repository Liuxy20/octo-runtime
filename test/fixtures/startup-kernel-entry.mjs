import { appendFileSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";

const config = JSON.parse(readFileSync(process.argv[process.argv.indexOf("--config") + 1], "utf8"));
const record = (event, value) => {
  try {
    appendFileSync(
      join(config.stateDirectory, "startup-diagnostics"),
      `${JSON.stringify({ event, value })}\n`
    );
  } catch {}
};
process.on("uncaughtExceptionMonitor", (error) => record("uncaught", error.stack));
process.on("exit", (code) => record("exit", code));
process.on("disconnect", () => record("disconnect", true));
const execFile = childProcess.execFile;
childProcess.execFile = (file, args, options, callback) =>
  execFile(file, args, options, (error, stdout, stderr) => {
    record(file, { error: error?.message, stdout, stderr });
    callback(error, stdout, stderr);
  });
const spawn = childProcess.spawn;
childProcess.spawn = (...args) => {
  const child = spawn(...args);
  record("spawn", child.pid);
  child.on("exit", (code, signal) => record("child.exit", { pid: child.pid, code, signal }));
  child.stderr?.on("data", (data) => record("child.stderr", String(data)));
  return child;
};
for (const name of ["rename", "rm"]) {
  const operation = fs[name];
  fs[name] = async (...args) => {
    try {
      return await operation(...args);
    } catch (error) {
      record(name, { args, error: error.message });
      throw error;
    }
  };
}
syncBuiltinESMExports();
await import("../../packages/octo-runtime-executor-kernel/dist/entry.js");
