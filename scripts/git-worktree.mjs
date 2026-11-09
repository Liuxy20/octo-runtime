import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** 只识别 Git 元数据入口；临时目录中的同名空目录不构成工作树。 */
export function hasGitMetadata(directory) {
  const marker = join(directory, ".git");
  try {
    return /^gitdir: .+\r?\n?$/.test(readFileSync(marker, "utf8"));
  } catch (error) {
    // 直接读取入口；目录错误才走普通 checkout 的 HEAD 检查，避免先 stat 再读。
    if (error.code === "EISDIR") {
      try {
        return statSync(join(marker, "HEAD")).isFile();
      } catch (headError) {
        if (headError.code === "ENOENT" || headError.code === "ENOTDIR") return false;
        throw headError;
      }
    }
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return false;
    throw error;
  }
}
