import { isAbsolute } from "node:path";

/** 宿主已选定的本地启动目标；args 只含运行器/入口前缀，协议参数由 Adapter 追加。 */
export interface ProviderLaunch {
  command: string;
  args?: readonly string[];
  env?: NodeJS.ProcessEnv;
}

/** 构造时复制宿主绑定，不发现安装、不启动程序；本轮环境不能重新选择 executable。 */
export function snapshotProviderLaunch(launch: ProviderLaunch): Required<ProviderLaunch> {
  assertProviderCommand(launch?.command);
  const args: readonly string[] = launch.args ?? [];
  if (
    !Array.isArray(args) ||
    args.some((arg: unknown) => typeof arg !== "string" || arg.includes("\0"))
  )
    throw new TypeError("PROVIDER_LAUNCH_INVALID");
  return Object.freeze({
    command: launch.command,
    args: Object.freeze(
      Array.from(args, (arg: unknown) => {
        if (typeof arg !== "string") throw new TypeError("PROVIDER_LAUNCH_INVALID");
        return arg;
      })
    ),
    env: Object.freeze({ ...(launch.env ?? {}) })
  });
}

/** 纯执行层只接受已解析的绝对路径；不解析 PATH、cwd、shim 或备用安装。 */
export function assertProviderCommand(command: unknown): asserts command is string {
  if (command === undefined) throw new TypeError("PROVIDER_LAUNCH_REQUIRED");
  if (typeof command !== "string" || !command || command.includes("\0") || !isAbsolute(command))
    throw new TypeError("PROVIDER_LAUNCH_INVALID");
}
