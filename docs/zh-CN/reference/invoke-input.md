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

公共执行 bean 包括 workspace、adapter、model、envs、mcp、approval_policy 和 limits。私有 item 不需要中央注册；无关 Adapter 忽略，消费它的 Adapter 负责语义校验。公共层只检查信封结构、JSON、唯一键及容量。

AgentEnv 只有 `schema`、`items`。模型、思考强度等共性配置使用公共 bean；Harness 专属配置由宿主和对应 Adapter 约定为私有 item。Core 仅读取路由并保序透传，Adapter 通过 adapter-sdk 直接读取、校验和映射；不生成中间配置对象。见[架构中的 OpenClaw 示例](../concepts/architecture.md)。

## 调用方拥有工作目录

本地执行必须显式指定已存在的绝对目录。使用 `octo.execution/workspace` 的 `payload: { "path": "/absolute/prepared/project" }`。目录选择、创建、复用和删除归调用方；CLI 与 SDK 都不默认取 cwd，不分配应用工作区。调用方自己创建的临时目录遵守相同合同。

Runtime 在 Provider 执行前检查本地路径，不创建或重建。未提供路径返回 `WORKDIR_REQUIRED`，相对或非法路径返回 `WORKDIR_INVALID`，目录不存在返回 `WORKDIR_NOT_FOUND`，路径为文件返回 `WORKDIR_NOT_DIRECTORY`，无权限或其他不可用返回 `WORKDIR_UNAVAILABLE`。这些原因码沿用公开分类 `OH-ADP-3004`；可读取异常 `.code`、canonical 失败的 `payload.code` / `failure.reasonCode` 或 native error control。检查不能阻止检查后、Provider 操作前的文件系统变化，后续原生错误仍如实返回。

续接和显式 fresh recovery 仍须传入选定目录。目录消失就失败，不补建或另选。外部/preset Agent 与声明 `metadata.workspace: false` 的 Adapter 可以不传本地覆盖；OpenClaw 使用自身工作区，不把远端路径当本地目录检查。Runtime Home、日志、IPC 文件和 Provider 自有状态继续分别管理。

Issue #335 删除 workspace `mode`（`fixed`、`random`、`none`）、回执/投影中的 `workspace_mode`、`prepareRunContext` 与 `WorkspaceAssignments`。带旧 mode 的 payload 明确拒绝；调用方须删掉它并在调用前准备目录。不提供兼容转换，不删除用户数据；历史分配的目录仍归用户。Run 7、Context v3、IPC 2 和 Adapter transport 2 保持不变。

## 应用提示词

应用启动提示词属于普通输入，不属于执行配置。`octo.control/instructions` 和 `controlInstructions` 已删除，即使为空也拒绝；没有替代的 system/developer/trusted 提示词字段。调用方删除配置中的旧项，在调用前将需要的文本放到输入 parts 前面，自行决定首轮、续接和重建时的内容、顺序及是否携带，见[会话指南](../guides/context-and-sessions.md)。

## 内容和恢复

`InvocationContent` 必填 parts，另支持 `protocol_mode`（默认 native）、`invocationId`、`runId`、`sessionName`、`sessionGeneration`、`providerEpoch`、`prompt`、`modelInput`、`runMetadata`、`continuityMode`、`freshFallbackModelInput`、`freshFallbackModelInputParts`、`freshFallbackImagesUnavailable`。业务身份由应用提供或 client 生成；不要从 Provider ID 推导。

图片使用 type/image、mimeType、base64 data、byteSize 和 sha256；1–128 个输入 parts。整次 IPC 请求最多 32 MiB，主输入和恢复输入各自计入。恢复材料由应用显式冻结；Runtime 不从历史重建。历史图片不可用时显式 freshFallbackImagesUnavailable，不能静默改成纯文本。

Runtime 保留传入文本/图片的顺序，不添加提示词或分隔符。提供 modelInput 或 freshFallbackModelInput/Parts 时，每份都是该路径的完整调用方输入，须包含需要的启动提示词。不能依赖 Runtime 在新建 Provider 会话时补指令，也不能在重试同一冻结输入时再次追加。

输入选择由字段明确决定：inputs 仅含文本时，显式 modelInput 替换主 Provider 输入；包含图片时保留原有有序 parts。未提供 modelInput 的普通数组保持原样。Fresh fallback 依次选择 freshFallbackModelInputParts、作为一个普通文本 part 的 freshFallbackModelInput、主输入 parts，不通过比较文本猜测意图。会丢失当前图片的纯文本恢复被拒绝；显式恢复 parts 须保留当前图片及其顺序。

## 低层 IPC v2

CLI JSON 和 `client.submit` 使用 `InvokeInput`：`{ inputs, sessionId?, providerSession?, agentEnv, ...内容/追踪字段 }`。`InvokeInput.check` 做边界校验；Adapter 直接消费执行配置。低层 submit/subscribe 由高级调用者自行持有完整 RunRef、取消和尾流，不自动进入 invoke 登记。

旧 `invoke(request, environment)`、`cancelInvocation`、contexts 和顶层执行设置均不兼容。client 只接受 IPC v2。独立 Gateway 须先完成自己的提示词迁移，才能使用删除旧合同的 Runtime/client 版本；仅修改 Runtime 不代表完成端到端迁移。内部 Core/Adapter 的 InvokeEnvironment.signal 仍作为取消传递机制，它不是公开 invoke 参数。

来源：[协议](../../../packages/octo-runtime-protocol/src/invoke-input.ts)、[Client](../../../packages/octo-runtime-client/src/client.ts)。另见[标识](../concepts/identifiers.md)。
