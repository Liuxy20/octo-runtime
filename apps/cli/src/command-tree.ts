import { Command, CommanderError, Option, type Help } from "commander";
import { cliHelpHeader, rootCommands } from "./help.js";
import type { CliDependencies } from "./main.js";

const preferredRootCommands = [
  "start",
  "run",
  "stop",
  "restart",
  "install",
  "uninstall",
  "logs",
  "recover",
  "adapter",
  "doctor",
  "status",
  "playboard",
  "version",
  "help"
];
const commandExamples = new WeakMap<Command, readonly string[]>();
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
          "octo-runtime start",
          "octo-runtime run",
          "octo-runtime logs --follow",
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

export interface ParsedCliCommand {
  flags: Record<string, string>;
  positional: string[];
  help?: string;
}

/** CLI 只装配执行服务命令；解析和帮助不加载 Adapter、不访问 Home 或服务管理器。 */
export function parseCliCommand(
  raw: string[],
  dependencies: CliDependencies
): Promise<ParsedCliCommand> {
  void dependencies;
  return Promise.resolve().then(() => parseCommand(raw));
}

function parseCommand(raw: string[]): ParsedCliCommand {
  let help: string | undefined;
  let result: ParsedCliCommand = { flags: {}, positional: [] };
  const make = (name: string, description: string) =>
    new Command(name)
      .description(description)
      .helpOption("-h, --help", "Show help")
      .addHelpCommand(false)
      .exitOverride()
      .configureHelp({ showGlobalOptions: true, formatHelp, subcommandTerm: (cmd) => cmd.name() })
      .configureOutput({
        writeOut(text) {
          help = (help ?? "") + text;
        },
        writeErr() {}
      });
  const root = make(
    "octo-runtime",
    "Manage the local Octo Agent execution runtime.\n\nOcto Runtime by Mininglamp Technology\nhttps://github.com/Mininglamp-OSS/octo-runtime"
  );
  // 重复选项和缺值明确拒绝，不使用 Commander 后值覆盖来隐藏错误。
  const option = (command: Command, syntax: string, description: string) => {
    let seen = false;
    const value: Option = new Option(syntax, description).argParser(
      (input: string): string | boolean => {
        if (seen || (value.required && (!input || input.startsWith("--"))))
          throw new Error("INVALID_ARGUMENTS");
        seen = true;
        if (value.long === "--autostart" && !["true", "false"].includes(input))
          throw new Error("INVALID_ARGUMENTS");
        return value.required ? input : true;
      }
    );
    command.addOption(value);
    if (
      syntax.startsWith("--manifest") ||
      syntax.startsWith("--profile") ||
      (command === root &&
        ["--autostart", "--lines", "--follow", "--acknowledge-orphan-cleanup"].some((flag) =>
          syntax.startsWith(flag)
        ))
    )
      value.hideHelp();
  };
  for (const [syntax, description] of [
    ["--home <path>", "Runtime Home directory"],
    ["--manifest <path>", "Explicit Adapter manifest"],
    ["--profile <name>", "Runtime profile"],
    ["--json", "Print JSON"],
    ["-v, --version", "Print version"],
    ["--autostart <boolean>", "Automatic startup (install default: true)"],
    ["--lines <count>", "Log lines (default: 200)"],
    ["--follow", "Follow log entries"],
    ["--acknowledge-orphan-cleanup", "Confirm manual orphan cleanup"]
  ])
    option(root, syntax, description);
  const capture = (command: Command) =>
    command.action(() => {
      const path: string[] = [];
      for (let current = command; current.parent; current = current.parent)
        path.unshift(current.name());
      if (
        command !== root &&
        Object.keys(command.opts()).some((key) => Object.hasOwn(root.opts(), key))
      )
        throw new Error("INVALID_ARGUMENTS");
      const all = command.optsWithGlobals<Record<string, unknown>>();
      const flags = Object.fromEntries(
        Object.entries(all).map(([key, value]) => [
          key === "acknowledgeOrphanCleanup" ? "acknowledge-orphan-cleanup" : key,
          String(value)
        ])
      );
      result = { flags, positional: [...path, ...command.args] };
      if (command.commands.length || command === root) help = command.helpInformation();
    });
  for (const [name, description] of rootCommands) {
    if (name === "help") continue;
    const command = make(name, description);
    root.addCommand(command);
    capture(command);
    if (name === "install")
      option(command, "--autostart <boolean>", "Automatic startup (default: true)");
    if (name === "logs") {
      option(command, "--lines <count>", "Log lines (default: 200)");
      option(command, "--follow", "Follow log entries");
    }
    if (name === "recover")
      option(command, "--acknowledge-orphan-cleanup", "Confirm manual orphan cleanup");
    if (name === "adapter") {
      const list = make("list", "List execution adapters");
      const probe = make("probe", "Probe an execution adapter").argument("<type>");
      command.addCommand(list).addCommand(probe);
      capture(list);
      capture(probe);
    }
  }
  capture(root);
  let args = raw.map((arg) =>
    /^(--(?:json|follow|help|version))=/.test(arg) ? arg.split("=")[0] : arg
  );
  // 在 help/version 短路之前检查缺值；根命令不能被前置选项吞成参数值。
  let hasCommand = false;
  for (let index = 0; index < args.length; index++) {
    const token = args[index];
    const [name, inline] = token.split("=", 2);
    if (["--home", "--manifest", "--profile", "--lines", "--autostart"].includes(name)) {
      const value = inline === undefined ? args[++index] : inline;
      if (
        !value ||
        value.startsWith("-") ||
        (inline === undefined && !hasCommand && rootCommands.has(value))
      )
        throw new Error("INVALID_ARGUMENTS");
    } else if (!token.startsWith("-")) hasCommand = true;
  }
  if (args.some((arg) => ["-v", "--version"].includes(arg)))
    return { flags: { version: "true" }, positional: [] };
  // help 是命令别名；只处理首个命令 token，参数值不参与匹配。
  for (let index = 0; index < args.length; index++) {
    if (["--home", "--manifest", "--profile", "--lines", "--autostart"].includes(args[index])) {
      index++;
      continue;
    }
    if (args[index].startsWith("-")) continue;
    if (args[index] === "help") {
      args = [...args.slice(0, index), ...args.slice(index + 1), "--help"];
      index--;
      continue;
    }
    // Commander 会先处理 --help；在此拒绝未知根命令，避免已删除路径被显示为有效帮助。
    if (!rootCommands.has(args[index])) throw new Error("INVALID_ARGUMENTS");
    break;
  }
  try {
    root.parse(args, { from: "user" });
  } catch (error) {
    if (!(error instanceof CommanderError) || error.code !== "commander.helpDisplayed")
      throw new Error("INVALID_ARGUMENTS", { cause: error });
  }
  if (root.opts().version) return { flags: { version: "true" }, positional: [] };
  return help === undefined ? result : { ...result, help: help.trimEnd() };
}
