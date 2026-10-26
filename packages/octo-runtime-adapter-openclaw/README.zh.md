# OpenClaw Adapter

[English](README.md) | [包导航](../README.zh.md)

通过 OpenClaw Gateway 的已认证 WebSocket RPC 调用一个已有 Agent——不拉起本地 Provider CLI。Runtime 拿到同样的 Adapter 接口，OpenClaw 继续持有该 Agent 的 workspace、工具、技能、记忆和原生配置。

## 什么时候用它

- 你已经在跑 OpenClaw Gateway，并且配好了 Agent。
- 你想让 Runtime 调用它，而不是自己托管一个。
- 工作目录归远端 Agent，不要传本地执行的 `workdir`。

## 注册 Adapter 并准备输入

以下节选负责注册与输入准备。实际执行使用 `executor.invoke(input)`；完整的消费、终态判断和 `shutdown()` 示例见 [Executor Core](../octo-runtime-executor-core/README.zh.md)。

```ts
import { AgentExecutor } from "@mininglamp-oss/octo-runtime/executor-core";
import { InvokeInput } from "@mininglamp-oss/octo-runtime/protocol";
import { openclawAdapter } from "@mininglamp-oss/octo-runtime-adapter-openclaw";

const executor = new AgentExecutor();
executor.register(openclawAdapter);

const input = InvokeInput.check({
  inputs: [{ type: "text", text: "Say hello." }],
  protocol_mode: "canonical",
  contexts: {
    schema: "octo.context-envelope/v3",
    items: [
      {
        namespace: "octo.execution",
        name: "adapter",
        payload: { type: "openclaw", provider_agent_id: "main" }
      }
    ]
  }
});
```

## 绑定了什么

| 项           | 值                                                           |
| ------------ | ------------------------------------------------------------ |
| Adapter 类型 | `openclaw`                                                   |
| 导出         | `openclawAdapter`、`createOpenClawAdapter`                   |
| 传输         | Gateway WebSocket RPC，走广告的 v4 方法与事件                |
| 目标         | 通过 `provider_agent_id` 指定已有 Agent；输入准备默认 `main` |
| 输出         | 仅 canonical 事件                                            |
| Workspace    | 关闭——归远端 Agent                                           |

## 限制

- 兼容性同时看明确支持的 Gateway 版本**和**广告的 v4 方法/事件。只说 v4 不代表兼容。
- `assisted` 不支持。Gateway 没有可用的手动审批通道或 scope 时，`ask` 可能退回原生 full access；会有 Provider 诊断说明这次回退，所以要读**实际**权限状态，而不是请求里的那个。
- `full_access` 指的是原生 full access，不是操作系统隔离。
- Adapter 拥有本次调用的 WebSocket 和待处理交互，不拥有 Gateway 进程或远端 Agent 的资源。
- 它不会用 `config.patch` 替换人设、MCP 或 workspace 配置。目标 Agent 不存在就失败，不会创建或悄悄换一个。
- 连接快照和设备身份由宿主通过 `configureOpenClawConnection` 或可信 Provider 选项准备；探测与调用都不去发现凭据，也不改用户配置。

## 导入与分发

private workspace 包，包含在 CLI 发行物里。没有单独的 npm 包，也没有公开 SDK 子路径。

## 延伸阅读

- [实现](src/index.ts)、[OpenClaw 合同](../../.octospec/rules/openclaw.md)、[Adapter SDK](../octo-runtime-adapter-sdk/README.zh.md)。
- [Runtime 公共协议](../octo-runtime-protocol/README.zh.md)。
