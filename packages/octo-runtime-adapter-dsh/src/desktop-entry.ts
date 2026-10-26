import { isAbsolute } from "node:path";

// 官方 Client 用 Node 启动 dshBin；execve 保留其拥有的 PID 和 stdio，交给 Electron 解析 asar。
// 不创建代理进程，也不读取、编码或转发 JSON-RPC。此入口只用于 macOS Desktop。
const binary = process.env.OCTO_DSH_DESKTOP_BINARY;
const entry = process.env.OCTO_DSH_DESKTOP_ENTRY;
if (process.platform !== "darwin" || !binary || !entry || !isAbsolute(binary) || !isAbsolute(entry))
  throw new Error("DSH_CONFIG_INVALID: invalid Desktop launch paths");
if (!process.execve) throw new Error("DSH_START_FAILED: Desktop requires Node execve support");
const env = { ...process.env };
delete env.OCTO_DSH_DESKTOP_BINARY;
delete env.OCTO_DSH_DESKTOP_ENTRY;
process.execve(binary, [binary, entry, ...process.argv.slice(2)], {
  ...env,
  ELECTRON_RUN_AS_NODE: "1"
});
