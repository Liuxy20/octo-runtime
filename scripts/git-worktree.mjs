import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** 只识别 Git 元数据入口；临时目录中的同名空目录不构成工作树。 */
export function hasGitMetadata(directory) {
  const marker = join(directory, ".git");
  try {
    if (statSync(marker).isDirectory()) return statSync(join(marker, "HEAD")).isFile();
    return /^gitdir: .+\r?\n?$/.test(readFileSync(marker, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return false;
    throw error;
  }
}
