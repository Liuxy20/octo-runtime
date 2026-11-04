import { createHash } from "node:crypto";
import { posix } from "node:path";
import {
  normalizeRuntimeHome,
  assertIpcEndpoint,
  assertRuntimePath
} from "@mininglamp-oss/octo-runtime-executor-kernel";

/** 按选定平台规范化 Home 字符串；Windows 忽略大小写，其他平台保留大小写，不访问文件系统。 */
export function normalizedHome(home: string, platform: NodeJS.Platform = process.platform): string {
  const absolute = normalizeRuntimeHome(home, platform);
  return platform === "win32" ? absolute.toLowerCase() : absolute;
}
export function homeHash(home: string, platform: NodeJS.Platform = process.platform): string {
  return createHash("sha256").update(normalizedHome(home, platform)).digest("hex").slice(0, 16);
}
/** 纯计算 Home 对应地址并检查传输预算；不准备目录，真实存在/权限由服务 initialize 再校验。 */
export function componentEndpoint(
  home: string,
  component = "executor-kernel",
  platform: NodeJS.Platform = process.platform
): string {
  if (!/^[a-z][a-z0-9-]{0,69}$/.test(component)) throw new Error("COMPONENT_INVALID");
  assertRuntimePath(normalizedHome(home, platform), "home", platform);
  const endpoint =
    platform === "win32"
      ? `\\\\.\\pipe\\octo-runtime-${component === "executor-kernel" ? "kernel" : component}-${homeHash(home, platform)}`
      : component === "executor-kernel"
        ? posix.join(normalizedHome(home, platform), "executor-kernel.sock")
        : posix.join(normalizedHome(home, platform), "sockets", `octo-runtime-${component}.sock`);
  assertIpcEndpoint(endpoint, platform);
  return endpoint;
}
export function componentServiceId(
  home: string,
  component: string,
  platform: NodeJS.Platform = process.platform
): string {
  if (!/^[a-z][a-z0-9-]{0,69}$/.test(component)) throw new Error("COMPONENT_INVALID");
  return `cn.mininglamp.octo-runtime.h${homeHash(home, platform)}.${component}`;
}
