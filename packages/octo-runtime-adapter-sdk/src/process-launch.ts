import {
  accessSync,
  closeSync,
  constants,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync
} from "node:fs";
import { basename, delimiter, dirname, extname, isAbsolute, join, resolve } from "node:path";
import { processEnvironmentValue } from "./environment.js";
import { snapshotProviderLaunch, type ProviderLaunch } from "./provider-launch.js";

function fileSize(file: string): number | undefined {
  try {
    const info = statSync(file);
    return info.isFile() ? info.size : undefined;
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? ""))
      return undefined;
    throw error;
  }
}

/** 有界读取 shebang；无扩展名的 Node 入口也必须在宿主固定运行器。 */
function isNodeScript(file: string): boolean {
  let descriptor: number;
  try {
    descriptor = openSync(file, "r");
  } catch (error) {
    // 原生文件可以只有执行权限；读 shebang 不是原生 exec 的先决条件。
    if ((error as NodeJS.ErrnoException).code === "EACCES") return false;
    throw error;
  }
  try {
    const header = Buffer.alloc(256);
    const length = readSync(descriptor, header, 0, header.length, 0);
    const firstLine = header.toString("utf8", 0, length).split("\n", 1)[0];
    if (!firstLine.startsWith("#!")) return /\.[cm]?js$/i.test(file);
    if (!/^#![^\r\n]*[/\s]node(?:\s|$)/.test(firstLine)) return false;
    if (!/^#!\s*(?:\S*\/env\s+node|\S*\/node)\s*$/.test(firstLine))
      throw new TypeError("PROVIDER_LAUNCH_INVALID: inject Node and shebang arguments explicitly");
    return true;
  } finally {
    closeSync(descriptor);
  }
}

function commandPath(command: string, env: NodeJS.ProcessEnv, cwd: string): string | undefined {
  if (/[/\\]/.test(command) || /^[A-Za-z]:/.test(command)) return resolve(cwd, command);
  const extensions =
    process.platform !== "win32" || extname(command)
      ? [""]
      : (processEnvironmentValue(env, "PATHEXT") ?? ".COM;.EXE;.BAT;.CMD")
          .split(";")
          .filter((extension) => /^\.(exe|com|cmd|bat)$/i.test(extension));
  const path = processEnvironmentValue(env, "PATH") ?? "";
  const directories =
    process.platform === "win32" ? [cwd, ...path.split(delimiter)] : path.split(delimiter);
  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = resolve(cwd, directory.replace(/^"(.*)"$/, "$1"), command + extension);
      if (fileSize(candidate) !== undefined) {
        accessSync(candidate, process.platform === "win32" ? constants.F_OK : constants.X_OK);
        return candidate;
      }
    }
  }
  return undefined;
}

/**
 * 仅由宿主在装配时解析 Windows npm 包装器；Adapter 和 transport 不调用此函数。
 * JS 入口交给 Node，原生入口直接执行；argv 独立传递，未知 batch 沿原路径报错。
 * 返回启动命令和参数；ChildProcess、管道及清理仍由调用方负责。
 */
export function resolveProcessLaunch(
  command: string,
  args: readonly string[],
  { env = process.env, cwd = process.cwd() }: { env?: NodeJS.ProcessEnv; cwd?: string } = {}
): { command: string; args: readonly string[] } {
  const original = { command, args };
  if (process.platform !== "win32") return original;
  let carrier = commandPath(command, env, cwd);
  if (!carrier) return original;

  // probeCommand 可能返回 npm 同时生成的 Unix 入口，仍绑定同一目录的 Windows shim。
  if (!extname(carrier)) {
    const size = fileSize(carrier);
    if (
      size !== undefined &&
      size <= 64 * 1024 &&
      /^#!.*\bsh\b/.test(readFileSync(carrier, "utf8"))
    ) {
      const sibling = `${carrier}.cmd`;
      if (fileSize(sibling) !== undefined) carrier = sibling;
    }
  }
  if (!/\.(cmd|bat)$/i.test(carrier)) return { command: carrier, args };
  const size = fileSize(carrier);
  if (size === undefined || size > 64 * 1024) return { command: carrier, args };
  const shim = readFileSync(carrier, "utf8");
  if (!/^:find_dp0\s*$/im.test(shim) || !/^\s*CALL :find_dp0\s*$/im.test(shim))
    return { command: carrier, args };
  const match = /^(.*)"%(?:~dp0|dp0%)([^"\r\n]+?\.(?:[cm]?js|exe|com))"\s+%\*\s*$/im.exec(shim);
  // 不解释自定义 batch、额外参数或变量展开；保留 Node 对不支持载体的原始失败。
  if (!match || match[2].includes("%")) return { command: carrier, args };
  const entry = resolve(dirname(carrier), match[2].replace(/^[/\\]+/, ""));
  if (/\.(exe|com)$/i.test(entry)) {
    if (match[1].trim() && !/[&|]\s*$/.test(match[1])) return { command: carrier, args };
    return { command: entry, args };
  }
  if (!/(?:\bnode(?:\.exe)?|"%_prog%")\s*$/i.test(match[1])) return { command: carrier, args };
  if (fileSize(entry) === undefined)
    throw Object.assign(new Error("Provider command entry not found"), {
      code: "ENOENT",
      path: entry
    });
  const adjacentNode = join(dirname(carrier), "node.exe");
  const pathNode = commandPath("node", env, cwd);
  const node =
    fileSize(adjacentNode) !== undefined
      ? adjacentNode
      : pathNode && /\.(exe|com)$/i.test(pathNode)
        ? pathNode
        : basename(process.execPath).toLowerCase() === "node.exe"
          ? process.execPath
          : undefined;
  if (!node) throw Object.assign(new Error("Provider Node runtime not found"), { code: "ENOENT" });
  return { command: node, args: [entry, ...args] };
}

/**
 * 仅供宿主装配调用：选择一个安装并解析 npm/Node 启动链，返回可注入快照。
 * 首个已有候选损坏时立即失败，不换安装；不校验协议版本、不安装或启动程序。
 */
export function resolveHostProviderLaunch(
  command: string,
  { env, cwd, args = [] }: { env: NodeJS.ProcessEnv; cwd: string; args?: readonly string[] }
): Required<ProviderLaunch> {
  if (!command || command.includes("\0")) throw new TypeError("PROVIDER_LAUNCH_INVALID");
  const qualified = isAbsolute(command) || /[/\\]/.test(command) || /^[A-Za-z]:/.test(command);
  const extensions =
    process.platform === "win32" && !extname(command)
      ? (processEnvironmentValue(env, "PATHEXT") ?? ".EXE;.CMD;.BAT;.COM").split(";")
      : [""];
  const directories = qualified
    ? [""]
    : (processEnvironmentValue(env, "PATH") ?? "").split(delimiter);
  let selected: string | undefined;
  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = resolve(cwd, directory.replace(/^"(.*)"$/, "$1"), command + extension);
      try {
        lstatSync(candidate);
      } catch (error) {
        if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) continue;
        throw error;
      }
      accessSync(candidate, process.platform === "win32" ? constants.F_OK : constants.X_OK);
      if (!statSync(candidate).isFile()) throw new TypeError("PROVIDER_LAUNCH_INVALID");
      selected = candidate;
      break;
    }
    if (selected) break;
  }
  if (!selected) throw Object.assign(new Error("Provider command not found"), { code: "ENOENT" });
  let launch = resolveProcessLaunch(selected, args, { env, cwd });
  const physical = realpathSync(selected);
  if (process.platform !== "win32" && isNodeScript(physical)) {
    const node = process.versions.electron ? commandPath("node", env, cwd) : process.execPath;
    if (!node)
      throw Object.assign(new Error("Provider Node runtime not found"), { code: "ENOENT" });
    launch = { command: node, args: [physical, ...args] };
  }
  return snapshotProviderLaunch({ ...launch, env });
}
