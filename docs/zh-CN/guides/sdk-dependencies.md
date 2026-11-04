# SDK 高级接入：宿主依赖

[English](../../en/guides/sdk-dependencies.md) | [SDK 接入](../getting-started/sdk.md)

先完成 KernelService 与 ChannelGateway ExtraService 接入，再按业务需要注入依赖。函数放在 `createExtraService({ dependencies })`，配置值放在 `config`；函数与闭包留在宿主进程，不经过 Kernel RPC。

## 1. 选择依赖入口

| 入口 | 签名 | 使用场景 |
| --- | --- | --- |
| Gateway `loadContexts` | `(botConfig, { signal }) => readonly ContextItem[] \| Promise<readonly ContextItem[]>` | 每轮读取当前指令、项目资料或数据库快照 |
| Gateway `createSessionStore` | `(botConfig: JsonObject) => ImSessionStore` | 持久会话、同 Bot 重启续接、接入宿主已有存储 |
| 自定义 Extra dependencies | 由该 Extra 的 `ExtraPluginModule<D>` 声明 | 查询模型目录、订阅宿主事件、调用已定义的业务函数 |

Gateway 当前的公开依赖是前两项。其他字段不会自动生效，必须由自定义 Extra 声明并消费。可编译的完整例子见 [sdk-dependencies.mts](../../examples/sdk-dependencies.mts)。

## 2. loadContexts：每轮取得当前业务数据

### 2.1 读取内存中的最新指令

适用于 Electron 设置页修改提示词后，下一轮立即生效。函数引用不变，读取的宿主值可以改变。

```ts
import type { LoadContexts } from "@mininglamp-oss/octo-runtime/extras/channel-gateway";

export function liveInstructions(readText: () => string): LoadContexts {
  return (_bot, { signal }) => {
    signal.throwIfAborted();
    return [{ namespace: "octo.control", name: "instructions",
      payload: { entries: [{ text: readText() }] } }];
  };
}

let instructions = "Answer concisely.";
const dependencies = { loadContexts: liveInstructions(() => instructions) };
// 将 dependencies 传给 createExtraService；之后更新值无需重建服务。
instructions = "Answer in Chinese.";
```

### 2.2 异步读取文件或数据库

适用于每轮读取项目说明，或调用宿主数据库/API。示例读取宿主选定文件，IO 传递本轮 `signal`；数据库也应按同样方式处理取消。

```ts
import { readFile } from "node:fs/promises";
import type { LoadContexts } from "@mininglamp-oss/octo-runtime/extras/channel-gateway";

export function fileInstructions(file: string): LoadContexts {
  return async (_bot, { signal }) => [{
    namespace: "octo.control", name: "instructions",
    payload: { entries: [{ text: await readFile(file, { encoding: "utf8", signal }) }] }
  }];
}

const dependencies = { loadContexts: fileInstructions("/absolute/project/instructions.txt") };
```

返回 `ContextItem[]`，不要返回 envelope。动态项按 `namespace/name` 整项替换静态项；`[]` 保留静态配置。失败或超时使本轮准备失败，不沿用旧数据；不要使用渠道保留的 `extra.im`。默认读取期限 5 秒、实际在途上限 8，结果最多 32 项 / 64 KiB；详见 [Extra 合同](extras.md)。

## 3. createSessionStore：接入宿主会话存储

适用于需要重启后保留会话映射的应用。宿主提供同步 `openStore(scope)`，返回实现完整 `ImSessionStore` 的独立句柄；工厂每个 Bot 调用一次，不是每条消息调用一次。

```ts
import type { GatewayDependencies, ImSessionStore } from "@mininglamp-oss/octo-runtime/extras/channel-gateway";

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
```

将宿主存储工厂传给 `sessionDependencies(openStore)`，其返回值作为 Gateway 的 `dependencies`；也可加上上一节的 `loadContexts`。SDK 不指定 SQLite 或其他数据库，不负责建表、迁移、容量和保留策略。

| 存储接口 | 宿主实现责任 |
| --- | --- |
| `read` / `save` / `reset` | 会话绑定与代次；重复 controlId 的 reset 不重复推进 |
| `occurrence` / `remember` | 入站消息与执行记录关联 |
| `patchGap` / `patchRules` / `invalidateRules` | 按 session/generation 校验和更新；不能把旧会话更新写入新会话 |
| `close` | 释放这个 Bot 的句柄；共享数据库仍由宿主拥有 |

完整接口与内存实现示例见 [Gateway 存储示例](../../../test-support/public-extra/gateway-store.mts)。该示例不证明磁盘持久性。未提供工厂时使用默认内存存储。退出先等待 Extra 排空业务读写，再关闭 Kernel 和宿主数据库；`complete=false` 不能当作所有读写已停止。

## 4. 自定义 Extra：注入业务函数

下面的 Extra 在初始化时查询宿主模型目录并通过 status 暴露结果，不发起 AgentRun。`readModels` 是这个 Extra 自己声明的依赖，不能直接塞进 Gateway 期待其调用。

```ts
import { createExtraService } from "@mininglamp-oss/octo-runtime/host";
import type { ExtraPluginModule } from "@mininglamp-oss/octo-runtime/extra";

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
export function createCatalogService(home: string, endpoint: string, catalogUrl: string) {
  return createExtraService({
    home,
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
```

宿主调用 `createCatalogService(home, endpoint, catalogUrl)`，随后 initialize/status/close；取消通过 `signal` 传给网络请求。若自定义 Extra 订阅宿主事件或持有定时器，必须在 `ctx.onDispose` 注销并等待尾部工作。业务授权、凭据与是否发布数据由宿主和该 Extra 决定。
