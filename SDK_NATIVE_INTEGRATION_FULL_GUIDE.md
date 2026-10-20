# Host SDK 原生接入

SDK 宿主通过一个 npm 发行包接入。Node.js 24.x、Provider 程序和认证由宿主准备；长期运行宿主推荐独立 Kernel。

## 1. worker 入口

宿主选择 Adapter 集合，编译为独立 JS 文件。serveWorker 来自主包公开入口：

```ts
import { serveWorker } from "@mininglamp-oss/octo-runtime/executor-kernel";
import { selectedAdapter } from "./selected-adapter.js";
serveWorker([selectedAdapter]);
```

selectedAdapter 实现公开 HostedAdapter 合同。Adapter 安装和配置属于宿主，SDK 不复制 CLI 全量清单。进程内模式则从 /executor-core 使用 AgentExecutor，并在退出时检查 shutdown().cleanup。

## 2. 创建或连接 Kernel

```ts
import { startOwnedKernel, componentEndpoint } from "@mininglamp-oss/octo-runtime/host";
import { attachKernel } from "@mininglamp-oss/octo-runtime/executor-kernel";

const endpoint = componentEndpoint(absoluteHome);
const owner = await startOwnedKernel({
  endpoint,
  workerEntrypoint: absoluteWorkerJs,
  stateDirectory: absoluteStateDirectory
});
const client = owner.client;
const status = await client.status();
const { ref } = await client.submit(input);
for await (const frame of client.subscribe(ref)) consume(frame);
const stopped = await owner.stop();
if (!stopped.complete) reportCleanupFailure(stopped);
```

absoluteHome、input、consume 等由宿主提供。输入是 InvokeInput；Context 固定 v3，Run 固定 7。stateDirectory 只保存进程清理事实，不保存业务历史。不同宿主可用自己的端点，不必使用 CLI 目录。

已有服务使用 attachKernel({endpoint})。attached.close 只释放连接，不取消 Run，不停止 Kernel。读取断开后以原 ref 和 after_seq 继续；cancel/ref 是显式动作，响应的 accepted 不等于终态。Kernel 重启后旧 instance 的引用明确失败，不自动重新提交。

owner.restart 会先检查旧组件清理完成，再启动新实例。owner.exited 可供宿主检测意外退出。停止账号或应用时由宿主决定先停哪些 Extra，再停 owned Kernel；附加到共享服务的客户不得停止该服务。

## 3. 独立 Extra

```ts
import { startExtra } from "@mininglamp-oss/octo-runtime/host";

const extra = await startExtra({
  endpoint,
  declaration: {
    name: "channel-gateway",
    module: "@mininglamp-oss/octo-runtime-extra-channel-gateway",
    config: { bots: preparedBots }
  },
  logging: { directory: absoluteLogDirectory },
  dependencies: {
    loadContexts: async (config, { signal }) => {
      signal.throwIfAborted();
      return await businessContextStore.readCurrent(config, signal);
    }
  }
});
const snapshot = await extra.status();
const cleanup = await extra.stop();
if (!cleanup.complete) reportCleanupFailure(cleanup);
```

preparedBots、业务存储和日志目录由宿主管理。Extra 在独立进程运行，Kernel 不加载或维护它。配置可来自内存、数据库、Nacos 或文件；SDK 只接收完整声明和值。CLI 的 extraset 文件不是 SDK 要求。

同一函数每轮读取当前业务数据，函数本身不序列化、不进入 Kernel。更换函数引用、模块或 JSON 配置时，等待旧 Extra 完整关闭，再创建新实例。超时、取消、账号切换或断线不会提前释放尚未结束的实际 Promise 额度。同步阻塞函数仍阻塞宿主 Node 线程，不能由代理隔离。

默认动态 Context 等待 5 秒、实际在途 8、结果 32 项 / 64 KiB；config.context_loading 可按插件既有 Schema 调整 timeout_ms/max_in_flight。迟到结果丢弃，清理未完成会阻止替换。也可用 dependencyModule: {entrypoint: absoluteModuleJs, exportName} 在 Extra 子进程加载依赖，不能同时提供父进程函数代理。

插件仍用 extra(ctx, jsonConfig)(dependencies)，通过 ctx.onStatus 提供同步 JSON 快照、ctx.onDispose 清理自己的业务资源。停止单个 Extra 只取消它拥有的调用，不关闭共享 Kernel。业务授权、消息会话、可靠投递由插件和业务系统管理。

## 4. 原生组件

/host 的 startNativeComponent 接收 NativeComponentOptions：绝对 executable/argv/cwd/configPath/endpoint、readiness、stop。自动追加 --config 和 --endpoint，拒绝 argv 中重复定义；不使用 shell。原生程序可在 stdin 按行接收 component.stop/request_id，并在 stdout 确认 component.stopped/request_id/complete。选择 signal 合同时以实际退出和受管进程清理为准。

选择 `readiness: "ipc"` 时，status 的 JSON-RPC result 必须包含新建子进程的 `pid`；其他进程的端点响应不算本次启动成功。spawn 后启动失败抛出 `/host` 导出的 `ComponentStartError`，`cause` 保留启动错误，`cleanup` 报告回滚结果。`cleanup.complete=false` 不因进程已退出而变为成功；Extra 保留失败名称，Kernel restart 保留替换实例的失败清理事实，禁止继续替换。

Go stdlib fixture 验证了参数、含空格路径、工作目录和关闭确认，见 [native-component.test.js](test/native-component.test.js)。这不表示已实现外部 Go Loop 服务或生产 Go client。

## 5. 验证和边界

[仓库外编译 fixture](test-support/public-extra/host.mts) 与 scripts/verify-release.mjs 检查公开类型及实际子进程。POSIX 使用受管进程组；Windows 使用有界 taskkill /T，具体平台与孤儿后代清理必须实际验收。真实 Provider/IM 和宿主产品验收另记，不由 fixture 推断。

Extra runner 的异步清理共用 4 秒预算，并在 stop 开始后 4.5 秒执行最终退出兜底。owner 断连后仍保留该定时器，POSIX 回收本实例进程组，避免挂起初始化、dispose 或 unref 子进程留下孤儿；强制退出仍不证明业务资源清理完整。定时器依赖 Extra 事件循环正常调度；同步死循环与 owner 同时退出的组合故障需要独立 supervisor，当前 SDK 未提供该保证。

完整变更和当前证据见 [实施记录](.octospec/tasks/executor-kernel-host-lifecycle/implementation.md)。旧 createDaemonRuntime/startAccount、daemon 命令和旧 bin 已删除，不提供兼容包装。
