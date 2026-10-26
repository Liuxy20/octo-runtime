# Antigravity Adapter

[English](README.md) | [包导航](../README.zh.md)

通过 Antigravity 的 `agy` CLI 跑一轮 Runtime 调用：准备好的输入以 stdin NDJSON 送进去，拉起一个归本次调用所有的子进程，原生的文本、工具、会话、结果消息变成 `CanonicalEvent`。它驱动的是 CLI，不是桌面窗口。

## 什么时候用它

- 宿主机上装好了 `agy` 1.3.3 或更新版本，并且已登录。
- 每次调用都是 `full_access`；这个 Adapter 没有审批路径可以退。
- 只用到文本和工具：图片和 MCP 都不支持。

## 注册 Adapter 并准备输入

以下节选负责注册与输入准备。实际执行使用 `executor.invoke(input)`；完整的消费、终态判断和 `shutdown()` 示例见 [Executor Core](../octo-runtime-executor-core/README.zh.md)。

```ts
import { AgentExecutor } from "@mininglamp-oss/octo-runtime/executor-core";
import { InvokeInput } from "@mininglamp-oss/octo-runtime/protocol";
import { antigravityAdapter } from "@mininglamp-oss/octo-runtime-adapter-antigravity";

const executor = new AgentExecutor();
executor.register(antigravityAdapter);

const input = InvokeInput.check({
  inputs: [{ type: "text", text: "Say hello." }],
  protocol_mode: "canonical",
  approvalMode: "full_access",
  contexts: {
    schema: "octo.context-envelope/v3",
    items: [{ namespace: "octo.execution", name: "adapter", payload: { type: "antigravity" } }]
  }
});
```

调用前 `approvalMode` 必须已经是 `full_access`——没有 `ask` 这条路。

## 绑定了什么

| 项           | 值                                                            |
| ------------ | ------------------------------------------------------------- |
| Adapter 类型 | `antigravity`                                                 |
| 导出         | `antigravityAdapter`、`createAntigravityAdapter`              |
| 命令         | `agy` 加 `--dangerously-skip-permissions --mode accept-edits` |
| 输出         | 仅 canonical 事件                                             |
| 会话         | 显式 Provider 会话决定用哪段对话，且可续接                    |
| 模型         | 通过原生 CLI flag 传入，effort 做映射                         |

## 限制

- `ask` 和 `assisted` 直接失败，不会悄悄升级成 full access。
- 探测要求能读出至少 1.3.3 的版本；读不到版本就算探测失败。
- 可信控制指令是用户输入里的标记文本，不是独立的 system role。
- 成功需要原生 `SUCCESS` 结果**且**回答非空。退出码为 0 本身不算成功。
- 每次调用拥有自己的进程；取消和清理都由本次调用负责。

## 导入与分发

private workspace 包，包含在 CLI 发行物里。没有单独的 npm 包，也没有公开 SDK 子路径。

## 延伸阅读

- [实现](src/index.ts)、[Adapter SDK](../octo-runtime-adapter-sdk/README.zh.md)、[Runtime 公共协议](../octo-runtime-protocol/README.zh.md)。
- [输入参考](../../docs/zh-CN/reference/invoke-input.md)。
