import { homedir } from "node:os";
import { join } from "node:path";
import {
  createCodexAdapter,
  createManagedCodexEngine
} from "@mininglamp-oss/octo-runtime-adapter-codex";
import { processEnvironmentValue } from "@mininglamp-oss/octo-runtime-adapter-sdk";
import type { CliAdapterResource } from "./adapters.js";

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
  const owner = createManagedCodexEngine({
    codexHome,
    env: context.env,
    command: options.command,
    appServerArgs: options.appServerArgs
  });
  return {
    adapter: createCodexAdapter({ engine: owner.provider }),
    processes: () => owner.processes(),
    beginShutdown: () => owner.beginShutdown(),
    close: (deadline) => owner.close({ deadline })
  };
}
