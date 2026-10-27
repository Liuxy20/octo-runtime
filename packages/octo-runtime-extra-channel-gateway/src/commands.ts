import {
  ExtraCommandError,
  configCommands,
  savedConfigResult,
  type ExtraCommandExtension,
  type JsonObject
} from "@mininglamp-oss/octo-runtime-host-sdk/extra-commands";
import { validateImBots } from "./lifecycle/configuration.js";

/** 离线业务校验复用运行时 Bot 合同；不认证、不构造 manager 或服务。 */
function validate(config: JsonObject): void {
  try {
    validateImBots(config.bots ?? []);
    const spaces = config.authorized_space_ids;
    if (
      spaces !== undefined &&
      (!Array.isArray(spaces) || spaces.some((id) => typeof id !== "string" || !id.trim()))
    )
      throw new Error("IM_AUTHORIZED_SPACES_INVALID");
    const settings = config.context_loading;
    if (settings !== undefined) {
      if (
        !settings ||
        typeof settings !== "object" ||
        Array.isArray(settings) ||
        Object.keys(settings).some((key) => !["timeout_ms", "max_in_flight"].includes(key))
      )
        throw new Error("IM_CONTEXT_LOADING_CONFIG_INVALID");
      for (const [key, max] of [
        ["timeout_ms", 30000],
        ["max_in_flight", 32]
      ] as const) {
        const value = settings[key];
        if (
          value !== undefined &&
          (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > max)
        )
          throw new Error("IM_CONTEXT_LOADING_CONFIG_INVALID");
      }
    }
  } catch (error) {
    const hints: Record<string, string> = {
      IM_BOT_ID_REQUIRED: "Provide a non-empty --bot_id (JSON: bots[].bot_id).",
      IM_ADAPTER_REQUIRED:
        "Each Bot requires an adapter object; configure maps --adapter_type/--workdir to it.",
      IM_WORKDIR_ABSOLUTE_REQUIRED: "Provide an absolute --workdir for a local adapter.",
      IM_OPENCLAW_WORKDIR_UNSUPPORTED:
        "OpenClaw uses its own workspace; remove adapter.workdir using config set.",
      IM_PROVIDER_AGENT_ID_UNSUPPORTED: "--provider_agent_id is supported only by OpenClaw.",
      IM_API_URL_INVALID:
        "Use a valid endpoint URL without credentials, query or fragment; insecure URLs are loopback-only.",
      IM_BOT_DUPLICATED: "Duplicate Bot identity in bots; keep one entry per endpoint and bot_id.",
      IM_CONFIG_LIST_REQUIRED: "bots must be an array within this Extra's Bot limit.",
      IM_AUTHORIZED_SPACES_INVALID: "authorized_space_ids must contain non-empty strings.",
      IM_CONTEXT_LOADING_CONFIG_INVALID:
        "context_loading accepts timeout_ms (1..30000) and max_in_flight (1..32)."
    };
    const code =
      error instanceof Error && Object.hasOwn(hints, error.message)
        ? error.message
        : "EXTRA_CONFIG_INVALID";
    throw new ExtraCommandError(
      code,
      hints[code] ??
        "Invalid Bot configuration. Check config set --help and this Extra's configuration schema."
    );
  }
}

/** 单 Bot 配置命令按 bot_id upsert；省略字段保留，重复调用不会追加相同 Bot。 */
const extension: ExtraCommandExtension = {
  apiVersion: 1,
  commands: [
    {
      name: "configure",
      description: "Add or update one Bot by bot_id; saves config only",
      options: [
        { name: "bot_id", type: "string", required: true, description: "Platform Bot ID" },
        { name: "api_url", type: "string", required: true, description: "Octo API base URL" },
        {
          name: "adapter_type",
          type: "string",
          description: "Execution adapter type (adapter.adapter_type)"
        },
        { name: "workdir", type: "string", description: "Absolute local execution directory" },
        { name: "model", type: "string", description: "Provider model ID" },
        {
          name: "effort",
          type: "string",
          description: "Reasoning effort: low, medium, high, xhigh"
        },
        { name: "provider_agent_id", type: "string", description: "Existing OpenClaw Agent ID" },
        {
          name: "bf_token",
          type: "string",
          description: "Raw credential (bots[].bf_token); omitted values are preserved"
        }
      ],
      examples: [
        "octo-runtime channel-gateway configure --bot_id assistant --api_url https://im.example.com/api --adapter_type codex --bf_token EXAMPLE_CREDENTIAL"
      ],
      async run(context, input) {
        const snapshot = await context.readConfig();
        validate(snapshot.config);
        const bots = snapshot.config.bots ?? [];
        validateImBots(bots);
        const identityFields = {
          bot_id: input.options["bot_id"],
          api_url: input.options["api_url"]
        };
        // configure 用 bot_id 定位，更新 endpoint 不产生第二个 Bot。
        // 旧 extraset 可能含跨 endpoint 的同名 Bot：保留首项未提供的字段，合并为一项。
        const position = bots.findIndex((bot) => bot.bot_id === identityFields.bot_id);
        const old = position < 0 ? undefined : bots[position];
        const adapter: JsonObject = { ...old?.adapter };
        for (const field of ["adapter_type", "workdir", "model", "effort", "provider_agent_id"]) {
          const value = input.options[field];
          if (typeof value === "string") adapter[field] = value;
        }
        if (
          adapter.effort !== undefined &&
          (typeof adapter.effort !== "string" ||
            !["low", "medium", "high", "xhigh"].includes(adapter.effort))
        )
          throw new ExtraCommandError(
            "EXTRA_CONFIG_INVALID",
            "--effort must be low, medium, high or xhigh."
          );
        const bot = { ...old, ...identityFields, adapter } as unknown as JsonObject;
        const credential = input.options.bf_token;
        if (typeof credential === "string") {
          if (!credential.trim())
            throw new ExtraCommandError("EXTRA_CONFIG_INVALID", "--bf_token must not be blank.");
          // 与 extraset 的业务字段同名；保存传入原文，省略时保留已有凭据。
          bot.bf_token = credential;
        }
        const nextBots = bots.filter(
          (bot, index) => index === position || bot.bot_id !== identityFields.bot_id
        ) as unknown as JsonObject[];
        if (position < 0) nextBots.push(bot);
        else nextBots[position] = bot;
        const config: JsonObject = { ...snapshot.config, bots: nextBots };
        validate(config);
        return savedConfigResult(await context.saveConfig(config, snapshot.revision));
      }
    },
    configCommands(validate)
  ]
};
export default extension;
