import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describeError } from "./output.js";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  ExtraCommandError,
  type ExtraCommand,
  type ExtraCommandContext,
  type ExtraCommandExtension,
  type ExtraCommandOption
} from "@mininglamp-oss/octo-runtime-host-sdk";
import {
  resolveModuleSpecifier,
  type ExtraModuleEntry
} from "@mininglamp-oss/octo-runtime-adapter-sdk/module-manifest";
import { commandConfig } from "./extra-command-config.js";
import { defaultRuntimeHome, runtimePaths } from "./state.js";
import { loadCliManifest } from "./module-manifest.js";
import { resolveExtraModule } from "./global-extras.js";
import { helpText } from "./help.js";
import type { CliDependencies } from "./main.js";

const lifecycle = new Set([
  "install",
  "uninstall",
  "start",
  "stop",
  "restart",
  "status",
  "run",
  "logs"
]);
const roots = new Set([
  "executor-kernel",
  "status",
  "adapter",
  "doctor",
  "extraset",
  "extraget",
  "playboard",
  "version",
  "help"
]);
const hostOptions: ExtraCommandOption[] = [
  ...["home", "manifest", "profile"].map((name) => ({
    name,
    type: "string" as const,
    description: "Host option"
  })),
  ...["json", "help"].map((name) => ({
    name,
    type: "boolean" as const,
    description: "Host option"
  }))
];
const reservedOptions = new Set([
  ...hostOptions.map((option) => option.name),
  "version",
  "autostart",
  "lines",
  "follow",
  "acknowledge-orphan-cleanup"
]);
const validName = /^[a-z][a-z0-9-]{0,63}$/;
const validOptionName = /^[a-z][a-z0-9_-]{0,63}$/;

/** 根目录只读元数据；只有选中命令才导入扩展，生命周期始终走原有离线路由。 */
export async function routeExtraCommand(
  args: string[],
  dependencies: CliDependencies,
  onOutputMode: (json: boolean) => void = () => {}
): Promise<number | undefined> {
  const output =
    dependencies.output ??
    ((line: string) => {
      process.stdout.write(`${line}\n`);
    });
  const flags: Record<string, string | boolean> = Object.create(null) as Record<
    string,
    string | boolean
  >;
  let index = 0;
  while (index < args.length && args[index].startsWith("-")) {
    // 保持旧命令的 version、安装等语法，由原解析器负责诊断。
    if (!hostOptions.some((option) => option.name === optionName(args[index]))) return undefined;
    index = parseOption(args, index, hostOptions, flags);
  }
  const name = args[index++];
  if (name && roots.has(name) && name !== "help") return undefined;
  const home = resolve(
    typeof flags.home === "string"
      ? flags.home
      : defaultRuntimeHome(dependencies.env, dependencies.platform)
  );
  const manifestPath = typeof flags.manifest === "string" ? flags.manifest : undefined;
  const report =
    dependencies.errorOutput ??
    ((line: string) => {
      process.stderr.write(`${line}\n`);
    });
  if (!name || name === "help") {
    if (name === "help" && index < args.length) return undefined;
    const manifest = await loadCliManifest(home, manifestPath, report);
    if (manifest.extras.some((item) => roots.has(item.name)))
      throw new Error("EXTRA_COMMAND_NAMESPACE_CONFLICT");
    output(
      `${helpText()}\n\nAvailable Extra namespaces:\n${manifest.extras.map((entry) => `  ${entry.name}`).join("\n")}`
    );
    return 0;
  }
  if (!validName.test(name)) return undefined;
  const tail = args.slice(index);
  // 只越过已知宿主选项确定动作；不能猜测 Extra 参数的值。
  let actionIndex = 0;
  while (
    actionIndex < tail.length &&
    hostOptions.some((option) => option.name === optionName(tail[actionIndex]))
  )
    actionIndex = parseOption(tail, actionIndex, hostOptions, flags);
  if (lifecycle.has(tail[actionIndex])) return undefined;
  // 先选择来源，再加载命令声明：宿主选项可位于子命令后，但 -- 后不再扫描。
  // 业务字符串中以 - 开头的值要求使用 =，因此不会把合法业务值误当成宿主选项。
  // 保留原 argv 给完整解析器，避免移除宿主选项后把业务缺值错误拼成有效输入。
  const selectionFlags = { ...flags };
  for (let cursor = actionIndex; cursor < tail.length;) {
    if (tail[cursor] === "--") break;
    const option = optionName(tail[cursor]);
    cursor =
      option === "home" || option === "manifest"
        ? parseOption(tail, cursor, hostOptions, selectionFlags)
        : cursor + 1;
  }
  const selectedHome = resolve(
    typeof selectionFlags.home === "string" ? selectionFlags.home : home
  );
  const manifest = await loadCliManifest(
    selectedHome,
    typeof selectionFlags.manifest === "string" ? selectionFlags.manifest : manifestPath,
    report
  );
  const entry = manifest.extras.find((item) => item.name === name);
  if (!entry) return undefined;
  if (manifest.extras.some((item) => roots.has(item.name)))
    throw new Error("EXTRA_COMMAND_NAMESPACE_CONFLICT");
  const extension = await loadExtraCommands(entry);
  if (!extension) {
    if (actionIndex < tail.length) throw new Error("EXTRA_COMMAND_NOT_FOUND");
    output(helpText(name));
    return 0;
  }
  validateCommands(extension);
  const parsed = parseCommand(tail.slice(actionIndex), extension.commands, flags);
  onOutputMode(Boolean(flags.json));
  if (flags.profile !== undefined) throw new Error("INVALID_ARGUMENTS");
  if (!parsed.command || flags.help) {
    output(commandHelp(name, parsed.path, parsed.command, extension.commands));
    return 0;
  }
  if (!parsed.command.run) throw new Error("EXTRA_COMMAND_REQUIRED");
  const commandHome = resolve(typeof flags.home === "string" ? flags.home : selectedHome);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  const externalCancel = () => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  dependencies.commandSignal?.addEventListener("abort", externalCancel, { once: true });
  if (dependencies.commandSignal?.aborted) controller.abort();
  const input = dependencies.input ?? process.stdin;
  let stdinRead = false;
  const context: ExtraCommandContext = {
    name,
    home: commandHome,
    signal: controller.signal,
    interactive: Boolean((input as NodeJS.ReadStream).isTTY),
    ...commandConfig(
      runtimePaths(commandHome, "default", dependencies.platform),
      name,
      entry.module,
      controller.signal
    ),
    output,
    async readStdin() {
      if (stdinRead || (input as NodeJS.ReadStream).isTTY)
        throw new Error("EXTRA_COMMAND_STDIN_REQUIRED");
      stdinRead = true;
      return readInput(input, controller.signal);
    },
    async prompt(question) {
      if (!(input as NodeJS.ReadStream).isTTY)
        throw new Error("EXTRA_COMMAND_INTERACTIVE_REQUIRED");
      const terminal = createInterface({ input, output: process.stderr });
      try {
        return await terminal.question(question, { signal: controller.signal });
      } finally {
        terminal.close();
      }
    }
  };
  try {
    controller.signal.throwIfAborted();
    const result = await parsed.command.run(context, {
      options: parsed.options,
      arguments: parsed.arguments
    });
    if (
      result?.exitCode !== undefined &&
      (!Number.isInteger(result.exitCode) || result.exitCode < 0 || result.exitCode > 255)
    )
      throw new Error("EXTRA_COMMAND_RESULT_INVALID");
    if (result?.message !== undefined && typeof result.message !== "string")
      throw new Error("EXTRA_COMMAND_RESULT_INVALID");
    if (!flags.json && result?.message !== undefined) output(result.message);
    else if (result?.value !== undefined) output(JSON.stringify(result.value, null, 2));
    return result?.exitCode ?? 0;
  } catch (error) {
    if (controller.signal.aborted) throw new Error("EXTRA_COMMAND_CANCELLED", { cause: error });
    // 第三方异常可能直接包含凭据；只透出显式安全诊断和宿主固定错误集合。
    if (error instanceof ExtraCommandError) throw error;
    const safe = new Set([
      "EXTRA_CONFIG_CONFLICT",
      "EXTRA_CONFIG_TOO_LARGE",
      "EXTRA_CONFIG_OBJECT_REQUIRED",
      "EXTRA_CONFIG_JSON_REQUIRED",
      "EXTRA_CONFIG_FIELD_INVALID",
      "EXTRA_CONFIG_PERMISSIONS_INVALID",
      "EXTRA_CONFIG_FILE_INVALID",
      "EXTRA_MODULE_MIGRATION_REQUIRED",
      "SETUP_IN_PROGRESS",
      "EXTRA_COMMAND_STDIN_REQUIRED",
      "EXTRA_COMMAND_STDIN_CLOSED",
      "EXTRA_COMMAND_INTERACTIVE_REQUIRED",
      "EXTRA_COMMAND_RESULT_INVALID"
    ]);
    if (error instanceof Error && safe.has(error.message))
      throw new Error(error.message, { cause: error });
    throw new Error("EXTRA_COMMAND_FAILED", { cause: error });
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
    dependencies.commandSignal?.removeEventListener("abort", externalCancel);
  }
}

/** 仅解析选中模块的可选导出；解析不存在与导入后依赖损坏严格分开。 */
export async function loadExtraCommands(
  entry: ExtraModuleEntry
): Promise<ExtraCommandExtension | undefined> {
  let specifier: string;
  if (entry.commands) specifier = resolveModuleSpecifier(entry.commands, entry.sourceManifest);
  else {
    if (
      entry.module.startsWith(".") ||
      isAbsolute(entry.module) ||
      /^[a-z][a-z0-9+.-]*:/i.test(entry.module)
    )
      return undefined;
    try {
      if (!(await declaresExports(entry))) return undefined;
      specifier = resolveModuleSpecifier(`${entry.module}/commands`, entry.sourceManifest);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ERR_PACKAGE_PATH_NOT_EXPORTED")
        return undefined;
      throw new Error("EXTRA_COMMAND_LOAD_FAILED", { cause: error });
    }
  }
  try {
    const module = (await import(specifier)) as { default?: ExtraCommandExtension };
    if (!module.default || module.default.apiVersion !== 1)
      throw new Error("EXTRA_COMMAND_API_UNSUPPORTED");
    return module.default;
  } catch (error) {
    if (error instanceof Error && error.message === "EXTRA_COMMAND_API_UNSUPPORTED") throw error;
    throw new Error("EXTRA_COMMAND_LOAD_FAILED", { cause: error });
  }
}

/** 从选中服务的真实位置查所属包元数据；旧包未声明 exports 就没有可选命令入口。 */
async function declaresExports(entry: ExtraModuleEntry): Promise<boolean> {
  // 全局来源复用服务的安装身份检查；包被移除或替换后不能回退到祖先同名包。
  // 这里只解析服务地址用于查元数据，不 import 或启动服务。
  const service = await resolveExtraModule(entry);
  const parts = entry.module.split("/");
  const packageName = entry.module.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
  let directory = dirname(fileURLToPath(service));
  while (true) {
    try {
      const value: unknown = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
      if (value && typeof value === "object" && "name" in value && value.name === packageName)
        return "exports" in value && value.exports !== null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error("EXTRA_COMMAND_LOAD_FAILED");
    directory = parent;
  }
}

function isCommandArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function validateCommands(extension: ExtraCommandExtension): void {
  let count = 0;
  const walk = (commands: readonly ExtraCommand[], depth: number) => {
    if (!isCommandArray(commands) || depth > 8 || commands.length === 0)
      throw new Error("EXTRA_COMMAND_DEFINITION_INVALID");
    const names = new Set<string>();
    for (const command of commands) {
      if (
        ++count > 128 ||
        !command ||
        !validName.test(command.name) ||
        names.has(command.name) ||
        lifecycle.has(command.name) ||
        !command.description ||
        typeof command.description !== "string"
      )
        throw new Error("EXTRA_COMMAND_DEFINITION_INVALID");
      names.add(command.name);
      if (
        Boolean(command.commands) === Boolean(command.run) ||
        (command.run !== undefined && typeof command.run !== "function")
      )
        throw new Error("EXTRA_COMMAND_DEFINITION_INVALID");
      const options = new Set<string>();
      if (command.options !== undefined && !isCommandArray(command.options))
        throw new Error("EXTRA_COMMAND_DEFINITION_INVALID");
      for (const option of command.options ?? []) {
        if (
          !option ||
          !validOptionName.test(option.name) ||
          options.has(option.name) ||
          reservedOptions.has(option.name) ||
          !["string", "boolean"].includes(option.type) ||
          typeof option.description !== "string"
        )
          throw new Error("EXTRA_COMMAND_DEFINITION_INVALID");
        options.add(option.name);
      }
      if (
        command.arguments !== undefined &&
        (!Array.isArray(command.arguments) ||
          command.arguments.some((arg: { name: string }) => !arg || !validName.test(arg.name)))
      )
        throw new Error("EXTRA_COMMAND_DEFINITION_INVALID");
      if (
        command.examples !== undefined &&
        (!Array.isArray(command.examples) ||
          command.examples.some((example: unknown) => typeof example !== "string"))
      )
        throw new Error("EXTRA_COMMAND_DEFINITION_INVALID");
      if (command.commands) {
        if (command.options?.length || command.arguments?.length)
          throw new Error("EXTRA_COMMAND_DEFINITION_INVALID");
        walk(command.commands, depth + 1);
      }
    }
  };
  walk(extension.commands, 0);
}
function optionName(token: string): string {
  return token === "-h" ? "help" : token.startsWith("--") ? token.slice(2).split("=")[0] : "";
}
function parseOption(
  args: string[],
  index: number,
  definitions: readonly ExtraCommandOption[],
  values: Record<string, string | boolean>
): number {
  const token = args[index] === "-h" ? "--help" : args[index];
  const match = /^--([a-z][a-z0-9_-]*)(?:=(.*))?$/s.exec(token);
  const option = match && definitions.find((option) => option.name === match[1]);
  if (!match || !option || Object.hasOwn(values, option.name)) throw new Error("INVALID_ARGUMENTS");
  if (option.type === "boolean") {
    // 宿主布尔参数沿用旧 CLI：存在即启用，接受 --json=true 等等号形式。
    // Extra 的 typed boolean 仍只接受开关，不把任意字符串解释为业务布尔值。
    if (match[2] !== undefined && definitions !== hostOptions) throw new Error("INVALID_ARGUMENTS");
    values[option.name] = true;
    return index + 1;
  }
  const value = match[2] ?? args[++index];
  if (
    value === undefined ||
    value === "" ||
    (match[2] === undefined && value.startsWith(definitions === hostOptions ? "--" : "-"))
  )
    throw new Error("INVALID_ARGUMENTS");
  values[option.name] = value;
  return index + 1;
}
function parseCommand(
  args: string[],
  commands: readonly ExtraCommand[],
  flags: Record<string, string | boolean>
) {
  let command: ExtraCommand | undefined;
  let children = commands;
  const path: string[] = [],
    positional: string[] = [];
  const options: Record<string, string | boolean> = Object.create(null) as Record<
    string,
    string | boolean
  >;
  let literal = false;
  for (let index = 0; index < args.length;) {
    const token = args[index];
    if (!literal && token === "--") {
      literal = true;
      index++;
      continue;
    }
    if (!literal && token.startsWith("-")) {
      const host = hostOptions.find((option) => option.name === optionName(token));
      index = parseOption(
        args,
        index,
        host ? hostOptions : (command?.options ?? []),
        host ? flags : options
      );
      continue;
    }
    if (!literal && children.length) {
      command = children.find((value) => value.name === token);
      if (!command) throw new Error("EXTRA_COMMAND_NOT_FOUND");
      path.push(token);
      children = command.commands ?? [];
      index++;
      continue;
    }
    positional.push(token);
    index++;
  }
  if (!flags.help) {
    if (!command && positional.length) throw new Error("INVALID_ARGUMENTS");
    const definitions = command?.arguments ?? [];
    if (
      positional.length > definitions.length ||
      definitions.some((arg, index) => arg.required && positional[index] === undefined)
    )
      throw new Error("INVALID_ARGUMENTS");
    if (command?.options?.some((option) => option.required && options[option.name] === undefined))
      throw new Error("INVALID_ARGUMENTS");
  }
  return { command, path, options, arguments: positional };
}
function commandHelp(
  name: string,
  path: string[],
  command: ExtraCommand | undefined,
  commands: readonly ExtraCommand[]
): string {
  const children = command?.commands ?? (!command ? commands : []);
  return `${path.length ? `Octo Runtime: ${name} ${path.join(" ")}\n\n${command?.description}` : helpText(name)}\n\nUsage: octo-runtime [--home <path>] [--manifest <path>] ${name}${path.length ? ` ${path.join(" ")}` : ""}${children.length ? " <command>" : ""}${(command?.arguments ?? []).map((arg) => ` ${arg.required ? `<${arg.name}>` : `[${arg.name}]`}`).join("")} [options]\n${children.length ? `\nExtra commands:\n${children.map((child) => `  ${child.name.padEnd(16)}${child.description}`).join("\n")}` : ""}\n${(command?.options ?? []).map((option) => `  --${option.name}${option.type === "string" ? " <value>" : ""}  ${option.description}${option.required ? " (required)" : ""}`).join("\n")}\nGlobal options (before or after the command): --home <path> --manifest <path> --json -h/--help.\nConfiguration is Home-scoped; --profile is not supported.\n${command?.examples?.length ? `\nExamples:\n${command.examples.join("\n")}` : ""}`;
}

/** 有界 stdin 读取；取消解除监听且不等待对端 EOF，不接管调用方 stream 的生命周期。 */
function readInput(input: NodeJS.ReadableStream, signal: AbortSignal): Promise<string> {
  return new Promise((accept, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const cleanup = () => {
      input.removeListener("data", data);
      input.removeListener("end", end);
      input.removeListener("error", fail);
      input.removeListener("close", closed);
      signal.removeEventListener("abort", abort);
      input.pause();
    };
    const fail = (error: Error) => {
      cleanup();
      reject(error);
    };
    const abort = () => fail(new Error("EXTRA_COMMAND_CANCELLED"));
    const data = (chunk: string | Buffer) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > 1024 * 1024) fail(new Error("EXTRA_CONFIG_TOO_LARGE"));
      else chunks.push(bytes);
    };
    const end = () => {
      cleanup();
      accept(Buffer.concat(chunks).toString("utf8"));
    };
    const closed = () => fail(new Error("EXTRA_COMMAND_STDIN_CLOSED"));
    input.on("data", data);
    input.once("end", end);
    input.once("error", fail);
    input.once("close", closed);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    else if ((input as NodeJS.ReadStream).readableEnded) end();
  });
}

/** 只允许插件显式构造的安全诊断进入文本输出；任意异常仍沿宿主白名单处理。 */
export function commandError(
  error: unknown
): { code: string; message: string; cause_code?: string } | undefined {
  if (error instanceof Error && /^EXTRA_COMMAND_[A-Z_]+$/.test(error.message)) {
    const failure = describeError(error);
    return { code: failure.code, message: failure.message };
  }
  if (error instanceof ExtraCommandError && /^[A-Z][A-Z0-9_]{1,100}$/.test(error.code))
    return { code: error.code, message: error.message };
  return undefined;
}
