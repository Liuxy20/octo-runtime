import { createHash } from "node:crypto";
import { join, resolve, win32 } from "node:path";

export function normalizedHome(home: string, platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? win32.resolve(home).toLowerCase() : resolve(home);
}
export function homeHash(home: string, platform: NodeJS.Platform = process.platform): string {
  return createHash("sha256").update(normalizedHome(home, platform)).digest("hex").slice(0, 16);
}
export function componentEndpoint(
  home: string,
  component = "executor-kernel",
  platform: NodeJS.Platform = process.platform
): string {
  if (!/^[a-z][a-z0-9-]{0,69}$/.test(component)) throw new Error("COMPONENT_INVALID");
  return platform === "win32"
    ? `\\\\.\\pipe\\octo-runtime-${component === "executor-kernel" ? "kernel" : component}-${homeHash(home, platform)}`
    : join(normalizedHome(home), "sockets", `octo-runtime-${component}.sock`);
}
export function componentServiceId(
  home: string,
  component: string,
  platform: NodeJS.Platform = process.platform
): string {
  if (!/^[a-z][a-z0-9-]{0,69}$/.test(component)) throw new Error("COMPONENT_INVALID");
  return `cn.mininglamp.octo-runtime.h${homeHash(home, platform)}.${component}`;
}
