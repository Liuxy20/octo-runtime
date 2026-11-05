# 输出与控制

[English](../../en/reference/output-and-control.md) | [文档目录](../README.md)

## 输出模式

通过 `protocol_mode` 选择 `client.invoke` 的返回格式：

- `canonical`：返回统一的 `CanonicalEvent`，适合应用使用同一套代码处理不同 Provider。
- `native`：返回 `HostFrame`，保留 Provider 原生消息及 Runtime 控制信息，适合需要处理原生协议的应用。

默认值是 `native`，但部分 Adapter 只支持 `canonical`。普通接入建议显式设置 `protocol_mode: "canonical"`。一次调用开始后，重连时也必须使用原来的输出模式。

## 判断执行是否结束

使用 canonical 输出时，检查最终事件：`run.completed` 表示成功，`run.failed` 表示失败，`run.cancelled` 表示取消。执行失败可能通过事件返回，而不抛出异常，因此既要处理事件，也要捕获读取过程中的错误。[invokeOnce](../../examples/invoke.mts) 演示了这两种处理。

使用 HostFrame 时，通过公开的 `isHostTerminal` 判断 Runtime 最终状态。状态包括 `running`、`completed`、`failed`、`cancelled` 和 `lost`。终态不能替代资源清理确认；direct Extra 还会按完整调用凭据等待 Core 的首次清理结果，再汇总 close.complete。

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

Extra 的 `context.execution` 在 direct 和 IPC 下都采用观察语义：结束迭代不取消已接纳工作。只有显式 signal/cancel 或 Extra 关闭请求取消所属调用；该语义与裸 Core iterator 不同。

## 回复审批和用户问题

> **Extra 兼容性要求：登记或展示交互前，必须先检查 `payload.delivery`。** `delivery: "async"` 是可选的旁路信息补充，不表示执行正在等待用户。没有实现下述异步合同时，不得直接接入已有同步表单、`/respond` 命令或等待状态处理器。

canonical 模式的 `interaction.requested` 包含 `interactionId`、`executionInstanceId` 和 `request`。`kind` 表示交互类型：`approval` 是审批，`question` 是追问，`elicitation` 是请求用户补充信息。同步请求必须有 `expiresAt`（ISO 时间戳），异步问题可省略。以下回复流程适用于同步交互：

1. 将 `request` 展示到应用的交互界面。
2. 收集用户决定或回答。
3. 在原客户端上调用 `client.respondInteraction(invocationId, response)`。
4. 继续读取事件，直到执行结束。

共享的[交互示例](../../examples/interactions.mts) 使用应用提供的决策函数完成这个流程。不要根据普通 Context 中的文字自动批准请求。

审批回复包含 `{interactionId, outcome}`，例如 `accepted`、`declined` 或 `cancelled`。追问和信息补充使用 `outcome: "answered"`，并按请求填写 `value`。具体格式见 [InteractionResponse 类型和校验器](../../../packages/octo-runtime-protocol/src/index.ts)。回复应对应原请求，不能扩大其申请的权限范围。

native 模式下，保存 Provider 的 request ID，再调用 `respondNativeInteraction(invocationId, {requestId, payload})`。`payload` 必须符合该 Provider 对当前待回复请求的响应格式。Provider 的初始化和本轮执行仍由 Driver 管理，不能通过此接口另外启动 turn 或修改账户、全局配置和任意 thread。

HostFrame 的 control 消息报告交互状态：`pending`、`resolved`、`expired`、`invalidated`，其中 `pending` 的期限使用 Unix 时间戳毫秒数。回复被接受后，还会通过后续通知更新状态。已过期、已回复、属于旧执行、模式错误或执行已结束的请求不能再次回复；取消或执行丢失也会使待回复交互失效。

`full_access` 策略可以处理受支持的审批，但不会替用户回答追问或信息补充请求。

### 异步问题合同

Codex 可在继续工作时发布 `kind: "question"`、`delivery: "async"` 的 `interaction.requested`。表单打开期间仍需持续读流。请求结构为 `{schema: "octo.question-request/v1", messageId, questions: [{id, title, options, allowCustom: true}]}`；选项可为 null 或空数组，始终支持自定义文本。原请求与宿主持有的 pending 状态授权补答，不能仅凭消息快照推断可答。用 messageId 关联成一个表单，不解析 Markdown。

整批提交一次，使用 `outcome: "answered"`，以及 `value: {schema: "octo.question-response/v1", answers: [{questionId: "q:0", text: "选项原文或自定义答案"}]}`。每个题目 ID 必须恰好回答一次；每题非空白且不超过 4096 Unicode 码点。公开入口示例见 [asyncQuestionForm](../../examples/interactions.mts)。

Runtime 向原活动轮次发送一次 `turn/steer`，匹配的 RPC 成功响应到达后，Promise 才成功，并发布 `resolved/answered/provider_accepted`。它只证明 Provider 接纳，不证明落盘、模型已阅读或任务成功。`ASYNC_ANSWER_REJECTED` 表示明确拒绝；`OPERATION_OUTCOME_UNKNOWN` 表示已发送但未确认，两者均不得自动重试。`INVALID_QUESTION_RESPONSE` 可在发送前修正；重复或失效提交报 `INTERACTION_NOT_ACTIVE`。

异步 ask 是会话旁路补充：可以不填，原任务照常结束；正常完成后仍可通过同一表单补答。公共 `/executor-kernel` 的 `AsyncQuestionReply` 在活动时 steer，确认正常完成后复用 `client.invoke` 创建新的 AgentRun。宿主显式提供当前会话的 continuation input（sessionId/generation/providerSession/Context/配置），SDK 生成新执行身份，并携带原题和答案。Codex 新 Run 强制 `providerSession.requireResume=true`，恢复失败即失败，不能另开 Provider 会话。

`respond` 返回 `route: "steer"` 时已获 Provider 接纳；返回 `route: "new_run"` 时只提供 `events` 执行流，消费流才提交，不能显示答案已送达。新 Run 的 Runtime 受理、Provider 接纳、模型使用与任务完成分别观察。完整示例见 [asyncSupplementForm](../../examples/interactions.mts)。原低层 respond 仍只接受活动 Run。

旁路默认不设到期时间；可选 expiresAt 到期后拒绝，同步交互仍必须提供期限。cancel 只关闭表单，不取消模型。宿主唯一控制者负责保存 `snapshot()`，持续通过 `observe` 记录原 Run 的真实终态及交互结果；保存为 pending/completed 的问题可在重启后续跑，仅 running 或提交未知不能重放。会话 reset/binding 变化拒绝旧题。steer ACK 丢失返回未知，绝不转新 Run 或自动重交。SDK 不提供宿主数据库事务或跨控制者恰好一次保证。

同步与异步共享 16 个活动交互上限；每批最多 50 题，每题最多 50 个选项，题目及选项各最多 4096 码点。损坏或超限问题明确失败。同步问题、elicitation、审批和 full_access 语义保持原样。宿主仍需接入表单界面，不解析 Markdown。

### Extra 必须明确选择处理方式

**所有消费交互事件的 Extra，都必须明确选择以下一种策略：**

- **不支持异步表单：** 在交互登记、秘密输入检查、命令/卡片生成及等待状态投影之前忽略 async `interaction.requested`。按原 Run 保存其 `interactionId`，并配对忽略不携带 `delivery` 的 `interaction.resolved`。继续读流、推进原游标、正常展示消息正文；不自动回答、不暂停，也不能让被忽略的 resolved 清掉同步问题的等待状态。身份记录必须有容量上限并随所属 Run 清理。
- **支持异步表单：** 保留原请求、题目身份、Provider/会话绑定和提交状态，收集完整的 `octo.question-response/v1` 答案批次，支持自定义文本与取消，并接入上述公共 `AsyncQuestionReply` 生命周期。明确处理期限、重复提交、旧绑定、重启及未知投递；运行中 steer，确认正常完成后才允许同会话新 AgentRun。Provider 接纳前不得报告送达。

**不能靠删除期限检查，或把字符串答案传给旧同步处理器来宣称兼容。** async 缺少 `expiresAt` 是合法状态，不表示已过期；回答必须是结构化整批数据。应按 `delivery` 分流，不能用 `kind`、`full_access`、题目文案或有无选项猜测。`responseRequired: false` 仅用于自动审批，不能用来识别异步问题。

内置 `channel-gateway`、`channel-wecom` 和 `webui` 均采用第一种策略：正常展示正文，不显示异步表单或回答命令、不改变等待状态；原同步问题、审批及 elicitation 保持原有行为。新增 Extra 或自定义交互渲染器必须明确做出选择；能接收公共协议不等于已支持异步表单。另见 [Extra 开发入口](../guides/extras.md)。

## 错误与恢复

记录错误对象中的稳定错误码，再决定如何恢复。例如，输入错误应修正参数，输出连接断开应查询原执行。如果提交回执丢失，Provider 可能已经开始工作，此时直接重试 `invoke` 可能重复执行。重连步骤见 [Kernel IPC](kernel-ipc.md)，常见错误见[故障排查](../guides/troubleshooting.md)。

来源：[帧校验与 canonical 视图](../../../packages/octo-runtime-protocol/src/run-protocol.ts)、[事件类型](../../../packages/octo-runtime-protocol/src/index.ts)、[Kernel client](../../../packages/octo-runtime-executor-kernel/src/client.ts)。
