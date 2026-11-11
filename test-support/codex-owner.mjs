import { homedir } from "node:os";
import { join } from "node:path";
import {
  createManagedCodexEngine,
  createCodexAdapter
} from "../packages/octo-runtime-adapter-codex/dist/index.js";
import { resolveHostProviderLaunch } from "../packages/octo-runtime-adapter-sdk/dist/process-launch.js";

// 验证脚本本身是宿主，显式选择 Home；调用者必须 finally 关闭返回的 owner。
export function createFixtureCodexHost(options = {}) {
  const env = options.env ?? process.env;
  const launch = resolveHostProviderLaunch(options.command ?? "codex", {
    env,
    cwd: process.cwd(),
    args: options.commandArgsPrefix
  });
  const owner = createManagedCodexEngine({
    ...options,
    command: launch.command,
    commandArgsPrefix: launch.args,
    env: launch.env,
    codexHome: options.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), ".codex")
  });
  return { owner, adapter: createCodexAdapter({ engine: owner.provider }) };
}
