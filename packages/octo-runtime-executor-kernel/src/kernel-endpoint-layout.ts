import { posix, win32 } from "node:path";

/** 只识别显式地址的布局，不选择 Home、不访问文件系统，也不对旧地址套用 IPC 预算。 */
export function isCanonicalKernelEndpoint(
  endpoint: string,
  platform: NodeJS.Platform = process.platform
): boolean {
  return (platform === "win32" ? win32 : posix).basename(endpoint) === "executor-kernel.sock";
}

/** 兼容租约使用旧布局的文件路径；实际 Kernel 从不监听此旧地址。 */
export function legacyKernelEndpoint(
  endpoint: string,
  platform: NodeJS.Platform = process.platform
): string {
  const api = platform === "win32" ? win32 : posix;
  return api.join(api.dirname(endpoint), "sockets", "octo-runtime-executor-kernel.sock");
}
