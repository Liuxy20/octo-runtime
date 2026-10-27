import { createHash } from "node:crypto";
import { posix, win32 } from "node:path";

/** 按选定平台规范化 Home 字符串；Windows 忽略大小写，其他平台保留大小写，不访问文件系统。 */
export function normalizedHome(home: string, platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? win32.resolve(home).toLowerCase() : posix.resolve(home);
}
export function homeHash(home: string, platform: NodeJS.Platform = process.platform): string {
  return createHash("sha256").update(normalizedHome(home, platform)).digest("hex").slice(0, 16);
}
/** 按 Home 和组件派生本地 IPC 地址；平台路径差异在内部处理，无需调用方转换路径。 */
export function componentEndpoint(
  home: string,
  component = "executor-kernel",
  platform: NodeJS.Platform = process.platform
): string {
  if (!/^[a-z][a-z0-9-]{0,69}$/.test(component)) throw new Error("COMPONENT_INVALID");
  return platform === "win32"
    ? `\\\\.\\pipe\\octo-runtime-${component === "executor-kernel" ? "kernel" : component}-${homeHash(home, platform)}`
    : posix.join(normalizedHome(home, platform), "sockets", `octo-runtime-${component}.sock`);
}
export function componentServiceId(
  home: string,
  component: string,
  platform: NodeJS.Platform = process.platform
): string {
  if (!/^[a-z][a-z0-9-]{0,69}$/.test(component)) throw new Error("COMPONENT_INVALID");
  return `cn.mininglamp.octo-runtime.h${homeHash(home, platform)}.${component}`;
}
