import { homedir } from "node:os";
import { join } from "node:path";
import {
  createCodexAdapter,
  codexMetadata,
  createManagedCodexEngine
} from "@mininglamp-oss/octo-runtime-adapter-codex";
import { processEnvironmentValue } from "@mininglamp-oss/octo-runtime-adapter-sdk";
import type { CliAdapterResource } from "./adapters.js";
import { cliProviderLaunch, unavailableCliAdapter } from "./provider-launch.js";

/** CLI 在实际服务进程选择默认 Home 并持有 owner；库和 Adapter 不决定目录生命周期。 */
export function createCliCodexAdapter(
  options: Record<string, unknown>,
  context: { env: NodeJS.ProcessEnv }
): CliAdapterResource {
  const codexHome =
    options.codexHome ??
    processEnvironmentValue(context.env, "CODEX_HOME") ??
    join(homedir(), ".codex");
  if (
    typeof codexHome !== "string" ||
    (options.command !== undefined && typeof options.command !== "string") ||
    (options.appServerArgs !== undefined &&
      (!Array.isArray(options.appServerArgs) ||
        !options.appServerArgs.every((v) => typeof v === "string")))
  )
    throw new TypeError("CODEX_CONFIGURATION_INVALID");
  const selected = cliProviderLaunch(options, context.env, "codex");
  if (!selected.launch)
    return {
      adapter: unavailableCliAdapter(codexMetadata, selected.reason, selected.command),
      close: () =>
        Promise.resolve({ complete: true, unresolvedServiceIds: [], failedCleanupServiceIds: [] })
    };
  const owner = createManagedCodexEngine({
    codexHome,
    env: selected.launch.env,
    command: selected.launch.command,
    commandArgsPrefix: selected.launch.args,
    appServerArgs: options.appServerArgs
  });
  return {
    adapter: createCodexAdapter({ engine: owner.provider }),
    processes: () => owner.processes(),
    beginShutdown: () => owner.beginShutdown(),
    close: (deadline) => owner.close({ deadline })
  };
}
