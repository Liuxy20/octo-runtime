import { readFile } from "node:fs/promises";
import { createExtraService } from "@mininglamp-oss/octo-runtime/host";
import type { ExtraPluginModule } from "@mininglamp-oss/octo-runtime/extra";
import type {
  GatewayDependencies, ImSessionStore, LoadContexts
} from "@mininglamp-oss/octo-runtime/extras/channel-gateway";

/** 每轮读取宿主当前值；不把函数或宿主存储放进 JSON config。 */
export function liveInstructions(readText: () => string): LoadContexts {
  return (_bot, { signal }) => {
    signal.throwIfAborted();
    return [{ namespace: "octo.control", name: "instructions",
      payload: { entries: [{ text: readText() }] } }];
  };
}

/** 宿主选择文件，读取遵守本轮取消信号；文件错误使本轮失败，不沿用旧值。 */
export function fileInstructions(file: string): LoadContexts {
  return async (_bot, { signal }) => [{
    namespace: "octo.control", name: "instructions",
    payload: { entries: [{ text: await readFile(file, { encoding: "utf8", signal }) }] }
  }];
}

/** 每个 Bot 创建独立句柄；openStore 的数据库实现和共享连接由宿主提供并拥有。 */
export function sessionDependencies(
  openStore: (scope: string) => ImSessionStore
): GatewayDependencies {
  return {
    createSessionStore(bot) {
      if (typeof bot.api_url !== "string" || typeof bot.bot_id !== "string")
        throw new Error("BOT_SCOPE_REQUIRED");
      return openStore(JSON.stringify([bot.api_url, bot.bot_id]));
    }
  };
}

export interface CatalogDependencies {
  readModels(signal: AbortSignal): Promise<readonly string[]>;
}

/** 自定义 Extra 在初始化时查询宿主模型目录；这是业务依赖，不发起 AgentRun。 */
export const catalogExtra: ExtraPluginModule<CatalogDependencies> = {
  name: "model-catalog",
  default: (ctx) => async ({ readModels }) => {
    const models = await readModels(ctx.signal);
    ctx.onStatus(() => ({ models: [...models] }));
  }
};

/** 业务服务地址由宿主显式选择；调用方负责 initialize/close，Extra 不关闭 Kernel。 */
export function createCatalogService(endpoint: string, catalogUrl: string) {
  return createExtraService({
    endpoint,
    module: catalogExtra,
    config: {},
    dependencies: {
      async readModels(signal: AbortSignal): Promise<string[]> {
        const response = await fetch(catalogUrl, { signal });
        if (!response.ok) throw new Error(`CATALOG_HTTP_${response.status}`);
        const models: unknown = await response.json();
        if (!Array.isArray(models) || !models.every((model) => typeof model === "string"))
          throw new Error("CATALOG_RESPONSE_INVALID");
        return models;
      }
    }
  });
}
