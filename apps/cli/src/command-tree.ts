import { Command, CommanderError, Option, type Help } from "commander";
import { resolve } from "node:path";
import type { ExtraModuleEntry } from "@mininglamp-oss/octo-runtime-adapter-sdk/module-manifest";
import type { ExtraCommand, ExtraCommandInput } from "@mininglamp-oss/octo-runtime-host-sdk";
import { cliHelpHeader, lifecycleCommands, preferredRootCommands, rootCommands } from "./help.js";
import { loadCliManifest } from "./module-manifest.js";
import { loadExtraCommands, validateCommands } from "./extra-commands.js";
import { defaultRuntimeHome } from "./state.js";
import type { CliDependencies } from "./main.js";

export interface ParsedCliCommand {
  flags: Record<string, string>;
  positional: string[];
  help?: string;
  extra?: {
    entry: ExtraModuleEntry;
    command: ExtraCommand;
    input: ExtraCommandInput;
    home: string;
  };
}

const hostStrings = new Set(["home", "manifest", "profile"]);
const hostBooleans = new Set(["help", "json", "version", "follow"]);
const commandExamples = new WeakMap<Command, readonly string[]>();
const nativeOptions = [
  ["--autostart <boolean>", "Enable automatic startup: true or false (install default: true)"],
  ["--lines <count>", "Number of lines, 1..10000 (default: 200)"],
  ["--follow", "Follow new log entries"],
  [
    "--acknowledge-orphan-cleanup",
    "Confirm manual cleanup; preserve evidence and reject a live owner"
  ]
] as const;

/** 仅统一布局；列宽、换行、命令/参数可见性都使用 Commander 的 Help 实现。 */
function formatHelp(command: Command, helper: Help): string {
  const width = helper.padWidth(command, helper);
  const children = helper.visibleCommands(command);
  if (!command.parent) {
    const rank = (cmd: Command) => {
      const index = preferredRootCommands.indexOf(cmd.name());
      return index < 0 ? preferredRootCommands.length : index;
    };
    children.sort(
      (left, right) => rank(left) - rank(right) || left.name().localeCompare(right.name())
    );
  }
  const examples =
    commandExamples.get(command) ??
    (command.parent
      ? children.map((child) => `${commandPath(child).join(" ")} --help`)
      : [
          ...children
            .filter((child) => child.commands.some((action) => action.name() === "start"))
            .slice(0, 4)
            .map(
              (child) =>
                `${commandPath(child).join(" ")} ${child.name() === "executor-kernel" ? "start" : "--help"}`
            ),
          "octo-runtime status"
        ]);
  const section = (title: string, rows: [string, string][]) =>
    rows.length
      ? [
          title,
          ...rows.map(([term, description]) => helper.formatItem(term, width, description, helper)),
          ""
        ]
      : [];
  return [
    ...(!command.parent ? [cliHelpHeader, ""] : []),
    helper.commandDescription(command),
    "",
    "Usage:",
    `  ${helper.commandUsage(command)}`,
    "",
    ...(examples.length
      ? [
          "Examples:",
          ...examples.flatMap((example) => example.split("\n").map((line) => `  ${line}`)),
          ""
        ]
      : []),
    ...section(
      "Available Commands:",
      children.map((child) => [child.name(), helper.subcommandDescription(child)])
    ),
    ...section(
      "Arguments:",
      helper
        .visibleArguments(command)
        .map((arg) => [helper.argumentTerm(arg), helper.argumentDescription(arg)])
    ),
    ...section(
      "Flags:",
      helper
        .visibleOptions(command)
        .map((option) => [helper.optionTerm(option), helper.optionDescription(option)])
    ),
    ...section(
      "Global Flags:",
      helper
        .visibleGlobalOptions(command)
        .map((option) => [helper.optionTerm(option), helper.optionDescription(option)])
    ),
    ...(command.commands.length
      ? [
          `Use "${commandPath(command).join(" ")} [command] --help" for more information about a command.`,
          ""
        ]
      : [])
  ].join("\n");
}

function commandPath(command: Command): string[] {
  return command.parent ? [...commandPath(command.parent), command.name()] : [command.name()];
}

/** 示例配置归目录声明；单引号按 shell 规则转义，展示不导入业务模块、不读取已存凭据。 */
function extrasetExample(
  name: string,
  config: Record<string, unknown> = {},
  module?: string
): string {
  // 旧配置外壳不接受相对模块路径；这类目录仍省略兼容字段，避免示例无法保存。
  const declaration = {
    ...(module && !module.startsWith(".") ? { module } : {}),
    enabled: true,
    config
  };
  const json = JSON.stringify(declaration, null, 2).replaceAll("'", "'\\''");
  return `octo-runtime ${name} extraset <<< '${json}'`;
}

function command(name: string, description: string): Command {
  return new Command(name)
    .description(description)
    .helpOption("-h, --help", `help for ${name}`)
    .addHelpCommand(false)
    .configureHelp({
      showGlobalOptions: true,
      sortSubcommands: false,
      sortOptions: true,
      subcommandTerm: (cmd) => cmd.name(),
      formatHelp
    })
    .exitOverride()
    .configureOutput({ writeOut() {}, writeErr() {} });
}

/** 参数重复及缺值仍按现有 CLI 合同拒绝，避免 Commander 的后值覆盖掩盖输入错误。 */
function option(
  cmd: Command,
  syntax: string,
  description: string,
  raw: string[],
  business = false
): Option {
  const value = new Option(syntax, description);
  // Extra 的布尔名称是原样的业务键，no- 前缀不代表 Commander 的反向默认值。
  if (business) {
    value.negate = false;
    value.attributeName = () => value.name();
    // constructor 也是合法业务键；显式空值避免继承原型属性并误通过必填检查。
    cmd.setOptionValue(value.name(), undefined);
  }
  let seen = false;
  value.argParser((input: string) => {
    // 仅在 Commander 实际消费本命令的选项时检查，兄弟命令可声明同名但不同类型的选项。
    // 仍按原始边界拒绝缺值，避免祖先先取走 --home X 后将 --port 123 拼成合法输入。
    const literalIndex = raw.indexOf("--");
    const tokens = literalIndex < 0 ? raw : raw.slice(0, literalIndex);
    if (
      business &&
      value.required &&
      tokens.some(
        (token, index) =>
          token === value.long && (!tokens[index + 1] || tokens[index + 1].startsWith("-"))
      )
    )
      throw new Error("INVALID_ARGUMENTS");
    if (seen) throw new Error("INVALID_ARGUMENTS");
    seen = true;
    if (
      value.required &&
      (!input ||
        (input.startsWith(business ? "-" : "--") && !raw.includes(`${value.long}=${input}`)))
    )
      throw new Error("INVALID_ARGUMENTS");
    if (value.long === "--autostart" && !["true", "false"].includes(input))
      throw new Error("INVALID_ARGUMENTS");
    return value.required ? input : true;
  });
  cmd.addOption(value);
  return value;
}

function addHostOptions(root: Command, raw: string[], profile = true): void {
  option(root, "--home <path>", "Runtime Home directory", raw);
  option(root, "--manifest <path>", "Use an explicit module manifest", raw).hideHelp();
  option(root, "--json", "Print machine-readable JSON", raw);
  option(root, "--profile <name>", "Select a runtime profile", raw).hideHelp(!profile);
}

/** 保留既有宿主布尔等号形式；-- 后的位置参数及业务选项原样交给 Commander。 */
function normalize(args: string[]): string[] {
  let literal = false;
  return args.map((arg) => {
    if (arg === "--") literal = true;
    const match = !literal && /^--([^=]+)=/.exec(arg);
    return match && hostBooleans.has(match[1]) ? `--${match[1]}` : arg;
  });
}

/** help 路径只改写命令位置，不把 --home help 等参数值误当成帮助命令。 */
function helpAlias(args: string[]): string[] {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") return args;
    if (arg.startsWith("-")) {
      if (hostStrings.has(arg.slice(2))) i++;
      continue;
    }
    return arg === "help" ? [...args.slice(0, i), ...args.slice(i + 1), "--help"] : args;
  }
  return args;
}

/**
 * 两阶段装配：先只解析宿主选择参数，再为有效目录挂载命令。
 * 根帮助不 import Extra；离线服务动作不加载 /commands；所选业务树才递归适配。
 * 本函数只返回调用描述或帮助文本，不运行 handler、不访问服务管理器、不写 Home。
 */
export async function parseCliCommand(
  raw: string[],
  dependencies: CliDependencies
): Promise<ParsedCliCommand> {
  const args = normalize(helpAlias(raw));
  const selector = command("octo-runtime", "").helpOption(false);
  addHostOptions(selector, args);
  option(selector, "-h, --help", "Help", args);
  option(selector, "-v, --version", "Version", args);
  for (const [syntax, description] of nativeOptions) option(selector, syntax, description, args);
  let operands: string[];
  try {
    operands = selector.parseOptions(args).operands;
  } catch (error) {
    if (error instanceof CommanderError) throw new Error("INVALID_ARGUMENTS", { cause: error });
    throw error;
  }
  const selected = selector.opts<Record<string, string>>();
  // 版本属于全局元数据查询；不依赖后续命令、业务必填项或可用的模块目录。
  if (selected.version) return { flags: { version: "true" }, positional: [] };
  const name = operands[0];
  // 旧顶层写法继续执行；显式查看旧入口帮助时指向同一组件下的规范路径。
  if (selected.help && ["extraset", "extraget"].includes(name)) {
    const target = operands[1];
    const globalArgs = [...hostStrings].flatMap((key) =>
      selected[key] ? [`--${key}=${selected[key]}`] : []
    );
    return parseCliCommand(
      [...globalArgs, ...(target ? [target, name] : []), "--help"],
      dependencies
    );
  }
  const home = resolve(
    selected.home ?? defaultRuntimeHome(dependencies.env, dependencies.platform)
  );
  const isExtra = Boolean(name && !rootCommands.has(name));
  const offline = isExtra && lifecycleCommands.has(operands[1]);
  const needsDirectory = !selected.version && (!name || (isExtra && !offline));
  const entries = needsDirectory
    ? (await loadCliManifest(home, selected.manifest, dependencies.errorOutput)).extras
    : [];
  if (entries.some((entry) => rootCommands.has(entry.name)))
    throw new Error("EXTRA_COMMAND_NAMESPACE_CONFLICT");
  const entry = entries.find((entry) => entry.name === name);
  const extension = entry ? await loadExtraCommands(entry) : undefined;
  if (extension) validateCommands(extension);
  // 已登记服务必须在模块丢失时仍能停止/卸载；真实存在性由原生命周期入口核验。
  if (offline) {
    let metadata: ExtraModuleEntry | undefined;
    // 离线帮助尽量读取公开示例；损坏的目录不能阻断停止、卸载或完整配置修复。
    if (selected.help && operands[1] === "extraset") {
      try {
        metadata = (await loadCliManifest(home, selected.manifest, () => {})).extras.find(
          (item) => item.name === name
        );
      } catch {
        // 元数据不可用时仍展示通用 JSON 外壳，实际动作保持既有离线路径。
      }
    }
    entries.push(metadata ?? { name, module: "", sourceManifest: "" });
  }

  const root = command(
    "octo-runtime",
    "Manage the local Octo Agent runtime and independent services."
  );
  addHostOptions(
    root,
    args,
    !isExtra || (offline && !["extraset", "extraget"].includes(operands[1]))
  );
  option(root, "-v, --version", "Print version and build information", args);
  // 旧服务参数可位于组件之前；根仅隐藏解析，所属动作仍在本层帮助展示。
  // 业务树不开放这些选项，继续由 Extra 自己定义和校验输入。
  if (!isExtra || offline)
    for (const [syntax, description] of nativeOptions)
      option(root, syntax, description, args).hideHelp();
  let result: ParsedCliCommand = { flags: {}, positional: [] };
  let help: string | undefined;
  const configure = (cmd: Command) => {
    cmd.configureOutput({
      writeOut: (text) => {
        help = (help ?? "") + text;
      },
      writeErr() {}
    });
    cmd.exitOverride();
  };
  const capture = (cmd: Command, definition?: ExtraCommand) => {
    configure(cmd);
    cmd.action(() => {
      if (cmd !== root && Object.keys(cmd.opts()).some((key) => Object.hasOwn(root.opts(), key)))
        throw new Error("INVALID_ARGUMENTS");
      const all = cmd.optsWithGlobals<Record<string, string | boolean>>();
      const flags = Object.fromEntries(
        Object.entries(root.opts()).map(([key, value]) => [key, String(value)])
      );
      for (const key of ["autostart", "lines", "follow", "acknowledgeOrphanCleanup"])
        if (all[key] !== undefined)
          flags[key === "acknowledgeOrphanCleanup" ? "acknowledge-orphan-cleanup" : key] = String(
            all[key]
          );
      const path = commandPath(cmd).slice(1);
      // 新入口和隐藏旧入口共用完整声明的原子读写，保持完整声明语义，不生成额外的业务配置命令。
      if (path.length === 2 && ["extraset", "extraget"].includes(path[1])) path.reverse();
      result = { flags, positional: [...path, ...cmd.args] };
      if (definition && entry) {
        if (all.profile !== undefined) throw new Error("INVALID_ARGUMENTS");
        const values = cmd.opts<Record<string, string | boolean>>();
        const options = Object.fromEntries(
          (definition.options ?? [])
            .filter((opt) => values[opt.name] !== undefined)
            .map((opt) => [opt.name, values[opt.name]])
        );
        result.extra = {
          entry,
          command: definition,
          input: { options, arguments: cmd.args },
          home
        };
      }
      if (cmd.commands.length || cmd === root) help = cmd.helpInformation().trimEnd();
    });
  };
  const leaf = (parent: Command, name: string, description: string, hidden = false) => {
    const child = command(name, description);
    parent.addCommand(child, { hidden });
    capture(child);
    return child;
  };
  const service = (
    name: string,
    description: string,
    configExample?: Record<string, unknown>,
    module?: string
  ) => {
    const parent = leaf(root, name, description);
    const prefix = `octo-runtime ${name}`;
    commandExamples.set(parent, [
      `${prefix} start`,
      `${prefix} status`,
      ...(name === "executor-kernel" ? [] : [extrasetExample(name, configExample, module)])
    ]);
    for (const [action, summary] of lifecycleCommands) {
      if (name === "executor-kernel" && ["extraset", "extraget"].includes(action)) continue;
      const child = leaf(parent, action, summary);
      const invocation = `${prefix} ${action}`;
      commandExamples.set(child, [
        action === "extraset" ? extrasetExample(name, configExample, module) : invocation,
        ...(action === "install" ? [`${invocation} --autostart=false`] : []),
        ...(action === "logs" ? [`${invocation} --lines 200 --follow`] : [])
      ]);
      if (action === "install")
        option(
          child,
          "--autostart <boolean>",
          "Enable automatic startup: true or false (install default: true)",
          args
        );
      if (action === "extraset")
        child.addHelpText(
          "after",
          "\nReads {config, enabled?, module?} from stdin. Replaces the whole declaration; restart to apply."
        );
      if (action === "extraget")
        child.addHelpText("after", "\nReturns the complete declaration, INCLUDING CREDENTIALS.");
      if (action === "logs") {
        option(child, "--lines <count>", "Number of lines, 1..10000 (default: 200)", args);
        option(child, "--follow", "Follow new log entries", args);
      }
    }
    return parent;
  };
  for (const [name, description] of rootCommands) {
    if (name === "help") continue;
    const cmd =
      name === "executor-kernel"
        ? service(name, description)
        : leaf(root, name, description, ["extraset", "extraget"].includes(name));
    if (name === "executor-kernel") {
      const recover = leaf(
        cmd,
        "recover",
        "Acknowledge orphan cleanup after stopping all orphan tools"
      );
      commandExamples.set(recover, [
        "octo-runtime executor-kernel recover --acknowledge-orphan-cleanup"
      ]);
      option(
        recover,
        "--acknowledge-orphan-cleanup",
        "Confirm manual cleanup; preserve evidence and reject a live owner",
        args
      );
    }
    if (name === "adapter") {
      const list = leaf(cmd, "list", "List execution adapters");
      commandExamples.set(list, ["octo-runtime adapter list"]);
      const probe = leaf(cmd, "probe", "Probe one execution adapter").argument("<type>");
      commandExamples.set(probe, ["octo-runtime adapter probe <type>"]);
    }
    if (["status", "doctor", "version"].includes(name))
      commandExamples.set(cmd, [`octo-runtime ${name}`]);
    if (name === "playboard") commandExamples.set(cmd, ["octo-runtime playboard < request.json"]);
    if (name === "extraset" || name === "extraget") {
      cmd.argument("<name>");
      cmd.addHelpText(
        "after",
        name === "extraget"
          ? "\nReturns the complete configuration, INCLUDING CREDENTIALS."
          : "\nReads a complete configuration envelope from stdin JSON. Restart the service to apply."
      );
    }
  }
  const addBusiness = (parent: Command, definitions: readonly ExtraCommand[]) => {
    for (const definition of definitions) {
      const child = command(definition.name, definition.description);
      parent.addCommand(child);
      for (const item of definition.options ?? []) {
        const flag = option(
          child,
          `--${item.name}${item.type === "string" ? " <value>" : ""}`,
          `${item.description}${item.required ? " (required)" : ""}`,
          args,
          true
        );
        flag.makeOptionMandatory(Boolean(item.required));
      }
      for (const item of definition.arguments ?? [])
        child.argument(item.required ? `<${item.name}>` : `[${item.name}]`);
      if (definition.examples?.length) commandExamples.set(child, definition.examples);
      capture(child, definition);
      if (definition.commands) addBusiness(child, definition.commands);
    }
  };
  for (const extra of entries) {
    const parent = service(
      extra.name,
      extra.description ?? `Manage the ${extra.name} service`,
      extra.configExample,
      extra.module
    );
    if (extra === entry && extension) {
      addBusiness(parent, extension.commands);
      commandExamples.set(parent, [
        ...commandExamples.get(parent)!,
        `octo-runtime ${extra.name} ${extension.commands[0].name} --help`
      ]);
    }
  }
  // help 路径在装配前转换，目录中仍提供真实可用的帮助入口。
  leaf(root, "help", "Help about any command").argument("[command...]");
  capture(root);
  try {
    root.parse(args, { from: "user" });
  } catch (error) {
    if (!(error instanceof CommanderError)) throw error;
    if (error.code !== "commander.helpDisplayed")
      throw new Error(
        isExtra && error.code === "commander.unknownCommand"
          ? "EXTRA_COMMAND_NOT_FOUND"
          : "INVALID_ARGUMENTS",
        { cause: error }
      );
  }
  if (root.opts().version) return { flags: { version: "true" }, positional: [] };
  if (help !== undefined) {
    // Extra 自有配置的 profile 禁令在帮助入口同样生效，服务动作保留原合同。
    if (isExtra && !offline && selected.profile !== undefined) throw new Error("INVALID_ARGUMENTS");
    return { ...result, help: help.trimEnd() };
  }
  return result;
}
