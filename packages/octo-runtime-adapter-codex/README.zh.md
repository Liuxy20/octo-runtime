# Codex Adapter

[English](README.md) | [包导航](../README.zh.md)

驱动双向的 `codex app-server` 协议。宿主显式创建 managed owner 或注入业务 CodexEngineProvider；兼容调用复用常驻 app-server，每代进程只初始化一次。Adapter 管理每轮 thread/turn、反向请求、canonical/native 输出、审批与定向取消。

## 什么时候用它

- 宿主机上装好 Codex 并完成认证。
- 你想把审批和交互提问交回自己的 UI，而不是预先答复。
- 你需要 native Provider 负载；这个 Adapter 同时支持 `native` 和 `canonical`。

## 注册 Adapter 并准备输入

以下节选负责注册与输入准备。实际执行使用 `executor.invoke(input)`；完整的消费、终态判断和 `shutdown()` 示例见 [Executor Core](../octo-runtime-executor-core/README.zh.md)。

```ts
import { AgentExecutor } from "@mininglamp-oss/octo-runtime/executor-core";
import { InvokeInput } from "@mininglamp-oss/octo-runtime/protocol";
import { createCodexAdapter, createManagedCodexEngine } from "@mininglamp-oss/octo-runtime/adapters/codex";

const executor = new AgentExecutor();
const owner = createManagedCodexEngine({ codexHome: "/absolute/host-codex-home" });
executor.register(createCodexAdapter({ engine: owner.provider }));

const input = InvokeInput.check({
  inputs: [{ type: "text", text: "Say hello." }],
  protocol_mode: "canonical",
  agentEnv: {
    workdir: "/absolute/prepared/project",
    schema: "octo.context-envelope/v3",
    items: [{ namespace: "octo.execution", name: "adapter", payload: { type: "codex" } }]
  }
});
```

## 绑定了什么

| 项           | 值                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------- |
| Adapter 类型 | `codex`                                                                                                       |
| 导出         | `createCodexAdapter`、`createManagedCodexEngine` |
| 协议         | `codex.app-server`，模式 `native` 与 `canonical`                                                              |
| 传输         | 宿主拥有常驻 app-server，Adapter 借用 channel |
| 会话         | 显式 Provider 会话对应原生 thread；resume 被拒或 rollout 缺失时，可以用调用方给的恢复输入做一次新 thread 兜底 |
| 交互         | 命令/文件审批、用户输入、MCP elicitation，都回到同一个活动请求上应答                                          |

## 配置与会话归属

上例采用 `ask` 审批模式，推理强度沿用 Provider 默认。审批通过 Context `octo.security/approval_policy` 设置，强度通过 `octo.execution/model.payload.reasoning.effort` 设置。公共 `InvokeInput.agentEnv.approvalMode` 也可显式指定，但必须与显式 Context 策略一致。Adapter 接收准备后的内部 `InvokeRequest`；当前字段与被拒绝的旧配置见[输入参考](../../docs/zh-CN/reference/invoke-input.md)。

调用方保存会话更新中的完整 `providerSession`（含 Provider 扩展字段），并在下一轮显式回传。只复用业务 `sessionId` 会新开 Provider 会话；Core 不持久维护业务会话到 Provider 的绑定表。续接与恢复输入步骤见[背景资料与会话](../../docs/zh-CN/guides/context-and-sessions.md)。

兼容配置包含可执行文件身份、argv、cwd、完整有效环境、`CODEX_HOME`、MCP 语义配置、有效 `rawMessageMaxBytes` 预算和 `agentConfig.providerOptions.codexServiceRevision`。原地修改原生配置或凭据后，更新该修订值或重建 owner。兼容键和凭据不进入诊断；进程快照只报告归属、PID、状态及代次。裸描述对象调用要求显式创建执行作用域；通过 Core 注册时自动绑定。

空闲或活动期间 transport 失效都会主动恢复自有进程；每个恢复周期最多替换 5 次，总预算 90 秒，不重放原业务或控制请求。可执行文件不存在等启动错误直接失败，不反复重试。连续健康 60 秒后重置恢复预算。

## 构造、Home 与所有权

createCodexAdapter({engine}) 为 Codex 专用签名；engine.acquire 返回 {channel, configuration}。channel.close 幂等且只释放本轮，configuration 仅包含 MCP 服务视图。provider 管理共享 RPC ID、thread/turn 路由与配置拒绝，不向 Adapter 暴露 owner.close。注册同一 descriptor 到多个 Core 借用同一 provider；宿主也可以为各 Runtime 分别创建 owner。

SDK 必须显式传绝对 codexHome，缺失/相对路径报 CODEX_HOME_REQUIRED，逐轮冲突报 CODEX_HOME_CONFLICT。目录准备、权限与数据保留归宿主，关闭/恢复不删除 Home。CLI 自己选择默认 ~/.codex。业务已有 Engine 可注入自己的 provider，关闭借用 Kernel 不关闭业务 owner。

旧单例、默认导出和旧进程构造参数已删除，无兼容层。其他 Adapter 的构造方式与参数完全由实现者决定，不要求 Codex 类型或统一 options。正常关闭、初始化回滚见[SDK 示例](../../docs/examples/codex-service.mts)和[架构](../../docs/zh-CN/concepts/architecture.md)。

## 限制

- `ask` 和 `assisted` 模式通过当前交互桥处理审批；`full_access` 自动处理支持的审批，但不回答用户问题或 MCP elicitation。
- 有序的文本与图片输入（包括纯图片输入）会变成原生 text 和 image data URL，不是宿主本地路径。Adapter 支持图片不代表所选模型接受图片。格式、完整性字段和容量限制见[输入参考](../../docs/zh-CN/reference/invoke-input.md)。
- 权威的 session update 只在 turn start 成功后上报；Adapter 从不重建应用历史。
- turn 回执、一段文本、子进程退出，都不证明执行成功或清理完成。
- native 模式下必须同时读 Runtime 控制帧和 Provider 负载。
- 每个 managed owner 最多 8 种服务配置，每个服务最多 8 个不同活动 thread；同 thread 并发明确拒绝。启动/恢复等待最多 128 条、32 MiB；每代次保留最多 4096 个已用 thread 的归属历史。容量不足不驱逐健康服务。
- 缺少 turnId 的 elicitation 只在首次活动订阅上可归属；复用 thread 时无法证明因果关系，明确拒绝。
- 非空且完成的 `final_answer` 在无活动工作、无同步交互时，可于 15 秒 finalization fallback 后完成。取消、Provider error 和后续新工作会使资格失效。轮次清理独立记录，结果完成后仍可能清理失败。

人工审批额度按每次调用的「等待决定」计数，上限 256；第 257 条收到明确拒绝，已接纳审批保持有效。接受合法决定后立即释放额度；自动审批不占此额度。问题与 MCP elicitation 保留独立的 16 条未完成额度。`full_access` 仍使用 Codex `untrusted` 策略，由 Runtime 自动处理支持的审批，以保留动态 MCP 行为。

同一 app-server 的所有 stdin 帧共用有界发送器：普通队列最多 128 条 / 32 MiB（含在途帧），协议拒绝与中断另留 8 条 / 64 KiB；人工额度拒绝走普通队列，避免正常超额突发挤满控制预留。按序等待写回调，并在 `write=false` 时等待 `drain`；连续 5 秒无写入进展或入队后 30 秒未完成投递即失败。人工决定期限仍为 10 分钟。resolved 仅表示本地写回调成功，不代表 Provider 已读取或工具执行完成。取消只删除所属调用的排队响应；已进入管道的字节无法撤回。

本地容量、写入和超时故障使用结构化原因，优先于无关插件 stderr 中的 Unauthorized。native 的 `HOST_EXECUTION_FAILED.failure` 与 canonical 失败保留相同原因；真实 Provider 认证拒绝仍按凭据错误处理。

## 自有进程清理

默认 POSIX spawn 创建自有独立进程组。清理会 await 有界的 `SIGTERM` → `SIGKILL` 升级及进程组退出确认；app-server leader 已退出但工具仍在时也会清理该组。注入的 `spawnFn` child 不推定拥有进程组，清理目标是直接子进程。

正常完成、Stop 和 business consumer 关闭只释放所属调用的订阅。Core.shutdown 只清理本地 scope/lease。宿主先 owner.beginShutdown，再关闭 Core/Kernel，最后 owner.close({deadline}) 并检查 complete。deadline 使用 performance.now() 绝对毫秒。owner.processes() 和 Kernel 的宿主 serviceProcesses 回调只读，不启动或 probe Provider。

Windows 默认自有 spawn 启用既有系统命令的进程树清理；注入 child 仅清理直接子进程。Windows 进程树清理依赖仍可识别的 leader；父进程先退出、宿主崩溃及逃逸后代不能保证全部清空。须检查清理结果，不能把取消回执当作退出证明。

执行终态与取消见[输出与交互控制](../../docs/zh-CN/reference/output-and-control.md)，`shutdown()` 清理结果见 [Executor Core](../octo-runtime-executor-core/README.zh.md)。

## 导入与分发

private workspace 包，包含在 CLI 发行物里。外部通过 `@mininglamp-oss/octo-runtime/adapters/codex` 导入，没有单独的 npm 包。

## 延伸阅读

- [实现](src/index.ts)、[Adapter SDK](../octo-runtime-adapter-sdk/README.zh.md)、[Runtime 公共协议](../octo-runtime-protocol/README.zh.md)。
- [输入参考](../../docs/zh-CN/reference/invoke-input.md)。
