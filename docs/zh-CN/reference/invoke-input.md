# Invoke API 与 IPC 输入

[English](../../en/reference/invoke-input.md) | [文档目录](../README.md)

公开调用为 `client.invoke(inputs, sessionId, providerSession, agentEnv)`，返回 `KernelInvocation` 异步迭代器。调用时生成/冻结身份和输入，首次消费才提交。未消费的句柄也占 client 的 128 条登记预算；请消费、`return()`、`throw()`、`interrupt()` 或由 owner drain 释放。结束已接纳调用的观察不会隐式取消执行。

| 参数 | 含义 |
| --- | --- |
| inputs | 有序文本/图片数组；高级形式 `InvocationContent` 使用 parts，另携带 protocol_mode、身份/代次、runMetadata 和显式恢复内容。不得包含 contexts、agentEnv、sessionId、providerSession 或 signal。 |
| sessionId | 业务方的会话 ID；传 undefined 由 client 生成，仅关联业务，不恢复 Provider。 |
| providerSession | 上轮 Provider 返回的完整 opaque 对象；传 undefined 表示新建。 |
| agentEnv | 必填执行信封，items 可以为空。默认 Adapter 为 codex，审批 ask，整轮执行预算 24 小时。 |

`run.invocationId`、`run.runId`、`run.sessionId` 立即可读。`client.interrupt(run.invocationId, reason?)` 只控制本 client 的该次调用，不把 signal 放进 invoke。提交前中断阻止请求发送，迭代器抛可由 `isInvocationNotSubmitted` 识别的错误；提交后保留原流观察终态。受理 ACK 不代表执行终态或清理完成。

## agentEnv

信封 schema/items 不变。允许 `octo.execution/*`、`octo.security/approval_policy`、`octo.control/instructions`，拒绝业务材料。工作目录用 workspace；Adapter 用 adapter；模型和思考强度用 model；环境变量用 envs；MCP 用 mcp；审批用 approval_policy；预算用 limits。

执行配置还支持 agentEnv 内的 `agentSource`、`workdir`、`controlInstructions`、`approvalMode`、`agentConfig`、`runtimeLimits`，用于完整 Provider 配置和高级设置；与 items 同时提供的选择必须一致。它们不再是 InvokeInput 顶层字段。`agentConfig.providerOptions` 归具体 Adapter。OpenClaw adapter item 显式提供 provider_agent_id（通常 main）。

## 内容和恢复

`InvocationContent` 必填 parts，另支持 `protocol_mode`（默认 native）、`invocationId`、`runId`、`sessionName`、`sessionGeneration`、`providerEpoch`、`prompt`、`modelInput`、`runMetadata`、`continuityMode`、`freshFallbackModelInput`、`freshFallbackModelInputParts`、`freshFallbackImagesUnavailable`。业务身份由应用提供或 client 生成；不要从 Provider ID 推导。

图片使用 type/image、mimeType、base64 data、byteSize 和 sha256；1–128 个输入 parts。整次 IPC 请求最多 32 MiB，主输入和恢复输入各自计入。恢复材料由应用显式冻结；Runtime 不从历史重建。历史图片不可用时显式 freshFallbackImagesUnavailable，不能静默改成纯文本。

## 低层 IPC v2

CLI JSON 和 `client.submit` 使用 `InvokeInput`：`{ inputs, sessionId?, providerSession?, agentEnv, ...内容/追踪字段 }`。`InvokeInput.check` 做边界校验；Core 再解析执行配置。低层 submit/subscribe 由高级调用者自行持有完整 RunRef、取消和尾流，不自动进入 invoke 登记。

旧 `invoke(request, environment)`、`cancelInvocation`、contexts 和顶层执行设置均不兼容。client 只接受 IPC v2；升级 Runtime 与 client 后再部署 Gateway。内部 Core/Adapter 的 InvokeEnvironment.signal 仍作为取消传递机制，它不是公开 invoke 参数。

来源：[协议](../../../packages/octo-runtime-protocol/src/invoke-input.ts)、[Client](../../../packages/octo-runtime-client/src/client.ts)。另见[标识](../concepts/identifiers.md)。
