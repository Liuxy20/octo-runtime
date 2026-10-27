import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describeError } from "./output.js";
import { dirname, isAbsolute, join } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  ExtraCommandError,
  type ExtraCommand,
  type ExtraCommandContext,
  type ExtraCommandExtension
} from "@mininglamp-oss/octo-runtime-host-sdk";
import {
  resolveModuleSpecifier,
  type ExtraModuleEntry
} from "@mininglamp-oss/octo-runtime-adapter-sdk/module-manifest";
import { commandConfig } from "./extra-command-config.js";
import { runtimePaths } from "./state.js";
import { resolveExtraModule } from "./global-extras.js";
import { lifecycleCommands } from "./help.js";
import type { ParsedCliCommand } from "./command-tree.js";
import type { CliDependencies } from "./main.js";

const reservedOptions = new Set([
  "home",
  "manifest",
  "profile",
  "json",
  "help",
  "version",
  "autostart",
  "lines",
  "follow",
  "acknowledge-orphan-cleanup"
]);
const validName = /^[a-z][a-z0-9-]{0,63}$/;
const validOptionName = /^[a-z][a-z0-9_-]{0,63}$/;

/** 仅执行已解析的自有命令；CLI 持有 IO、取消与配置锁，业务 handler 不管理宿主服务。 */
export async function runExtraCommand(
  parsed: ParsedCliCommand,
  dependencies: CliDependencies
): Promise<number> {
  const { entry, command, input: commandInput, home: commandHome } = parsed.extra!;
  const { flags } = parsed;
  const name = entry.name;
  const output =
    dependencies.output ??
    ((line: string) => {
      process.stdout.write(`${line}\n`);
    });
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
    const result = await command.run!(context, commandInput);
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

export function validateCommands(extension: ExtraCommandExtension): void {
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
        lifecycleCommands.has(command.name) ||
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
