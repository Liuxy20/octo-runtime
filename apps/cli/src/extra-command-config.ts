import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  assertStoredExtra,
  readStoredExtra,
  type ExtraCommandContext,
  type StoredExtra
} from "@mininglamp-oss/octo-runtime-host-sdk";
import { withSetupLock, writeJsonAtomic, type RuntimePaths } from "./state.js";

/** 与 extraset 共用 Home 锁和原子写入；网络/交互发生在调用方，不能占用写锁。 */
export function commandConfig(
  paths: RuntimePaths,
  name: string,
  module: string,
  signal: AbortSignal
): Pick<ExtraCommandContext, "readConfig" | "saveConfig"> {
  const read = async (): Promise<StoredExtra | undefined> => {
    try {
      const stored = await readStoredExtra(join(paths.home, "extras"), name);
      if (stored.module !== undefined && stored.module !== module)
        throw new Error("EXTRA_MODULE_MIGRATION_REQUIRED");
      return stored;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  };
  const revision = (stored: StoredExtra | undefined) =>
    createHash("sha256")
      .update(JSON.stringify(stored ?? null))
      .digest("hex");
  return {
    async readConfig() {
      signal.throwIfAborted();
      const stored = await read();
      return { config: stored?.config ?? {}, revision: revision(stored) };
    },
    async saveConfig(config, expected) {
      signal.throwIfAborted();
      // 先复制并校验，异步获取锁期间插件不能改变待保存值。
      assertStoredExtra({ config });
      const copy: typeof config = JSON.parse(JSON.stringify(config)) as typeof config;
      return withSetupLock(paths, async () => {
        signal.throwIfAborted();
        const stored = await read();
        if (revision(stored) !== expected) throw new Error("EXTRA_CONFIG_CONFLICT");
        const next = { ...stored, config: copy };
        if (Buffer.byteLength(JSON.stringify(next, null, 2) + "\n") > 1024 * 1024)
          throw new Error("EXTRA_CONFIG_TOO_LARGE");
        signal.throwIfAborted();
        const file = join(paths.home, "extras", name, "config.json");
        // 原子写入开始后以写入结果为准；不在 rename 后因取消误报未保存。
        await writeJsonAtomic(file, next);
        return { saved: true, name, file, reload_required: true };
      });
    }
  };
}
