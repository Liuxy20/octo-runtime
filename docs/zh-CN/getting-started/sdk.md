# 第一次 SDK 调用

[English](../../en/getting-started/sdk.md) | [文档目录](../README.md)

本页介绍如何从 Node.js 应用调用 Kernel。需要 Node.js 24.x，并在执行机器上安装、登录所选 Provider，例如 Codex。

先在应用中安装 SDK：

```sh
npm install @mininglamp-oss/octo-runtime
```

SDK 安装完成后，选择连接已有 Kernel，或由应用创建 Kernel。安装 npm 包本身不会启动服务，也不会安装 Provider CLI。

所用发行版本需要与本文的架构一致。当前 npm 发布状态、源码构建方式和 Kernel 启动命令见 [CLI 安装](cli.md)，Provider 安装和登录见 [Harness 安装配置](../guides/harnesses.md)。

## 连接已有 Kernel

先取得服务实际监听的 endpoint：macOS/Linux 使用 socket 路径，Windows 使用 Named Pipe 地址。`attachKernel(endpoint)` 创建客户端，在调用时才连接服务；Kernel 必须已经启动。

完整代码见 [attach.mts](../../examples/attach.mts)。它使用公开 SDK 接口，Node.js 24 可以直接运行该 `.mts` 文件，无需先编译 TypeScript。

在已构建的源码仓中运行（先 `pnpm install`，再 `pnpm build`）：

```sh
node docs/examples/attach.mts /absolute/path/to/kernel.sock codex
```

将命令中的 socket 路径替换为实际 endpoint；Windows 则传入 Named Pipe 地址。`codex` 是本次选择的 Adapter。

这个示例发送一条问候请求，打印 Agent 的最终回复文本，并等待执行结束。如果出现需要用户回复的交互，示例会回复取消；实际应用的交互处理见[输出与控制](../reference/output-and-control.md)。连接或执行失败时，示例会报错退出。结束后关闭客户端连接，Kernel 服务继续运行。

调用 API 本身是：

```ts
for await (const event of client.invoke({ ...input, protocol_mode: "canonical" })) {
  await consume(event);
}
```

这里的 `client` 是连接到 Kernel 的客户端，`input` 是本轮调用参数，`consume` 是应用处理每条事件的函数。输入结构见 [Inputs 与 Contexts](../concepts/inputs-and-contexts.md)，完整的错误和结束状态处理见 [invokeOnce](../../examples/invoke.mts)。

`invoke` 返回异步迭代器，开始读取后才提交请求。请读取到执行结束；在循环中 `break` 只停止接收输出，不会取消执行。

## 由应用创建 Kernel

如果应用需要自己启动服务，使用 `createKernelService(options)`。至少提供：

- `endpoint`：服务监听的 socket 路径或 Named Pipe 地址。
- `workerEntrypoint`：worker 的 JavaScript 入口文件绝对路径。

需要保存服务状态时，还可以设置 `stateDirectory`。共享的 [service.mts](../../examples/service.mts) 提供 `runOwnedInvocation(options, input, consume)`，演示初始化、执行一次调用、关闭服务，以及报告执行和清理错误。长期运行的应用通常只初始化一次，在退出时关闭服务。

Kernel 在独立进程中运行 worker。worker 入口需要注册应用选择的 Adapter，例如：

```ts
import { serveWorker } from "@mininglamp-oss/octo-runtime/executor-kernel";
import { selectedAdapter } from "./selected-adapter.js";
serveWorker([selectedAdapter]);
```

这里的 `selected-adapter.js` 是占位模块，需要由应用提供，导出符合 `HostedAdapter` 类型的 `selectedAdapter`；SDK 不包含这个示例路径。应用负责选择和打包 Adapter。内置 Runtime CLI 已有自己的 worker 和 Adapter 清单；使用清单配置的方式见 [KernelServiceOptions](../reference/kernel-ipc.md)。

创建服务后，等待 `initialize()` 成功，再使用 `kernel.client`。退出时，先关闭应用创建的 Extra，等待结果消费、投递和存储操作结束，再关闭应用创建的 Kernel 和数据库。检查清理结果的 `complete` 字段；为 `false` 时，还需要处理返回的待清理资源。

## 不调用真实 Provider 的验证

在仓库根目录执行：

```sh
pnpm build
pnpm docs:check
```

`docs:check` 会检查示例类型、文档链接和 JSON，并使用测试用 Adapter 运行本地 Kernel 调用。测试用 Adapter 返回固定结果，因此无需安装或登录真实 Provider。完整验证范围见[维护与验证](../maintenance.md)。

下一步：[Inputs 与 Contexts](../concepts/inputs-and-contexts.md)、[输出与控制](../reference/output-and-control.md)。
