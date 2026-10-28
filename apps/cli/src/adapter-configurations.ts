import { constants } from "node:fs";
import { access, lstat, readFile, realpath, stat } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { processEnvironmentValue } from "@mininglamp-oss/octo-runtime-adapter-sdk";
import type { ModuleManifest } from "@mininglamp-oss/octo-runtime-adapter-sdk/module-manifest";
import { readAdapterConfigurations } from "@mininglamp-oss/octo-runtime-executor-kernel";

/** CLI 宿主在创建 Kernel 前补齐 npm DSH 入口；探测与调用共享快照，显式配置始终优先。 */
export async function readCliAdapterConfigurations(
  profileRoot: string,
  adapters: unknown,
  manifest: ModuleManifest,
  env: NodeJS.ProcessEnv = process.env
): Promise<ReturnType<typeof readAdapterConfigurations>> {
  const configurations = readAdapterConfigurations(profileRoot, adapters);
  if (
    configurations.dsh?.providerOptions?.dshBin !== undefined ||
    !manifest.adapters.some((entry) => entry.type === "dsh" || entry.type === undefined)
  )
    return configurations;
  const dshBin = await discoverDshEntry(env);
  if (dshBin)
    configurations.dsh = {
      ...configurations.dsh,
      providerOptions: { ...configurations.dsh?.providerOptions, dshBin }
    };
  return configurations;
}

async function discoverDshEntry(env: NodeJS.ProcessEnv): Promise<string | undefined> {
  const extensions =
    process.platform === "win32"
      ? (processEnvironmentValue(env, "PATHEXT") ?? ".COM;.EXE;.BAT;.CMD").split(";")
      : [""];
  for (const directory of (processEnvironmentValue(env, "PATH") ?? "").split(delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      const command = resolve(directory, `dsh${extension}`);
      // 只有路径不存在才能继续；lstat 保留损坏链接，首个已存在候选不可因不可用而换安装。
      try {
        await lstat(command);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT" || code === "ENOTDIR") continue;
        return;
      }
      try {
        await access(command, process.platform === "win32" ? constants.F_OK : constants.X_OK);
        if (!(await stat(command)).isFile()) return;
      } catch {
        return;
      }
      // 先固定 PATH 中的命令，再读取安装元数据；不执行 shim，也不因版本不兼容换另一安装。
      return packageEntryForCommand(command);
    }
  }
}

async function packageEntryForCommand(command: string): Promise<string | undefined> {
  let target: string;
  try {
    target = await realpath(command);
  } catch {
    return;
  }
  // npm 在 Unix 上使用符号链接；从链接目标向上确认包名，兼容自定义 prefix。
  for (let directory = dirname(target); ; directory = dirname(directory)) {
    const entry = await packageEntry(directory);
    if (entry) return entry;
    if (directory === dirname(directory)) break;
  }
  const binDirectory = dirname(command);
  // Windows npm shim、Unix 全局 prefix/bin、以及项目 node_modules/.bin 均只读相邻安装。
  for (const directory of [
    join(binDirectory, "node_modules", "@deepseek-ai", "dsh"),
    join(binDirectory, "..", "lib", "node_modules", "@deepseek-ai", "dsh"),
    join(binDirectory, "..", "@deepseek-ai", "dsh")
  ]) {
    const entry = await packageEntry(directory);
    if (entry) return entry;
  }
}

async function packageEntry(directory: string): Promise<string | undefined> {
  try {
    const metadata = JSON.parse(await readFile(join(directory, "package.json"), "utf8")) as {
      name?: unknown;
      bin?: unknown;
    };
    if (metadata?.name !== "@deepseek-ai/dsh") return;
    const bin =
      typeof metadata.bin === "string"
        ? metadata.bin
        : metadata.bin && typeof metadata.bin === "object"
          ? (metadata.bin as Record<string, unknown>).dsh
          : undefined;
    if (typeof bin !== "string" || !bin.trim() || isAbsolute(bin)) return;
    const entry = resolve(directory, bin);
    const location = relative(directory, entry);
    if (location === ".." || location.startsWith(`..${sep}`) || isAbsolute(location)) return;
    // 文件与版本由 Adapter 校验；即使入口缺失，也不能改选 PATH 中的另一安装。
    return entry;
  } catch {
    return;
  }
}
