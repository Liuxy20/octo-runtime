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
import { InvokeInput } from "@mininglamp-oss/octo-runtime/protocol";

const input = InvokeInput.check({
  inputs: [{ type: "text", text: "Summarize the last commit." }],
  contexts: {
    schema: "octo.context-envelope/v3",
    items: [{ namespace: "octo.execution", name: "adapter", payload: { type: "dsh" } }]
  }
});
```

`check` 在形状不合法或负载超限时抛错，否则原样返回。它不调用任何东西，也不生成任何 ID：`invocationId`、`runId`、`sessionId` 由 Core 或 Kernel 在你省略时补齐，需要取消或对账就保存返回的对象。

## 真正要关心的字段

| 字段                                 | 必填 | 作用                                                                                    |
| ------------------------------------ | ---- | --------------------------------------------------------------------------------------- |
| `inputs`                             | 是   | 本轮按顺序排列的文本与图片分片，图片字节只放这里一次。                                  |
| `contexts`                           | 是   | Context v3 envelope，其中 `octo.execution` / `adapter` 项决定用哪个 Adapter；为空合法。 |
| `workdir`                            | 否   | Provider 工作目录，默认取宿主工作区；它不是沙箱。                                       |
| `protocol_mode`                      | 否   | `native`（默认）或 `canonical`。                                                        |
| `providerSession`                    | 否   | 显式续接的 Provider 会话，绝不会从 `sessionId` 反推重建。                               |
| `agentConfig`                        | 否   | 完整 Provider 配置，含 `providerOptions`，须与 Context 中的选择一致。                   |
| `runtimeLimits`                      | 否   | 本轮的超时与执行约束；省略时套用执行默认值。                                            |
| `sessionId`、`invocationId`、`runId` | 否   | 关联标识，省略时自动生成。不是 Provider 历史。                                          |

只有 `inputs` 和 `contexts` 是必填。但缺少 `octo.execution` / `adapter` 项的请求会在 Provider 启动前就失败。

## 怎么读输出

同一条流有两种视图：

- `native`（默认）—— `HostFrame`：Provider 原始负载外加 Runtime 控制帧。
- `canonical` —— `CanonicalEvent`：跨 Provider 归一化后的事件，多数应用要的是这个。

native 模式下的终态是 `type: "state"` 的 `control` 帧。

## CanonicalEvent 类型

Adapter 负责把各家 Provider 的事件翻译成这一套，Provider 私有的名称不会漏到这一层。每条 canonical event 都是 `{ protocolVersion: 2, type, payload }`；下表按生命周期排列 24 种类型，payload 列只列你会真正读的字段，不是完整 schema。

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
| `run.notice`            | notice      | 重试、上下文压缩、改道、配置告警           | `noticeId`、`code`、`severity`、`params`                                                      |
| `interaction.requested` | interaction | 需要审批、回答或补充输入                   | `interactionId`、`kind`、`expiresAt`、`request`                                               |
| `interaction.resolved`  | interaction | 已处理、已过期或已失效                     | `interactionId`、`status`、`outcome`、`reasonCode`                                            |
| `session.update`        | state       | Provider 会话信息变化                      | `providerSession`                                                                             |
| `execution.update`      | state       | 执行模式证据，例如 actmode                 | `actmode`                                                                                     |
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

这是 private workspace 包：源码和子模块宿主从 `@mininglamp-oss/octo-runtime-protocol` 导入。发行版使用者走 `@mininglamp-oss/octo-runtime/protocol`，该门面只暴露子集，不是所有 workspace 导出都能在那里用到。

[protocol.schema.json](schema/protocol.schema.json) 是 wire 层的唯一事实来源。[gen-types.mjs](scripts/gen-types.mjs) 生成 [protocol-types.ts](src/generated/protocol-types.ts)：改 schema，重新生成，不要手改生成结果。

```sh
pnpm --filter @mininglamp-oss/octo-runtime-protocol gen
pnpm --filter @mininglamp-oss/octo-runtime-protocol build
```

## 延伸阅读

- [InvokeInput](src/invoke-input.ts)、[workspace 导出](src/index.ts)、[生成类型](src/generated/protocol-types.ts)。
- [输入参考](../../docs/zh-CN/reference/invoke-input.md)、[输出与控制](../../docs/zh-CN/reference/output-and-control.md)、[Kernel IPC](../../docs/zh-CN/reference/kernel-ipc.md)。
- [协议测试](test/run-protocol.test.js)。
