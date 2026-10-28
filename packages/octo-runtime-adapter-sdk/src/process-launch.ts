import { readFileSync, statSync } from "node:fs";
import { basename, delimiter, dirname, extname, join, resolve } from "node:path";
import { processEnvironmentValue } from "./environment.js";

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

function commandPath(command: string, env: NodeJS.ProcessEnv, cwd: string): string | undefined {
  if (/[/\\]/.test(command) || /^[A-Za-z]:/.test(command)) return resolve(cwd, command);
  const extensions = extname(command)
    ? [""]
    : (processEnvironmentValue(env, "PATHEXT") ?? ".COM;.EXE;.BAT;.CMD")
        .split(";")
        .filter((extension) => /^\.(exe|com|cmd|bat)$/i.test(extension));
  const path =
    processEnvironmentValue(env, "PATH") ?? processEnvironmentValue(process.env, "PATH") ?? "";
  for (const directory of [cwd, ...path.split(delimiter)]) {
    for (const extension of extensions) {
      const candidate = resolve(cwd, directory.replace(/^"(.*)"$/, "$1"), command + extension);
      if (fileSize(candidate) !== undefined) return candidate;
    }
  }
  return undefined;
}

/**
 * 在 Provider 启动和版本探测前同步解析 Windows npm 包装器，保持 spawn 的同步返回合同。
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
          : "node";
  return { command: node, args: [entry, ...args] };
}
