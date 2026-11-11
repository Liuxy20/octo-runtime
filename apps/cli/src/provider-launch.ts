import {
  defineAdapter,
  runAdapterPreparation,
  type AdapterMetadata
} from "@mininglamp-oss/octo-runtime-adapter-sdk";
import { resolveHostProviderLaunch } from "@mininglamp-oss/octo-runtime-adapter-sdk/process-launch";

/** CLI 明确选择安装；配置形状错误阻止装配，缺安装只影响对应 Adapter。 */
export function cliProviderLaunch(
  options: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
  defaultCommand: string
) {
  if (
    (options.command !== undefined &&
      (typeof options.command !== "string" ||
        !options.command ||
        options.command.includes("\0"))) ||
    (options.commandArgsPrefix !== undefined &&
      (!Array.isArray(options.commandArgsPrefix) ||
        options.commandArgsPrefix.some((arg) => typeof arg !== "string" || arg.includes("\0"))))
  )
    throw new TypeError("PROVIDER_LAUNCH_INVALID");
  try {
    return {
      launch: resolveHostProviderLaunch(options.command ?? defaultCommand, {
        env,
        cwd: process.cwd(),
        args: options.commandArgsPrefix as string[] | undefined
      })
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR" || code === "EACCES" || code === "EPERM")
      return {
        command:
          typeof (error as NodeJS.ErrnoException).path === "string"
            ? (error as NodeJS.ErrnoException).path!
            : (options.command ?? defaultCommand),
        reason: code === "EACCES" || code === "EPERM" ? "permission_denied" : "command_not_found"
      };
    throw error;
  }
}

/** 复用模块静态声明及既有 probe；没有依赖时不构造假 command、不延迟发现安装。 */
export function unavailableCliAdapter(metadata: AdapterMetadata, reason: string, command: string) {
  const failure = Object.assign(new Error(`${reason}: ${command}`), {
    code: reason === "permission_denied" ? "EACCES" : "ENOENT"
  });
  return defineAdapter({
    metadata,
    probe: () => Promise.resolve({ available: false, command, reason }),
    respondInteraction: () => Promise.reject(new Error("INTERACTION_NOT_ACTIVE")),
    respondNative: () => Promise.reject(new Error("INTERACTION_NOT_ACTIVE")),
    async *invoke(request, context) {
      await runAdapterPreparation(context, () => {
        request.signal?.throwIfAborted();
        throw failure;
      });
      yield* [];
    }
  });
}
