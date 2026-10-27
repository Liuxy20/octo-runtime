import { isAbsolute, join } from "node:path";
import { assertContextEnvelope } from "@mininglamp-oss/octo-runtime-protocol";
import {
  ExtraCommandError,
  configCommands,
  savedConfigResult,
  type ExtraCommandExtension,
  type JsonObject
} from "@mininglamp-oss/octo-runtime-host-sdk/extra-commands";

/** WebUI 在一个 Home 内只有 webui 这份配置；端口不是实例 ID，不创建多实例列表。 */
function validate(config: JsonObject): void {
  const port = config.port ?? 13888;
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535)
    throw new ExtraCommandError("WEBUI_PORT_INVALID", "--port must be an integer from 1 to 65535.");
  if (typeof config.sessionStorePath !== "string" || !isAbsolute(config.sessionStorePath))
    throw new ExtraCommandError(
      "WEBUI_STORE_PATH_REQUIRED",
      "config set requires sessionStorePath to be an absolute session JSON file path."
    );
  if (config.defaultProjectPath !== undefined && typeof config.defaultProjectPath !== "string")
    throw new ExtraCommandError(
      "WEBUI_PROJECT_PATH_INVALID",
      "defaultProjectPath must be a string."
    );
  if (config.context !== undefined) {
    try {
      assertContextEnvelope(config.context);
    } catch {
      throw new ExtraCommandError(
        "WEBUI_CONTEXT_INVALID",
        "context must follow the Context v3 contract."
      );
    }
  }
}
const extension: ExtraCommandExtension = {
  apiVersion: 1,
  commands: [
    {
      name: "configure",
      description: "Update the single WebUI configuration; saves only, restart to apply",
      options: [
        { name: "port", type: "string", description: "Loopback HTTP port (default 13888)" }
      ],
      examples: ["octo-runtime webui configure --port 13888"],
      async run(context, input) {
        const snapshot = await context.readConfig();
        const config = { ...snapshot.config };
        // 简化入口只暴露端口；首次会话存储从宿主 Home 推导，已有路径和项目配置保持。
        // 高级 config set 仍按原 JSON 合同完整替换，不改存储字段名或隐式迁移数据。
        if (config.sessionStorePath === undefined)
          config.sessionStorePath = join(context.home, "extras", context.name, "sessions.json");
        const port = input.options.port;
        if (typeof port === "string") {
          if (!/^[0-9]+$/.test(port))
            throw new ExtraCommandError(
              "WEBUI_PORT_INVALID",
              "--port must be an integer from 1 to 65535."
            );
          config.port = Number(port);
        }
        validate(config);
        return savedConfigResult(await context.saveConfig(config, snapshot.revision));
      }
    },
    configCommands(validate)
  ]
};
export default extension;
