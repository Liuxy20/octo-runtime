# Codex Adapter

[English](README.md) | [包导航](../README.zh.md)

驱动双向的 `codex app-server` 协议：每次调用拉起一个 app-server，按 `initialize` → `thread/start` 或 `thread/resume` → `turn/start` 推进，应答反向请求，最后映射成 canonical 事件，或保留 Provider 负载作为 native 帧。Codex 的会话、审批和取消都收在这里，Core 不需要任何 Codex 逻辑。

## 什么时候用它

- 宿主机上装好 Codex 并完成认证。
- 你想把审批和交互提问交回自己的 UI，而不是预先答复。
- 你需要 native Provider 负载；这个 Adapter 同时支持 `native` 和 `canonical`。

## 注册 Adapter 并准备输入

以下节选负责注册与输入准备。实际执行使用 `executor.invoke(input)`；完整的消费、终态判断和 `shutdown()` 示例见 [Executor Core](../octo-runtime-executor-core/README.zh.md)。

```ts
import { AgentExecutor } from "@mininglamp-oss/octo-runtime/executor-core";
import { InvokeInput } from "@mininglamp-oss/octo-runtime/protocol";
import { codexAdapter } from "@mininglamp-oss/octo-runtime-adapter-codex";

const executor = new AgentExecutor();
executor.register(codexAdapter);

const input = InvokeInput.check({
  inputs: [{ type: "text", text: "Say hello." }],
  protocol_mode: "canonical",
  contexts: {
    schema: "octo.context-envelope/v3",
    items: [{ namespace: "octo.execution", name: "adapter", payload: { type: "codex" } }]
  }
});
```

## 绑定了什么

| 项           | 值                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------- |
| Adapter 类型 | `codex`                                                                                                       |
| 导出         | `codexAdapter`、`createCodexAdapter`                                                                          |
| 协议         | `codex.app-server`，模式 `native` 与 `canonical`                                                              |
| 传输         | 每次调用一个 stdio JSON-RPC app-server                                                                        |
| 会话         | 显式 Provider 会话对应原生 thread；resume 被拒或 rollout 缺失时，可以用调用方给的恢复输入做一次新 thread 兜底 |
| 交互         | 命令/文件审批、用户输入、MCP elicitation，都回到同一个活动请求上应答                                          |

## 限制

- 反向请求不会自动批准。审批策略取决于准备好的请求和你安装的桥。
- 有序的文本与图片输入会变成原生 text 和 image data URL，不是宿主本地路径。Adapter 支持图片不代表所选模型接受图片。
- 权威的 session update 只在 turn start 成功后上报；Adapter 从不重建应用历史。
- turn 回执、一段文本、子进程退出，都不证明执行成功或清理完成。
- native 模式下必须同时读 Runtime 控制帧和 Provider 负载。

## 导入与分发

private workspace 包，包含在 CLI 发行物里。没有单独的 npm 包，也没有公开 SDK 子路径。

## 延伸阅读

- [实现](src/index.ts)、[Adapter SDK](../octo-runtime-adapter-sdk/README.zh.md)、[Runtime 公共协议](../octo-runtime-protocol/README.zh.md)。
- [输入参考](../../docs/zh-CN/reference/invoke-input.md)。
