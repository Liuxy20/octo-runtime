# KernelClient 调用与原生服务托管

通用开发者合同和可验证示例见 [English](docs/en/README.md) / [简体中文](docs/zh-CN/README.md)。本篇保留源码/submodule、宿主装配和完整原生集成步骤。

Adapter 与 Extra 均由宿主代码原生 import 并组装；不要求、读取、复制或生成任何 manifest，不使用外部 Node 加载器代启顶层服务，不恢复 startOwnedKernel。内部执行 worker 保留为既有执行隔离机制，其入口也由宿主维护。CLI 双清单与 SDK 的区别见[模块载入](docs/zh-CN/concepts/module-loading.md)。

业务通过 KernelClient 调用 Kernel 的 RPC 能力。一次 invoke 提交输入并返回事件流，不要求业务模块构造服务、管理执行 worker 或操作调用登记表。服务由 CLI 或 App 的装配入口托管；这与普通业务调用是两项职责。

## 0. 源码接入使用最新 main

通过 Git submodule 接入时，必须跟踪 `Mininglamp-OSS/octo-runtime` 的 `main`，并在首次接入或主动升级时更新到当时最新的远端 `main`。不使用特定功能分支、未合并 PR 分支或私有补丁作为 SDK 接入依赖。

首次在宿主仓库根目录添加：

```bash
git submodule add --branch main git@github.com:Mininglamp-OSS/octo-runtime.git octo-runtime
```

已有 submodule 时，先确认子仓没有未提交修改，再从宿主仓库根目录执行：

```bash
git submodule update --init -- octo-runtime
git submodule set-branch --branch main -- octo-runtime
git submodule update --remote --checkout -- octo-runtime
git -C octo-runtime log -1 --oneline
```

`--remote` 获取所配置 `main` 的最新提交；`--checkout` 按该提交检出，处于 detached HEAD 是 submodule 的正常状态。命令遇到本地修改冲突时先处理修改，不使用强制覆盖。跟踪分支写入 `.gitmodules`，宿主仓库仍记录具体 submodule commit；升级验收后将 `.gitmodules`、submodule 指针及宿主 lockfile 一起纳入宿主变更。CI 检出已记录指针以复现验收结果，不在每次构建或应用启动时自动升级依赖。

源码 workspace 的依赖与构建方式见 [工作区指南](.octospec/guides/workspace.md#安装与常用命令)。本页主包 `/host`、`/extra`、`/extras/<name>` 等导入示例用于主发行包消费；只纳入子仓 `packages/*` 的源码宿主使用对应 workspace 包：`/host` 对应 `@mininglamp-oss/octo-runtime-host-sdk`，`/extra` 共享插件类型对应其 `/extra` 入口，Gateway 模块及业务依赖对应 `@mininglamp-oss/octo-runtime-extra-channel-gateway`。两种消费方式遵守同一类型与资源所有权边界。

## 1. 调用 Kernel RPC

```ts
import { attachKernel } from "@mininglamp-oss/octo-runtime/executor-kernel";

// endpoint 由应用装配入口提供；也可以直接使用注入的 KernelClient。
const client = attachKernel({ endpoint });
try {
  for await (const event of client.invoke({ ...input, protocol_mode: "canonical" })) {
    await consume(event);
  }
} finally {
  // 只关闭本地连接，不停止共享服务或取消已接纳执行。
  client.close();
}
```

普通 App 和 Extra 的 ctx.kernel 都使用这一个 KernelClient，与调用普通工具一样传入 InvokeInput、消费真实结果。输入使用 Context v3、Run 7；省略模式或 native 返回 HostFrame，canonical 返回 CanonicalEvent，变量模式返回联合类型。没有 Extra 也能直接调用。

invoke 首次 next 才提交，身份关联、ACK 查回、事件订阅和有界续流由客户端与 Kernel 的核心调用协议处理。业务不复制这些过程，不手动触发 client.invocations。ACK 丢失只查询原身份，不重新提交；实例改变、窗口缺口和结果未知明确失败。

caller signal 在发送前取消时不提交；发送后请求取消并保留原订阅收尾，正常耗尽后抛实际 signal.reason。具体执行/传输/控制错误不会被该取消覆盖。cancelInvocation(id)、respondInteraction(id)、respondNativeInteraction(id) 只控制本 client 的 invoke；取消 accepted 不证明终态。iterator.return 和 client.close 不隐式 cancel。

取消和交互也是 RPC 控制能力。显式 signal 表达本次调用的取消意图，不能把客户端连接所有权等同于服务或执行所有权。submit/get/subscribe 与完整 RunRef 等原语继续保留，供明确需要低层协议控制的调用方使用；普通接入不需要使用它们。

直接 Core 的 executor.invoke(input, environment) 使用相同输入/输出概念，详见 [Core 示例](packages/octo-runtime-executor-core/README.md)。Core 与宿主共享故障域，关闭执行 iterator 会取消；Kernel 独立持有已接纳执行，关闭观察不取消。environment.streamLimits 仅 Core 支持，Kernel 显式拒绝，不静默忽略。两者的 executionEnvOverrides 均逐调用隔离。

## 2. 托管原生 Kernel 服务

本节只适用于负责启动本地 Kernel 的 CLI/App 装配入口。CLI 服务进程和原生应用主进程直接构造同一服务，socket 属于调用进程，禁止外部 Node 或 Runtime CLI 代启。业务模块继续使用第 1 节的 RPC 客户端合同。

宿主选择 Adapter 集合，并将执行 worker 编译为独立 JS 文件：

```ts
import { serveWorker } from "@mininglamp-oss/octo-runtime/executor-kernel";
import { selectedAdapter } from "./selected-adapter.js";
serveWorker([selectedAdapter]);
```

selectedAdapter 实现公开 HostedAdapter；Provider、认证和配置由宿主准备。内部 worker 只隔离执行，不是另一个顶层 Kernel 服务。

```ts
import { createKernelService, componentEndpoint } from "@mininglamp-oss/octo-runtime/host";

const kernel = createKernelService({
  endpoint: componentEndpoint(absoluteHome),
  workerEntrypoint: absoluteWorkerJs,
  stateDirectory: absoluteStateDirectory
});
await kernel.initialize({ signal: startupSignal });
// 将 kernel.client 作为普通 RPC 能力提供给业务模块。
registerBusinessTools(kernel.client);

// 宿主退出钩子调用此函数；不是每次 invoke 后调用。
async function stopRuntime() {
  // Extra、业务持久化与投递收尾完成后，宿主才关闭自己构造的 Kernel。
  const cleanup = await kernel.close();
  if (!cleanup.complete) reportCleanupFailure(cleanup);
}
```

示例中的路径、signal、业务注册和错误处理由宿主提供。工厂不执行 IO；initialize 成功后才可读取 client。重复 initialize/close 复用原 Promise；close-before-initialize 使服务永久关闭。启动失败抛出 ServiceInitializationError，cause 保留启动错误，cleanup 保留实际回滚结果。status 提供 phase、pid、endpoint 和 Kernel 状态；closed 返回清理结果。新实例必须重新构造，服务对象没有 restart。

stateDirectory 保存进程清理事实，不保存业务历史。SDK 不要求使用 CLI Home。应用退出时先关闭自己的 Extra，最后关闭自己构造的 Kernel；只调用已有 Kernel 的模块不取得该服务的关闭权限。本文的库内验证不代表外部 Electron 打包应用已实测。

## 3. 原生 Extra

```ts
import { createExtraService } from "@mininglamp-oss/octo-runtime/host";
import * as gateway from "@mininglamp-oss/octo-runtime/extras/channel-gateway";
import type { GatewayDependencies } from "@mininglamp-oss/octo-runtime/extras/channel-gateway";

// 依赖类型由 Gateway 定义；其他 Extra 可以声明自己的依赖类型。
const dependencies: GatewayDependencies = {
  loadContexts: async (config, { signal }) => {
    signal.throwIfAborted();
    return businessContextStore.readCurrent(config, signal);
  }
};
const extra = createExtraService({
  endpoint,
  module: gateway,
  config: { bots: preparedBots },
  logging: { directory: absoluteLogDirectory },
  dependencies
});
await extra.initialize();
const snapshot = await extra.status();
consume(snapshot.plugin);
const cleanup = await extra.close();
if (!cleanup.complete) reportCleanupFailure(cleanup);
```

模块实例、JSON 配置和泛型业务依赖分别传入。业务函数直接在宿主进程执行，不序列化、不经依赖 IPC、不进入 Kernel。插件保持 extra(ctx, jsonConfig)(dependencies)，ctx.kernel 是实际 KernelClient，与 main 的普通 App 合同相同。ctx.onStatus 提供同步 JSON，ctx.onDispose 清理插件自己拥有的资源。整个 octo-runtime 不依赖 SQLite，也不提供 SQLite 适配实现。SQLite 完全由宿主负责选型、创建、连接、迁移、测试和关闭；SDK/Extra 只调用宿主业务依赖，不接管数据库。

### 共享入口与业务依赖

| 入口 | 合同归属 |
| --- | --- |
| `@mininglamp-oss/octo-runtime/host` | 通用服务构造和生命周期，例如 createExtraService |
| `@mininglamp-oss/octo-runtime/extra` | 通用插件 authoring/loading 类型，例如 ExtraContext、ExtraPlugin、ExtraInitializer、JsonObject |
| `@mininglamp-oss/octo-runtime/extras/channel-gateway` | Gateway 模块、GatewayDependencies、ImSessionStore 及实现接口所需的业务类型 |
| 其他 `/extras/<name>` 或独立 Extra 包 | 各自的模块和业务依赖类型 |

业务模块通过 `ExtraPlugin<D>` / `ExtraInitializer<D>` 的泛型声明专属 dependencies，通用服务根据 module 和 dependencies 装配。新增 Gateway 存储依赖时，不向 `ExtraContext` 添加数据库/会话字段，不增加 Gateway 专用 loader overload，也不把 Gateway 类型重新导出到 `/extra`。现有业务 subpath 为复数 `/extras/channel-gateway`，不另设 `/extra/channel-gateway` 别名。

### 自定义 Gateway 会话存储

`ImSessionStore` 保存 Gateway 的逻辑/Provider 会话绑定、历史和规则准备状态、消息处理及 reset 去重记录。默认 Memory 在重启后丢失绑定；Electron 宿主可以提供自己的 SQLite 实现，保存绑定以便下次重新读取。occurrence 还可能包含文本和请求快照，宿主负责保留及访问保护策略。

`GatewayDependencies.createSessionStore(botConfig)` 同步返回逐 Bot 的独立句柄，支持宿主类实例方法；句柄 close 可异步。完整主进程装配、插件加载链、方法合同和错误/关闭顺序见 [Gateway 自定义会话存储](SDK_CHANNEL_GATEWAY_GUIDE.md#自定义会话存储)，可运行代码见[无数据库样例](test-support/public-extra/gateway-store.mts)。源码接入按第 0 节更新到包含此能力的最新 main，不切换到 #65 或功能分支。`loadContexts` 与工厂彼此可选；不提供工厂时继续默认 Memory。

### 共享生命周期与执行

dependencies 可为普通对象或类实例；继承方法、非枚举和 Symbol 成员均保留，方法 this 绑定宿主原对象，可读取私有状态。注入视图是只读浅快照，函数引用及值/访问器结果在装配时固定，宿主原对象不被冻结；动态数据通过这些方法读取，嵌套对象不递归代理。原生服务照常执行依赖关闭权限和实际异步在途限制。

status 的服务 phase 与 plugin 业务快照分开；kernel_available 反映所选 Kernel 是否就绪，Extra 可以在 Kernel 暂时不可用时初始化。CLI 控制 socket 由同一服务实现维护，保留原有 status JSON-RPC 格式。Gateway 不创建或停止 Kernel。

Extra 关闭共用 4 秒单调截止（可继承更早期限）：立即停止新 invoke 并通知插件停止新任务，并发等待所属 Run 排空和插件 dispose。插件在 disposer 中等待自己启动的消费、保存和投递任务，再清理自己的连接；这些任务在截止内仍可调用注入函数。插件清理结束或到期后拒绝后续依赖调用，再等待全部真实在途操作。宿主数据库始终由宿主关闭。超时只结束等待；返回 complete=false，保留失败所有权，不能重建同一 endpoint/name。SDK 不退出或强杀调用进程，也不能强停已开始的宿主函数。

内置模块均从主包公开入口导入：`/extras/channel-gateway`、`/extras/channel-wecom`、`/extras/webui`；对应的 `/config-schema.json` 出口继续可用。

逐轮 loadContexts 可同步返回数组或返回 Promise；数据变化下一轮可见，无需重载连接。Gateway 默认等待 5 秒、实际在途 8（最大 32）、结果 32 项 / 64 KiB；超时或取消后的真实操作未结束仍占额。通用 Extra 服务另跟踪最多 128 个实际异步依赖，关闭时不能以 race 已结束宣称实际调用结束。同步查询仍阻塞当前线程。

模块、JSON 或函数引用变化时，等待旧服务完整关闭后重新构造。配置可来自内存、数据库、Nacos 或文件；SDK 不扫描 CLI 配置和凭据。旧进程启动 API、dependencyModule 和依赖代理已删除，不提供兼容包装。

Extra 的执行依赖是实际 ctx.kernel: KernelClient，与直接 App 完全相同。例如在插件的业务任务中 `for await (const event of ctx.kernel.invoke({...input, protocol_mode: "canonical"}, {signal: ctx.signal})) await deliver(event)`。插件必须通过 onDispose 等待业务任务与 delivery 结束，源终态不能替代该等待。旧 ctx.adapterHost/ExtraAdapterHost/extra-port 和渠道 ImExecutionPort 不兼容保留；仓外插件同步迁移字段及 cancelInvocation 的 accepted 回执。

## 4. 外部原生组件

/host 的 startNativeComponent 仅用于宿主明确配置的外部原生可执行文件，不用于构造 Kernel/Extra。它接受绝对 executable/argv/cwd/configPath/endpoint、readiness、stop，自动追加 --config/--endpoint，shell=false。stdin-json 模式按 component.stop/request_id 与 component.stopped/request_id/complete 确认清理；signal 模式检查实际退出。IPC readiness 的 result.pid 必须匹配本次子进程。启动失败抛出 ComponentStartError，保留该外部组件的 CleanupResult。

## 5. 验证与迁移

[包外 fixture](test-support/public-extra/host.mts) 与 [发行验证](scripts/verify-release.mjs) 安装实际 tgz，以 strict/skipLibCheck=false 编译并运行公开 API，检查 SDK 与 CLI 的 socket PID。当前库内实施及未验平台见 [Issue 71 实施记录](.octospec/tasks/unified-native-sdk-services/implementation.md)。真实 Provider、IM 和外部 Electron 工程分别记录，不从 fixture 推断。

本次是服务构造 API 的破坏性迁移，不改变 Home、profile、设备身份、凭据、Context v3、Run 7 或宿主数据库。升级无需重登记或重置现有状态。更早 daemon 版本的迁移边界仍按 DEPLOYMENTS.md 单独处理。
