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

## 配置与会话归属

上例采用 `ask` 审批模式，推理强度沿用 Provider 默认。审批通过 Context `octo.security/approval_policy` 设置，强度通过 `octo.execution/model.payload.reasoning.effort` 设置。公共 `InvokeInput.approvalMode` 也可显式指定，但必须与显式 Context 策略一致。Adapter 接收准备后的内部 `InvokeRequest`；当前字段与被拒绝的旧配置见[输入参考](../../docs/zh-CN/reference/invoke-input.md)。

调用方保存会话更新中的完整 `providerSession`（含 Provider 扩展字段），并在下一轮显式回传。只复用业务 `sessionId` 会新开 Provider 会话；Core 不持久维护业务会话到 Provider 的绑定表。续接与恢复输入步骤见[背景资料与会话](../../docs/zh-CN/guides/context-and-sessions.md)。

## 限制

- `ask` 和 `assisted` 模式通过当前交互桥处理审批；`full_access` 自动处理支持的审批，但不回答用户问题或 MCP elicitation。
- 有序的文本与图片输入（包括纯图片输入）会变成原生 text 和 image data URL，不是宿主本地路径。Adapter 支持图片不代表所选模型接受图片。格式、完整性字段和容量限制见[输入参考](../../docs/zh-CN/reference/invoke-input.md)。
- 权威的 session update 只在 turn start 成功后上报；Adapter 从不重建应用历史。
- turn 回执、一段文本、子进程退出，都不证明执行成功或清理完成。
- native 模式下必须同时读 Runtime 控制帧和 Provider 负载。


人工审批额度按每次调用的「等待决定」计数，上限 256；第 257 条收到明确拒绝，已接纳审批保持有效。接受合法决定后立即释放额度；自动审批不占此额度。问题与 MCP elicitation 保留独立的 16 条未完成额度。`full_access` 仍使用 Codex `untrusted` 策略，由 Runtime 自动处理支持的审批，以保留动态 MCP 行为。

同一 app-server 的所有 stdin 帧共用有界发送器：普通队列最多 4096 条 / 64 MiB（含在途帧），协议拒绝与中断另留 8 条 / 64 KiB；人工额度拒绝走普通队列，避免正常超额突发挤满控制预留。按序等待写回调，并在 `write=false` 时等待 `drain`；连续 5 秒无写入进展或入队后 30 秒未完成投递即失败。人工决定期限仍为 10 分钟。resolved 仅表示本地写回调成功，不代表 Provider 已读取或工具执行完成。取消会删除尚未发送的响应；已进入管道的字节无法撤回。

本地容量、写入和超时故障使用结构化原因，优先于无关插件 stderr 中的 Unauthorized。native 的 `HOST_EXECUTION_FAILED.failure` 与 canonical 失败保留相同原因；真实 Provider 认证拒绝仍按凭据错误处理。

## 自有进程清理

默认 POSIX spawn 创建自有独立进程组。清理会 await 有界的 `SIGTERM` → `SIGKILL` 升级及进程组退出确认；app-server leader 已退出但工具仍在时也会清理该组。注入的 `spawnFn` child 不推定拥有进程组，清理目标是直接子进程。

Windows 上本 Adapter 未启用共享工具的 `processTree` 选项；直接子进程终止与退出确认不能证明全部后代已退出。Kernel 的额外清理由其自身所有权路径负责。宿主崩溃和逃离自有组的进程不在正常清理保证内；消费方须检查清理失败，不能把取消回执当作退出证明。

执行终态与取消见[输出与交互控制](../../docs/zh-CN/reference/output-and-control.md)，`shutdown()` 清理结果见 [Executor Core](../octo-runtime-executor-core/README.zh.md)。

## 导入与分发

private workspace 包，包含在 CLI 发行物里。没有单独的 npm 包，也没有公开 SDK 子路径。

## 延伸阅读

- [实现](src/index.ts)、[Adapter SDK](../octo-runtime-adapter-sdk/README.zh.md)、[Runtime 公共协议](../octo-runtime-protocol/README.zh.md)。
- [输入参考](../../docs/zh-CN/reference/invoke-input.md)。
