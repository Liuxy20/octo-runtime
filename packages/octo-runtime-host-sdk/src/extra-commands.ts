import type { JsonObject, JsonValue } from "./extras.js";

/** Extra 自有命令的版本化声明；导入模块只声明命令，不初始化服务或访问业务后端。 */
export interface ExtraCommandExtension {
  apiVersion: 1;
  commands: readonly ExtraCommand[];
}
export interface ExtraCommandOption {
  name: string;
  description: string;
  type: "string" | "boolean";
  required?: boolean;
}
export interface ExtraCommand {
  name: string;
  description: string;
  options?: readonly ExtraCommandOption[];
  /** 按顺序消费位置参数；不声明就拒绝额外参数，-- 后的文本仍按此声明校验。 */
  arguments?: readonly { name: string; required?: boolean }[];
  examples?: readonly string[];
  commands?: readonly ExtraCommand[];
  run?: (
    context: ExtraCommandContext,
    input: ExtraCommandInput
  ) => Promise<ExtraCommandResult | void>;
}
export interface ExtraCommandInput {
  options: Readonly<Record<string, string | boolean>>;
  arguments: readonly string[];
}
export interface ExtraCommandResult {
  /** 可选的普通终端安全提示；--json 时输出 value，不从业务 JSON 字段猜测格式。 */
  message?: string;
  value?: JsonValue;
  exitCode?: number;
}
export interface ExtraConfigSnapshot {
  config: JsonObject;
  /** 宿主生成的不透明修订，用于保存时检查整份声明是否发生并发变化。 */
  revision: string;
}
export interface ExtraConfigSaved {
  saved: true;
  name: string;
  file: string;
  reload_required: true;
}
/**
 * CLI 拥有 Home、IO 与取消信号；业务实现先读快照、在锁外完成交互/校验，再保存。
 * saveConfig 只写当前 Extra 的 config，保留宿主字段；冲突须重新读取，不能盲目重试。
 * output/prompt 的文本由插件负责脱敏；凭据输入方式归 Extra 决定，不使用会回显的 prompt。
 */
export interface ExtraCommandContext {
  readonly home: string;
  readonly name: string;
  readonly signal: AbortSignal;
  readonly interactive: boolean;
  readConfig(): Promise<ExtraConfigSnapshot>;
  saveConfig(config: JsonObject, revision: string): Promise<ExtraConfigSaved>;
  readStdin(): Promise<string>;
  output(text: string): void;
  prompt(question: string): Promise<string>;
}
/** 可公开的固定诊断；不得把凭据、用户输入或后端错误正文拼入 code/message。 */
export class ExtraCommandError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ExtraCommandError";
  }
}

/** 共享 JSON 传输外壳；业务校验回调由各 Extra 提供，宿主不解释业务字段。 */
export function configCommands(validate: (value: JsonObject) => void): ExtraCommand {
  return {
    name: "config",
    description: "Read or replace business configuration (advanced JSON interface)",
    commands: [
      {
        name: "set",
        description:
          "Replace business config from stdin JSON; preserves host fields; restart to apply",
        async run(context) {
          const snapshot = await context.readConfig();
          let value: unknown;
          try {
            value = JSON.parse(await context.readStdin());
          } catch (error) {
            if (!(error instanceof SyntaxError)) throw error;
            throw new ExtraCommandError(
              "EXTRA_CONFIG_INVALID",
              "stdin must contain one business JSON object, without the extraset envelope."
            );
          }
          if (
            !value ||
            typeof value !== "object" ||
            Array.isArray(value) ||
            Object.hasOwn(value, "config")
          )
            throw new ExtraCommandError(
              "EXTRA_CONFIG_INVALID",
              "Expected a business JSON object, without the extraset envelope."
            );
          const config = value as JsonObject;
          validate(config);
          return savedConfigResult(await context.saveConfig(config, snapshot.revision));
        }
      },
      {
        name: "get",
        description:
          "Print business JSON INCLUDING CREDENTIALS; use only with a trusted destination",
        async run(context) {
          return { value: (await context.readConfig()).config };
        }
      }
    ]
  };
}

export type { JsonObject, JsonValue } from "./extras.js";

/** 将宿主保存回执转换为明确的文本/JSON 输出；业务对象不参与回执识别。 */
export function savedConfigResult(saved: ExtraConfigSaved): ExtraCommandResult {
  return {
    value: { ...saved },
    message: `${saved.name}: configuration saved. Restart this Extra to apply it.\nConfig file: ${saved.file}`
  };
}
