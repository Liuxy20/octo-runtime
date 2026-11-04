# Advanced SDK Integration: Host Dependencies

[简体中文](../../zh-CN/guides/sdk-dependencies.md) | [SDK Integration](../getting-started/sdk.md)

After integrating KernelService and ChannelGateway ExtraService, inject dependencies as needed. Put functions in `createExtraService({ dependencies })` and JSON values in `config`. Functions and closures stay in the host process and do not cross Kernel RPC.

## 1. Choose a Dependency

| Entry | Signature | Use case |
| --- | --- | --- |
| Gateway `loadContexts` | `(botConfig, { signal }) => readonly ContextItem[] \| Promise<readonly ContextItem[]>` | Read current instructions, project materials, or database snapshots each turn |
| Gateway `createSessionStore` | `(botConfig: JsonObject) => ImSessionStore` | Persistent sessions and host-owned storage across Bot restarts |
| Custom Extra dependencies | Declared by that Extra's `ExtraPluginModule<D>` | Query model catalogs, subscribe to host events, or invoke defined business functions |

Gateway currently exposes the first two dependencies. Other fields do not automatically work; a custom Extra must declare and consume them. Full compilable examples: [sdk-dependencies.mts](../../examples/sdk-dependencies.mts).

## 2. loadContexts: Current Business Data Each Turn

### 2.1 Read Updated In-Memory Instructions

Use this when an Electron settings change should take effect next turn. The function reference stays fixed while the host value changes.

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

### 2.2 Read Files or Databases Asynchronously

Use this for current project instructions or a host database/API. The example reads a host-selected file and forwards the turn's `signal`; database access should also honor cancellation.

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

Return `ContextItem[]`, not an envelope. Dynamic items replace static items with the same `namespace/name`; `[]` preserves static configuration. Errors/timeouts fail preparation without reusing old data. Do not use reserved `extra.im`. Defaults are 5 seconds, 8 actual in-flight operations, and at most 32 items / 64 KiB; see [Extras](extras.md).

## 3. createSessionStore: Host-Owned Session Storage

Use this when session mappings must survive restarts. The host supplies synchronous `openStore(scope)`, returning an independent handle implementing the complete `ImSessionStore` contract. The factory runs once per Bot, not once per message.

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

Pass your storage factory to `sessionDependencies(openStore)` and use its result as Gateway `dependencies`; add `loadContexts` if needed. SDK does not choose SQLite or another database, nor own schema migrations, capacity, or retention.

| Store methods | Host responsibility |
| --- | --- |
| `read` / `save` / `reset` | Session bindings and generations; repeated reset controlId does not advance again |
| `occurrence` / `remember` | Associate incoming messages with execution records |
| `patchGap` / `patchRules` / `invalidateRules` | Check session/generation identity; never apply stale updates to a replacement session |
| `close` | Release this Bot's handle; the host owns the shared database |

See the complete interface and in-memory [Gateway storage example](../../../test-support/public-extra/gateway-store.mts). It does not prove disk persistence. Omitting the factory uses default memory storage. Drain Extra business operations before closing Kernel and the host database; `complete=false` does not prove those operations stopped.

## 4. Custom Extra: Inject Business Functions

This Extra queries a host model catalog at initialization and exposes results through status without invoking AgentRun. `readModels` belongs to this custom Extra; adding it to Gateway does not make Gateway call it.

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

The host calls `createCatalogService(home, endpoint, catalogUrl)`, then initialize/status/close. Cancellation reaches fetch through `signal`. Extras that subscribe to host events or own timers must unregister them in `ctx.onDispose` and await pending work. Authorization, credentials, and publication decisions belong to the host and that Extra.
