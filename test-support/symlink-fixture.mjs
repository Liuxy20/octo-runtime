import { symlinkSync } from "node:fs";
import { symlink } from "node:fs/promises";

function unavailable(t, error, type) {
  if (process.platform !== "win32" || error.code !== "EPERM") throw error;
  t.skip(
    `symlink prerequisite unavailable: Windows ${type} fixture creation returned EPERM; dependent assertions not executed`
  );
  return false;
}

/** 只捕获测试独占夹具的创建错误；调用方必须在 false 后返回，产品调用在此边界之外。 */
export async function symlinkFixture(t, target, path, type = "file") {
  try {
    await symlink(target, path, type);
  } catch (error) {
    return unavailable(t, error, type);
  }
  return true;
}

/** 同步夹具使用相同前提；不探测系统设置、不用 junction 替代目录符号链接。 */
export function symlinkFixtureSync(t, target, path, type = "file") {
  try {
    symlinkSync(target, path, type);
  } catch (error) {
    return unavailable(t, error, type);
  }
  return true;
}
