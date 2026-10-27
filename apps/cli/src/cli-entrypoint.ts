import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** 保留包管理器入口中的安装组路径；只有指向本 CLI 的 argv 才能影响服务部署与发现。 */
export function cliEntrypoint(
  invocation = process.argv[1],
  installed = fileURLToPath(new URL("./index.js", import.meta.url))
): string {
  if (invocation) {
    try {
      if (realpathSync(invocation) === realpathSync(installed)) return resolve(invocation);
    } catch {
      // 库内调用、测试 runner 或已移除的入口不拥有本 CLI 的安装来源。
    }
  }
  return installed;
}
