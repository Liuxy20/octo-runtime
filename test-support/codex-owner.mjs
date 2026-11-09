import { homedir } from "node:os";
import { join } from "node:path";
import { createManagedCodexEngine, createCodexAdapter } from "../dist/public/codex.js";

// 验证脚本本身是宿主，显式选择 Home；调用者必须 finally 关闭返回的 owner。
export function createFixtureCodexHost(options = {}) {
  const owner = createManagedCodexEngine({
    ...options,
    codexHome: options.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), ".codex")
  });
  return { owner, adapter: createCodexAdapter({ engine: owner.provider }) };
}
