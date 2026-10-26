# Claude Code Adapter

[English](README.md) | [包导航](../README.zh.md)

通过 Claude Code 的双向 stream-json CLI 跑一轮调用。每次调用拥有一个 `claude` NDJSON 子进程，把准备好的工作目录、模型、effort、MCP 配置、权限和显式会话映射成参数，返回 canonical 事件或 native driver frame。Core 里不需要任何 Claude 分支。

## 什么时候用它

- 宿主机上装好 Claude Code 并登录。
- 你想通过 `can_use_tool` 做交互式工具审批，而不是靠 bypass flag。
- 你既要 canonical 事件也要 native Provider 帧；这是少数同时支持两种模式的 Adapter。

## 注册 Adapter 并准备输入

以下节选负责注册与输入准备。实际执行使用 `executor.invoke(input)`；完整的消费、终态判断和 `shutdown()` 示例见 [Executor Core](../octo-runtime-executor-core/README.zh.md)。

```ts
import { AgentExecutor } from "@mininglamp-oss/octo-runtime/executor-core";
import { InvokeInput } from "@mininglamp-oss/octo-runtime/protocol";
import { claudeCodeAdapter } from "@mininglamp-oss/octo-runtime-adapter-claude-code";

const executor = new AgentExecutor();
executor.register(claudeCodeAdapter);

const input = InvokeInput.check({
  inputs: [{ type: "text", text: "Say hello." }],
  protocol_mode: "canonical",
  contexts: {
    schema: "octo.context-envelope/v3",
    items: [{ namespace: "octo.execution", name: "adapter", payload: { type: "claude-code" } }]
  }
});
```

## 绑定了什么

| 项           | 值                                                 |
| ------------ | -------------------------------------------------- |
| Adapter 类型 | `claude-code`                                      |
| 导出         | `claudeCodeAdapter`、`createClaudeCodeAdapter`     |
| 协议         | `claude.stream-json`，模式 `native` 与 `canonical` |
| 传输         | 每次调用一个 `claude` NDJSON stdio 子进程          |
| 会话         | 显式 Provider 会话；没给才新开                     |
| 交互         | 双向 `can_use_tool` 请求，走当前调用的交互桥       |

## 限制

- 审批回复有两条路径：native 消费方回 native 请求，canonical 消费方回 Runtime 交互。别混用。
- 不支持的审批模式直接失败，不会降级成 full access。
- 工作目录和权限设置是 Provider 侧的配置，不是操作系统隔离。
- 流式文本、公开推理、工具事件是分开的；消息结束不等于 Run 结束。
- 取消和所有退出路径都必须把自有进程清理做完。

## 导入与分发

private workspace 包，包含在 CLI 发行物里。没有单独的 npm 包，也没有公开 SDK 子路径。

## 延伸阅读

- [实现](src/index.ts)、[Adapter SDK](../octo-runtime-adapter-sdk/README.zh.md)、[Runtime 公共协议](../octo-runtime-protocol/README.zh.md)。
- [输入参考](../../docs/zh-CN/reference/invoke-input.md)。
