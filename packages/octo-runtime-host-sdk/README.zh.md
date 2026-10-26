# Host SDK

[English](README.md) | [包导航](../README.zh.md)

在你自己的应用里装配 Runtime 组件：把 Extra 模块加 JSON 配置变成调用进程内的服务，注入业务函数，报告状态，协调有界关闭。它还收了 Home、身份、端点这些共享约定，宿主不用各写一套。执行仍然在 Core 和 Kernel；宿主可以一个 Extra 都不加载。

## 什么时候用它

- 宿主加载可选 Extra——channel gateway、企业微信、Web UI——需要一套统一生命周期。
- 你想用和 CLI 一样的 endpoint 与 Home 约定。
- 只是调用已有 Kernel（`/executor-kernel` 就够）或者直接嵌 Core 时，不需要它。

## 托管一个 Extra

```ts
import { createExtraService, type ExtraService } from "@mininglamp-oss/octo-runtime/host";
import * as gateway from "@mininglamp-oss/octo-runtime/extras/channel-gateway";
import type { GatewayDependencies } from "@mininglamp-oss/octo-runtime/extras/channel-gateway";
import type { JsonObject } from "@mininglamp-oss/octo-runtime/extra";

export async function withGateway(
  endpoint: string,
  config: JsonObject,
  dependencies: GatewayDependencies,
  runHost: (extra: ExtraService) => Promise<void>
): Promise<void> {
  const extra = createExtraService({ endpoint, module: gateway, config, dependencies });
  const errors: unknown[] = [];
  try {
    await extra.initialize();
    await runHost(extra);
  } catch (error) {
    errors.push(error);
  } finally {
    try {
      const cleanup = await extra.close();
      if (!cleanup.complete) errors.push(new Error("Extra cleanup remains incomplete"));
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, "Gateway host failed");
}
```

`GatewayDependencies` 里有 `loadContexts`，以及可选的 `createSessionStore`。其他 Extra 定义自己的依赖。这些函数在你进程里直接执行，不会被序列化成 JSON 发给 Kernel。

## 它管什么，不管什么

| 包含                                 | 交给别人                           |
| ------------------------------------ | ---------------------------------- |
| Extra 模块组装、依赖注入、状态、关闭 | 执行：那是 Core 的 `AgentExecutor` |
| Home、身份、端点工具                 | 替 Extra 启动 Kernel               |
| 把活的 `KernelClient` 交给每个 Extra | Provider 安装、登录、模型策略      |

Core 和 Kernel 都不依赖 Host SDK。

## 生命周期

- 构造不做 I/O。`initialize()` 启动插件；`status()` 报告服务与插件状态。`initialize()` 失败会抛 `ServiceInitializationError`，带原始 cause 和回滚后的 `cleanup`。
- 每个 Extra 有自己的 `KernelClient`。`close()` 停止接纳新调用、取消自己拥有的调用，并在共用的 4 秒单调预算内等这些调用和插件 disposer 结束；如果继承了更早的截止时间，预算会被压缩。
- `onDispose` 必须等消费者、持久化和投递都收尾。执行终态本身不证明这些工作完成。
- 插件清理结束前，仍然允许有界的宿主函数调用做最后落盘或投递；之后拒绝新的依赖调用，并等待实际在途操作。超时不能强杀任意宿主 JavaScript。
- `complete: false` 会保留失败的所有权，并阻止同 endpoint、同 name 的替换。再调 `close()` 返回同一个结果。
- 改模块、JSON 配置或依赖函数引用之前，先把旧 Extra 完整关掉。函数没变、但读取的数据可能在两轮之间变化，这不需要重载插件。
- Extra 关闭不会停掉共享 Kernel、其他 Extra 或宿主数据库，也不会退出宿主进程。SQLite 完全归应用所有。

## 导入与分发

给源码和子模块宿主用的 private workspace 包。发行版消费者用 `/host`（`createExtraService`、端点工具，以及 Kernel 的 `createKernelService` 再导出）、`/extra`（编写类型）和具体的 `/extras/*` 入口。workspace 里的 `hostHomePaths`、`ensureHostHome`、`ensureLocalRuntime` 这些 Home 与身份工具，目前没有从 `/host` 再导出。

## 延伸阅读

- [导出](src/index.ts)、[Extra 服务](src/extra-service.ts)、[插件合同](src/extras.ts)、[Home 工具](src/home.ts)、[身份](src/identity.ts)、[端点](src/endpoint.ts)。
- [公开 host 门面](../../public/host.ts)、[Extra 指南](../../docs/zh-CN/guides/extras.md)、[模块加载](../../docs/zh-CN/concepts/module-loading.md)。
- [SDK 入门](../../docs/zh-CN/getting-started/sdk.md)、[Gateway 配置与存储](../../SDK_CHANNEL_GATEWAY_GUIDE.md)。
