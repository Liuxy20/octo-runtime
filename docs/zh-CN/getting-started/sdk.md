# SDK 接入

## 选择 Extra 执行方式

已有 Core 的嵌入宿主可以直接组合 Extra，无需 Kernel 监听或 Runtime Home：

```ts
import { AgentExecutor } from "@mininglamp-oss/octo-runtime/executor-core";
import { createCodexAdapter } from "@mininglamp-oss/octo-runtime/adapters/codex";
import { createExtraService } from "@mininglamp-oss/octo-runtime/host";
import * as channelGateway from "@mininglamp-oss/octo-runtime/extras/channel-gateway";
import { config, dependencies } from "./host-config.js";

// 宿主持有 Core；注册不执行模型调用，也不证明 Provider 已就绪。
const executor = new AgentExecutor();
executor.register(createCodexAdapter());
const extra = createExtraService({
  execution: { kind: "direct", executor },
  module: channelGateway, config, dependencies
});
await extra.initialize();

export async function shutdown() {
  // 宿主先停止新业务，并在共享 Core 的所有使用方结束后关闭 Core。
  const extraCleanup = await extra.close();
  if (!extraCleanup.complete) throw new Error("EXTRA_CLEANUP_INCOMPLETE");
  const cleanup = await executor.shutdown();
  if (cleanup.cleanup !== "complete") throw new Error("EXECUTOR_CLEANUP_INCOMPLETE");
}
```

`config`、`dependencies` 沿用下文 Gateway 合同。多个 Extra 可共享同一 executor，取消和关闭只影响本 Extra 的调用；不同 executor 可加载同名 Extra。Extra 不会关闭借用的 Core。

连接独立托管的 Kernel 时，使用 `createExtraService({ home, execution: { kind: "ipc", endpoint }, module, config, dependencies })`。Kernel owner 按下文创建服务；Extra 只连接已有服务，不启动、重启或停止它。旧 `{ home, endpoint, ... }` 保留兼容，但不能与 `execution` 同时提供。

两种模式均向插件提供 `context.execution`。停止观察不取消已接纳工作，显式取消及 Extra 关闭才会取消。direct 与宿主共享故障域，只有有界观察窗口，不承诺 IPC 重连或持久回放。两条路径都使用 Core 注册的 Adapter 作用域，兼容的 Codex 调用复用常驻 app-server。Extra 关闭只释放自己的调用；Core/Kernel owner 关闭服务并检查清理结果。生命周期和容量见 [Codex Adapter](../../../packages/octo-runtime-adapter-codex/README.zh.md)。

POSIX Kernel 地址为 `<home>/executor-kernel.sock`；Windows 管道名和 Extra 控制地址保持。这是破坏性地址变更：停止旧进程，同步更新 Kernel、客户端与 Extra 后重启。

[English](../../en/getting-started/sdk.md) | [文档目录](../README.md)

Electron/Node.js 宿主原生导入所需模块。加载方式由宿主选择，也可以尝试基于 **pnpm workspace + Git submodule** 引入源码。下例使用源码 workspace 包名；发行包对应 `/executor-kernel`、`/host`、`/extras/channel-gateway` 等公开子路径。

Home 选择、准备、路径预算与 API 迁移见 [Runtime Home 合同](../reference/runtime-home.md)。SDK 不选择默认目录；CLI 默认值不属于 SDK。

## 1. 快速接入 KernelService

| 用途 | 签名 | 说明 |
| --- | --- | --- |
| 创建服务 | `createKernelService(options: KernelServiceOptions): KernelService` | 必填已存在目录 `home: string`、`endpoint: string`、`adapters: readonly HostedAdapter[]`，接收实际对象 |
| 派生地址 | `componentEndpoint(home: string): string` | 本地 socket / Named Pipe 地址，不能把 Home 目录直接当 endpoint |
| 初始化 | `kernel.initialize({ signal? }?): Promise<void>` | 成功后取得 `kernel.client` |
| 服务状态 | `kernel.status(): Promise<KernelServiceStatus>` | 生命周期及 Kernel 状态 |
| 关闭 | `kernel.close(): Promise<ServiceCleanupResult>` | 宿主负责关闭并检查 `complete` |

Provider 的安装、认证由宿主准备。这里只完成服务接入，不需要发起一次调用：

```ts
import { createKernelService } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { componentEndpoint } from "@mininglamp-oss/octo-runtime-host-sdk";
import { createCodexAdapter } from "@mininglamp-oss/octo-runtime-adapter-codex";

import { mkdir } from "node:fs/promises";

// 宿主按产品设计选择根并准备；SDK 不选择默认目录。
const home = "/absolute/app-runtime-home";
await mkdir(home, { recursive: true });
const endpoint = componentEndpoint(home);
const kernel = createKernelService({ home, endpoint, adapters: [createCodexAdapter()] });
await kernel.initialize();
// 原生 SDK 已取得 RPC 客户端；无需 attachKernel，也无需立即发起 AgentRun。
const client = kernel.client;
```

原生 SDK 宿主使用 `kernel.client`，它通过本地 RPC 调用 Kernel。`attachKernel` 用于另一个进程中的独立应用连接已有 Kernel，不属于原生服务装配步骤。

```ts
// 应用退出时执行；如果创建了 Extra，先按下一章关闭 Extra。
const cleanup = await kernel.close();
if (!cleanup.complete) throw new Error("KERNEL_CLEANUP_INCOMPLETE");
```

## 2. 接入 ChannelGateway ExtraService

需要接收 Octo IM 消息时再创建 Gateway；仅使用 Kernel 不需要 Extra。

| 用途 | 签名 | 说明 |
| --- | --- | --- |
| 创建 Extra | `createExtraService<D>(options: ExtraServiceOptions<D>): ExtraService` | 必填 `home` 为宿主已准备目录；`endpoint` 复用 Kernel 地址；`module` 为原生导入模块；`config` 是 JSON；`dependencies` 是宿主函数 |
| 初始化 | `gateway.initialize({ signal? }?): Promise<void>` | 初始化插件；不等于 Bot 已在线 |
| 查询状态 | `gateway.status(): Promise<ExtraServiceStatus>` | 查看生命周期、Kernel 可用性和插件状态 |
| 关闭 | `gateway.close(): Promise<ServiceCleanupResult>` | 排空本 Extra；不关闭共享 Kernel |

以下代码接在上一章初始化之后。示例从宿主环境取得配置，实际应用也可从自己的配置服务读取；`GATEWAY_WORKDIR` 使用已有目录的绝对路径。

```ts
import { createExtraService } from "@mininglamp-oss/octo-runtime-host-sdk";
import * as channelGateway from "@mininglamp-oss/octo-runtime-extra-channel-gateway";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

// 使用上一章已初始化的 Kernel endpoint；配置/凭据来源由宿主决定。
const gateway = createExtraService({
  home,
  execution: { kind: "ipc", endpoint },
  module: channelGateway,
  config: {
    bots: [{
      api_url: required("GATEWAY_API_URL"),
      bot_id: required("GATEWAY_BOT_ID"),
      bf_token: required("GATEWAY_BOT_TOKEN"),
      adapter: { adapter_type: "codex", workdir: required("GATEWAY_WORKDIR") }
    }]
  },
  dependencies: {}
});
await gateway.initialize();
console.log(await gateway.status());
```

Gateway 在同进程原生运行，内部自行管理独立 RPC client；宿主不调用 `attachKernel`。退出时使用以下顺序，替代上一章的单 Kernel 关闭代码：

```ts
// 应用退出时停止新业务；先关闭 Gateway，再关闭自己拥有的 Kernel。
const extraCleanup = await gateway.close();
const kernelCleanup = await kernel.close();
if (!extraCleanup.complete || !kernelCleanup.complete)
  throw new Error("RUNTIME_CLEANUP_INCOMPLETE");
// 确认业务读写结束后，再关闭宿主数据库等共享依赖。
```

初始化失败同样需要关闭已创建的服务；失败详情与回收结果通过 `ServiceInitializationError` 报告。清理不完整时保留错误及仍在使用的宿主资源。

## 3. 高级接入

[宿主依赖与场景示例](../guides/sdk-dependencies.md)：`loadContexts` 动态业务数据、`createSessionStore` 会话存储，以及自定义 Extra 的依赖注入。

## 4. 可选：使用 AgentRun

服务接入完成后，业务需要主动执行 AgentRun 时再阅读[调用、事件与控制](../guides/agent-runs.md)。`invoke`、事件消费、交互和取消不属于接入必做步骤；Gateway 会按收到的消息发起调用。

## 启动失败

稳定码分支、安全资源 context、清理事实及 CLI JSON 兼容方式见[启动诊断合同与目录](../guides/startup-diagnostics.md)。
