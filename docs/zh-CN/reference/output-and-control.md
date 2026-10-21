# 输出与控制

[English](../../en/reference/output-and-control.md) | [文档目录](../README.md)

## 输出模式

通过 `protocol_mode` 选择 `client.invoke` 的返回格式：

- `canonical`：返回统一的 `CanonicalEvent`，适合应用使用同一套代码处理不同 Provider。
- `native`：返回 `HostFrame`，保留 Provider 原生消息及 Runtime 控制信息，适合需要处理原生协议的应用。

默认值是 `native`，但部分 Adapter 只支持 `canonical`。普通接入建议显式设置 `protocol_mode: "canonical"`。一次调用开始后，重连时也必须使用原来的输出模式。

## 判断执行是否结束

使用 canonical 输出时，检查最终事件：`run.completed` 表示成功，`run.failed` 表示失败，`run.cancelled` 表示取消。执行失败可能通过事件返回，而不抛出异常，因此既要处理事件，也要捕获读取过程中的错误。[invokeOnce](../../examples/invoke.mts) 演示了这两种处理。

使用 HostFrame 时，通过公开的 `isHostTerminal` 判断 Runtime 最终状态。状态包括 `running`、`completed`、`failed`、`cancelled` 和 `lost`。Runtime 在执行清理后才报告最终状态；仅收到 Provider 的结束消息，还不能认定 Runtime 已完成处理。

`lost` 表示无法确定执行结果，KernelClient 会报告 `RUN_OUTCOME_UNKNOWN`。没有收到最终状态，或发生输出缺失、清理失败时，都不能按成功处理。应用是否已保存结果、投递消息或更新 UI，需要应用另外确认。

## HostFrame 的结构

HostFrame 带有执行和会话标识：`run_id`、`invocation_id`、`stream_id`、`agent_session_id`、`session_generation`，以及 `protocol_mode`、`protocol`。`seq` 是从 1 开始的输出序号，用于断线后继续读取。

帧分三类：`native` 保存 Provider 原生数据和扩展字段，`canonical` 的 `event` 保存统一事件，`control` 报告状态、错误、交互状态和输出缺失。三类帧共同使用同一套 `seq`。如果自己实现 IPC 客户端，应保存收到的帧序号，不能用 canonical 事件数量推算读取位置。

## 取消

取消执行有两种方式：

- 在 `client.invoke(input, {signal})` 中传入 `AbortSignal`，再调用对应 `AbortController` 的 `abort(reason)`。
- 在发起该调用的同一个客户端上，调用 `cancelInvocation(invocationId, reason?)`。使用这种方式时，先在输入中设置 `invocationId`，以便其他代码引用该调用。

如果请求尚未发送，取消可阻止提交。如果已经发送，客户端会找到原执行并请求取消，同时继续接收剩余输出。使用已取消的 signal 时，读取正常结束后会抛出原始取消原因；若读取期间发生更具体的输出或控制错误，则优先返回该错误。

取消接口返回的 `{accepted}` 表示是否接受取消请求。还需要继续读取输出，才能知道执行最终是否取消。对于 KernelClient，循环 `break`、迭代器 `return()`、客户端 `close()` 或取消订阅都只停止接收输出，不会取消执行。直接使用 AgentExecutor 时，提前关闭执行迭代器则会请求取消。

## 回复审批和用户问题

canonical 模式通过 `interaction.requested` 通知应用需要用户交互。事件包含 `interactionId`、`executionInstanceId`、`expiresAt`（ISO 时间戳）和 `request`。`kind` 表示交互类型：`approval` 是审批，`question` 是追问，`elicitation` 是请求用户补充信息。

1. 将 `request` 展示到应用的交互界面。
2. 收集用户决定或回答。
3. 在原客户端上调用 `client.respondInteraction(invocationId, response)`。
4. 继续读取事件，直到执行结束。

共享的[交互示例](../../examples/interactions.mts) 使用应用提供的决策函数完成这个流程。不要根据普通 Context 中的文字自动批准请求。

审批回复包含 `{interactionId, outcome}`，例如 `accepted`、`declined` 或 `cancelled`。追问和信息补充使用 `outcome: "answered"`，并按请求填写 `value`。具体格式见 [InteractionResponse 类型和校验器](../../../packages/octo-runtime-protocol/src/index.ts)。回复应对应原请求，不能扩大其申请的权限范围。

native 模式下，保存 Provider 的 request ID，再调用 `respondNativeInteraction(invocationId, {requestId, payload})`。`payload` 必须符合该 Provider 对当前待回复请求的响应格式。Provider 的初始化和本轮执行仍由 Driver 管理，不能通过此接口另外启动 turn 或修改账户、全局配置和任意 thread。

HostFrame 的 control 消息报告交互状态：`pending`、`resolved`、`expired`、`invalidated`，其中 `pending` 的期限使用 Unix 时间戳毫秒数。回复被接受后，还会通过后续通知更新状态。已过期、已回复、属于旧执行、模式错误或执行已结束的请求不能再次回复；取消或执行丢失也会使待回复交互失效。

`full_access` 策略可以处理受支持的审批，但不会替用户回答追问或信息补充请求。

## 错误与恢复

记录错误对象中的稳定错误码，再决定如何恢复。例如，输入错误应修正参数，输出连接断开应查询原执行。如果提交回执丢失，Provider 可能已经开始工作，此时直接重试 `invoke` 可能重复执行。重连步骤见 [Kernel IPC](kernel-ipc.md)，常见错误见[故障排查](../guides/troubleshooting.md)。

来源：[帧校验与 canonical 视图](../../../packages/octo-runtime-protocol/src/run-protocol.ts)、[事件类型](../../../packages/octo-runtime-protocol/src/index.ts)、[Kernel client](../../../packages/octo-runtime-executor-kernel/src/client.ts)。
