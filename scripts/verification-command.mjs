import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

function environmentValue(env, name) {
  const key = Object.keys(env)
    .filter((key) => key.toUpperCase() === name)
    .sort()[0];
  return key === undefined ? undefined : env[key];
}

async function isFile(file) {
  try {
    return (await stat(file)).isFile();
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return false;
    throw error;
  }
}

/** 为验证脚本的 npm/octo-cli 选择 Windows 载体，保持参数数组，不执行 shell。 */
export async function executeVerificationCommand(command, args, options = {}) {
  if (process.platform !== "win32" || !["npm", "octo-cli"].includes(command))
    return execute(command, args, options);

  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const extensions = (environmentValue(env, "PATHEXT") ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .filter((extension) => /^\.(exe|com|cmd|bat)$/i.test(extension));
  const directories = [
    cwd,
    ...(environmentValue(env, "PATH") ?? process.env.PATH ?? "").split(delimiter)
  ];
  for (const directory of directories) {
    for (const extension of extensions) {
      const carrier = resolve(cwd, directory.replace(/^"(.*)"$/, "$1"), command + extension);
      if (!(await isFile(carrier))) continue;
      if (/\.(exe|com)$/i.test(carrier)) return execute(carrier, args, options);

      // npm/cmd-shim 的相对 JS 目标绑定到当前 PATH 选中的安装，不能猜另一个全局安装。
      const shim = await readFile(carrier, "utf8");
      const target =
        command === "npm" ? "npm/bin/npm-cli.js" : "@mininglamp-oss/octo-cli/bin/octo-cli.js";
      const references = [...shim.matchAll(/%(?:~dp0|dp0%)([^"\r\n]*?\.js)/gi)];
      const reference = references.find((match) =>
        match[1].replaceAll("\\", "/").toLowerCase().endsWith(`/${target}`)
      );
      if (!reference)
        throw Object.assign(new Error(`Unsupported ${command} command carrier`), {
          code: "EINVAL"
        });
      let entry = resolve(dirname(carrier), reference[1].replace(/^[/\\]+/, ""));
      if (!(await isFile(entry)))
        throw Object.assign(new Error(`${command} JavaScript entry not found`), { code: "ENOENT" });
      const adjacentNode = join(dirname(carrier), "node.exe");
      const node = (await isFile(adjacentNode)) ? adjacentNode : process.execPath;
      // npm 自带 shim 允许已更新的 prefix 安装覆盖随 Node 附带的 npm，保持相同选择。
      if (command === "npm" && shim.includes("NPM_PREFIX_NPM_CLI_JS")) {
        const { stdout } = await execute(node, [join(dirname(entry), "npm-prefix.js")], options);
        const prefixEntry = join(stdout.trim(), "node_modules/npm/bin/npm-cli.js");
        if (stdout.trim() && (await isFile(prefixEntry))) entry = prefixEntry;
      }
      return execute(node, [entry, ...args], options);
    }
  }
  // 没找到安装时保留 execFile 原有 ENOENT，不把“未安装”伪装成载体错误。
  return execute(command, args, options);
}

/** 包装器保留安全的系统码/退出状态；不复制原错误里的 argv、环境或输出。 */
export function verificationCommandError(error, message) {
  const code =
    Number.isSafeInteger(error?.code) ||
    (typeof error?.code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code))
      ? error.code
      : undefined;
  const diagnostic =
    typeof code === "number" ? `exit:${code}` : code ? `spawn:${code}` : "command_failed";
  return Object.assign(new Error(`${message} (${diagnostic})`), {
    code,
    errno: Number.isSafeInteger(error?.errno) ? error.errno : undefined,
    exitCode: typeof code === "number" ? code : undefined
  });
}
