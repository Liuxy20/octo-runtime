import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { trackRecoveryChild } from "./recovery-cleanup.mjs";

/** 外层拥有的进程登记，必须先登记退出与错误，再开始任何就绪等待。 */
export function launchRecoveryChild(children, component, args, env, ipc = false) {
  const child = spawn(process.execPath, args, {
    env,
    stdio: ["ignore", "pipe", "pipe", ...(ipc ? ["ipc"] : [])]
  });
  const entry = trackRecoveryChild(child, component);
  children.push(entry);
  if (ipc)
    entry.requestClose = () =>
      new Promise((resolve, reject) => {
        child.send({ command: "close" }, (error) => (error ? reject(error) : resolve()));
      });
  child.stdout.on("data", (chunk) => {
    entry.output = (entry.output + chunk).slice(-65536);
  });
  child.stderr.on("data", (chunk) => {
    entry.errors = (entry.errors + chunk).slice(-4096);
  });
  return entry;
}

/** Kernel 是独立依赖；返回的清理句柄仅由外层环境保存。 */
export function launchRecoveryKernel(children, endpoint, env, home) {
  return launchRecoveryChild(
    children,
    "executor-kernel",
    [resolve("test-support/recovery-kernel-host.mjs"), endpoint, home],
    env,
    true
  );
}

export function recoveryOutputRows(entry) {
  return entry.output.split("\n").flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}
