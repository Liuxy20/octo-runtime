# Runtime 公共协议

[English](README.md) | [包导航](../README.zh.md)

Octo Runtime 里所有跨模块边界的数据合同：交给执行器的输入、跟随一轮调用的 Context、返回的事件，以及判断这一轮到底有没有成功。`InvokeInput`、`CanonicalEvent`、`HostFrame` 和 Context envelope 都在这里，以 JSON Schema、TypeScript 类型和运行时校验器的形式存在。

## 什么时候会碰到这个包

- 你要构造 `InvokeInput`，然后调用 Core 或 Kernel。
- 你要消费输出，需要分清"进度"和"终态"。
- 你要写 Adapter 或宿主，需要精确的 JSON 形状。

它不执行 Provider、不选择业务 Context、不保存历史。这里是词汇表，不是引擎。

## 校验一次调用

```ts
import { InvokeInput } from "@mininglamp-oss/octo-runtime-protocol";

const input = InvokeInput.check({
  inputs: [{ type: "text", text: "Summarize the last commit." }],
  agentEnv: {
    schema: "octo.context-envelope/v3",
    items: [
      {
        namespace: "octo.execution",
        name: "workspace",
        payload: { path: "/absolute/prepared/project" }
      },
      { namespace: "octo.execution", name: "adapter", payload: { type: "dsh" } }
    ]
  }
});
```

`check` 在形状不合法或负载超限时抛错，否则原样返回。它不调用任何东西，也不生成任何 ID：`invocationId`、`runId`、`sessionId` 由 Core 或 Kernel 在你省略时补齐，需要取消或对账就保存返回的对象。

## 真正要关心的字段

| 字段                                 | 必填 | 作用                                                                                    |
| ------------------------------------ | ---- | --------------------------------------------------------------------------------------- |
| `inputs`                             | 是   | 本轮按顺序排列的文本与图片分片，图片字节只放这里一次。                                  |
| `agentEnv`                           | 是   | Context v3 envelope，其中 `octo.execution` / `adapter` 项决定用哪个 Adapter；为空合法。 |
| `octo.execution/workspace.payload.path`                   | 本地调用必需 | workspace item 中的调用方已准备的现有绝对目录。无 cwd 默认值，不是沙箱。 |
| `protocol_mode`                      | 否   | `native`（默认）或 `canonical`。                                                        |
| `providerSession`                    | 否   | 显式续接的 Provider 会话，绝不会从 `sessionId` 反推重建。                               |
| `sessionId`、`invocationId`、`runId` | 否   | 关联标识，省略时自动生成。不是 Provider 历史。                                          |

只有 `inputs` 和 `agentEnv` 是必填。未显式提供 Adapter item 时，Core 路由到 `codex`，配置默认值由该 Adapter 解释。Core 为 AgentEnv 复制快照并按原顺序透传所有 item；私有 item 由宿主和消费它的 Adapter 约定，无须登记公共 schema。

## 怎么读输出

同一条流有两种视图：

- `native`（默认）—— `HostFrame`：Provider 原始负载外加 Runtime 控制帧。
- `canonical` —— `CanonicalEvent`：跨 Provider 归一化后的事件，多数应用要的是这个。

native 模式下的终态是 `type: "state"` 的 `control` 帧。

## CanonicalEvent 类型

在 canonical 模式下，Adapter 负责把各家 Provider 的事件翻译成这一套，Provider 私有的名称不会漏到这一层。native-only Adapter 无须这一步转换。每条 canonical event 都是 `{ protocolVersion: 2, type, payload }`；下表按生命周期排列 24 种类型，payload 列只列你会真正读的字段，不是完整 schema。

| 类型                    | 分组        | 何时出现                                   | payload 关键字段                                                                              |
| ----------------------- | ----------- | ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `run.queued`            | run         | 已接纳、等待执行；预留，当前没有内置发送方 | —                                                                                             |
| `run.started`           | run         | 开始执行；同 `run.queued`，预留            | —                                                                                             |
| `run.completed`         | run         | 正常结束——唯一的成功终态                   | —                                                                                             |
| `run.failed`            | run         | 执行失败                                   | `message`、`code`、`adapterType`；可能附带标准化 `failure`                                    |
| `run.cancelled`         | run         | 被取消，或流被中止                         | —                                                                                             |
| `message.create`        | message     | 一条消息开始                               | `messageId`、`role`、`channel`                                                                |
| `message.delta`         | message     | 增量文本                                   | `text`、`channel`、`messageId`                                                                |
| `message.update`        | message     | 整段替换或状态更新                         | `text`、`status`、`messageId`                                                                 |
| `model_step.started`    | step        | 一轮模型调用开始                           | `stepId`、`startedAtMs`                                                                       |
| `model_step.finished`   | step        | 该轮结束                                   | `stepId`、`status`、`finishReason`                                                            |
| `tool_call.create`      | tool        | 工具调用开始                               | `id`、`name`、`args`、`status: "running"`                                                     |
| `tool_call.delta`       | tool        | 参数或输出的流式片段                       | `id`，以及 `argsDelta`、`outputDelta`、`outputSnapshot` 之一                                  |
| `tool_call.update`      | tool        | 工具调用进入终态                           | `id`、`status`、`output`、`error`、`exitCode`                                                 |
| `tool_call.progress`    | tool        | 长任务的进度                               | `id`、`progress`（`message`、`completed`、`total`、`unit`）                                   |
| `activity.started`      | activity    | 思考、执行、等待审批或输入                 | `activityId`、`kind`、`subject`、`source`、`info`                                             |
| `activity.updated`      | activity    | 活动信息刷新                               | `activityId`、`info`                                                                          |
| `activity.finished`     | activity    | 活动结束                                   | `activityId`、`status`                                                                        |
| `plan.updated`          | plan        | 整体替换计划                               | `planId`、`revision`、`steps[]`                                                               |
| `run.notice`            | notice      | 重试、上下文压缩、改道、配置告警、模型静默           | `noticeId`、`code`、`severity`、`params`                                                      |
| `interaction.requested` | interaction | 需要审批、回答或补充输入                   | `interactionId`、`kind`、`expiresAt`、`request`                                               |
| `interaction.resolved`  | interaction | 已处理、已过期或已失效                     | `interactionId`、`status`、`outcome`、`reasonCode`                                            |
| `session.update`        | state       | Provider 会话信息变化                      | `providerSession`                                                                             |
| `usage.update`          | state       | 本轮 token 用量                            | Adapter 归一的计数，如 `inputTokens`、`outputTokens`，可选 `cumulative`、`modelContextWindow` |

三条规则管住整张表：

- 每次 Run 只有一个终态：`run.completed`、`run.failed`、`run.cancelled`。除此之外都不算成功——最终消息发出不算，取消请求被接受不算，进程退出不算，流 EOF 也不算。
- 消息渠道包括 `analysis`（推理，受 `exposure` 控制）、`commentary`（过程进度）和 `final`（答案文本）。final 文本可以在终态之前流式返回；消费方必须观察到 `run.completed`，才能将它作为成功答案投递。
- 分析内容只有在 `exposure` 为 `public_reasoning`、`public_summary` 或 `public_plan` 时才公开。

## 信封与 wire 形状

裸事件不带身份。落盘或转发时，`envelope()` 补上 `id`、`seq`、`tsMs`、`runId`、`agentSessionId`；Kernel 传输层再套一层 `CanonicalHostFrame`，带 `run_id`、`invocation_id`、`stream_id`、`session_generation`。

canonical 模式下，`AgentExecutor.invoke` 和 `KernelClient.invoke` 直接给你裸事件，并替你检查序号连续：出现空洞会抛 `STREAM_GAP`，而不是静默跳过。只有自己手写 IPC 客户端才需要处理 frame。

## 版本

Run 合同 7、Context v3、Adapter protocol 2 各自独立演进。Context schema 变了不代表 Run 合同变了，要分别核对，别用一个包版本推断其他两项。

## 导入与分发

这是 private workspace 包：原生源码宿主从 `@mininglamp-oss/octo-runtime-protocol` 导入。独立应用使用 `@mininglamp-oss/octo-runtime-client/protocol` 的公共类型和校验，不需要依赖私有源码包；该入口不承诺包含所有内部导出。

[protocol.schema.json](schema/protocol.schema.json) 定义共享 wire 数据，[kernel-ipc.schema.json](schema/kernel-ipc.schema.json) 定义 IPC 请求与结果；`schema/` 只放这两个文件。[gen-types.mjs](scripts/gen-types.mjs) 生成 [protocol-types.ts](src/generated/protocol-types.ts)，并从 Schema 定义派生 `KERNEL_IPC_VERSION` 和 `RUN_PROTOCOL_ERRORS`。修改 Schema 后重新生成，不要手改生成结果。

```sh
pnpm --filter @mininglamp-oss/octo-runtime-protocol gen
pnpm --filter @mininglamp-oss/octo-runtime-protocol build
```

## 校验与资产归属

两个 Schema 使用 JSON Schema Draft-07。标准 Draft-07 校验器检查标准结构约束；`x-octo-*` 关键字描述额外语义，校验器必须显式实现后才能执行。只通过标准关键字校验不代表完整符合协议。现有运行时校验器还检查 JSON 字节/深度预算、Unicode 标量字符串、唯一性、跨字段一致性、身份和生命周期规则。生成 TypeScript 类型不能校验运行时输入，手写校验器仍有职责。

六份正反样本位于 [test/fixtures](test/fixtures)，用于验证实现是否符合合同，不属于协议定义。只有 IPC 一致性样本刻意对外发布：完整 Runtime 的 `/executor-kernel/ipc-fixtures.json` 和独立 client 的 `/protocol/ipc-fixtures.json` 原有导入路径保持，其他样本不进入发行包。

客户端连接/并发上限、超时和重试间隔由客户端实现维护，不属于共享行为协议，也不再另存一份 JSON 配置。共享 wire 字节限制继续使用协议常量。

## Schema 清理升级说明

Issue #332 删除 `kernel-client.behavior.json` 及独立 client 的 `/protocol/behavior.json` 导出。调用方停止导入此文件，使用客户端 API 及其文档默认值。IPC Schema 标识改为 `urn:mininglamp-oss:octo-runtime:kernel-ipc:v2`，使用旧 v1 标识的注册或引用需要更新；实际 IPC 版本仍为 2。删除无人消费的 `x-octo-methods` 生成元数据，RPC 方法及其请求/结果定义保持。

以下遗留类型从 Schema、生成类型与协议导出中删除：`ContextSelectionEntry`、`ContextResourceEntry`、`ContextContinuityPayload`、`ChannelScope`、`ChannelMessagePart`、`ChannelMessageSender`、`ChannelMessageFlags`、`ChannelMessageFact`、`ChannelContextAppend`、`ContextSyncRequest`、`ContextSyncResult`、`ChannelContextDescriptor`、`ContextCommitResult`。对应的五个校验器 `assertChannelScope`、`assertChannelMessageFact`、`assertChannelContextAppend`、`assertContextSyncResult`、`assertChannelContextDescriptor` 也删除。`ContextInlineEntry`、`ContextReferenceEntry` 也已删除；材料、历史及同步合同归应用。这些导出不提供兼容层，调用方须相应调整导入。

## 工作目录迁移

Issue #335 将 `octo.execution/workspace` 简化为仅含路径的 `{ "path": "/absolute/prepared/project" }`。本地 CLI 与 SDK 执行前，由调用方选择或创建已有绝对目录。Runtime 不隐式取 cwd、不分配随机目录，也不在续接/恢复时重建。声明 `metadata.workspace: false` 的 Adapter 可不传本地覆盖；OpenClaw 保持 Provider 自有工作区。

删除 `mode`（`fixed`、`random`、`none`），并更新已删除的 `workspace_mode` 回执/投影字段、`prepareRunContext` 和 `WorkspaceAssignments` 导入。旧 mode payload 明确失败，没有兼容转换；已有用户目录不删除。`WORKDIR_REQUIRED`、`WORKDIR_INVALID`、`WORKDIR_NOT_FOUND`、`WORKDIR_NOT_DIRECTORY`、`WORKDIR_UNAVAILABLE` 沿用公开分类 `OH-ADP-3004`，详见[校验与错误说明](../../docs/zh-CN/reference/invoke-input.md)。Runtime 运维目录继续独立管理。源码包版本及 Run/Context/IPC/Adapter wire 版本不变，由既有发行流程选择发布版本。独立 Gateway 采用本次发行前须迁移旧 fixed-mode payload。

## 应用提示词迁移

Issue #334 从 Runtime 及公开合同删除 `octo.control/instructions`、`controlInstructions`、`ContextInstructionEntry`、`ContextInstructionsPayload`、`contextControlInstructions()`、`initialControlInstructions()`。旧项和字段即使为空也拒绝，不保留兼容别名。调用方将应用提示词前置到普通输入 parts，自行决定新建、续接和重建时是否携带；主输入和显式 fallback 输入各自完整。Runtime 不补提示词，也不将其提升为 system/developer/受信角色。MCP、环境变量和执行策略继续放在 agentEnv。详见[会话迁移指南](../../docs/zh-CN/guides/context-and-sessions.md)。独立 Gateway 的消费者仍须另行迁移，本次不声称端到端兼容。

## 延伸阅读

- [InvokeInput](src/invoke-input.ts)、[workspace 导出](src/index.ts)、[生成类型](src/generated/protocol-types.ts)。
- [输入参考](../../docs/zh-CN/reference/invoke-input.md)、[输出与控制](../../docs/zh-CN/reference/output-and-control.md)、[Kernel IPC](../../docs/zh-CN/reference/kernel-ipc.md)。
- [协议测试](test/run-protocol.test.js)。

Issue #349 同时删除 `PublicObjectMaterial`；task/discussion、mention 和 history 等材料分类归应用。无生产消费者的旧 `ContextPreparationReceipt` 和整个 `RunContextProjection` 一并从 Schema、生成类型和导出删除，不提供兼容别名。执行配置通过 AgentEnv 条目传入，现行 Host 回执和运行事件继续维护各自合同。

endpoint 寻址、设备选择、离线等待及故障转移归业务调用方。已删除 ContextRuntimeSelectionPayload、ResolvedRuntimeSelection、RUNTIME_SELECTION_SCHEMA、assertResolvedRuntimeSelection、octo.runtime/selection catalog 条目和 RUNTIME_RUN_CONTRACT.routing_schema。client 向已选定 Runtime 发起 invoke，不保留设备选择专用合并或兼容别名。

canonical `run.notice` 包含 `model_output_idle`：Runtime 连续 60 秒无新增公开模型文本时通知一次，恢复输出后重新计满 60 秒。参见[计时、预算与 RPC 示例](../../docs/zh-CN/reference/output-and-control.md#模型输出静默通知)。native 控制类型不变。

`octo.execution/limits` 和 `RuntimeLimits` 已删除 `enforcement` 及全局关闭 watchdog 的兼容行为。旧字段必须从调用配置中移除；Adapter 读取预算时拒绝该字段。需要运行更久时，设置相应的有限预算：整轮默认 24 小时、最大 7 天；只增大 `run_timeout_ms` 不改变首帧、模型空闲或工具预算。`model_idle_policy: "observe"` 保留，只禁止模型空闲终止。
