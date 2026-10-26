---
type: Task
title: Issue 117/118：准确反馈本轮执行是否已提交
description: 分析会话读取、展示初始化及明确接纳拒绝的失败出口，区分未提交与执行结果未知。
tags: [channel, delivery, session, invocation, stream, testing]
---

# 目标

用户发来普通消息后，应能分清“尚未提交执行”“执行已有明确终态”和“可能已执行但结果无法确认”，据此决定是否重试。当前问题会让用户无故等待，或因错误的未知提示不敢重试；反向误判则可能导致重复业务副作用。

来源：[Issue 117](https://github.com/Mininglamp-OSS/octo-runtime/issues/117)、[Issue 118](https://github.com/Mininglamp-OSS/octo-runtime/issues/118)及其补充评论。分析基线为 2026-10-26 拉取的 `origin/main@8af836068780ebb76581225254ad7bef18cc8170`。用户已授权实施、审查修复及 PR 普通合并；实现与验证证据见[验证记录](validation.md)，原基线调查见[分析](analysis.md)。

日志字段、可信拒绝证据、not_submitted 状态、展示三阶段策略及 M1–M5/V01–V10 见[实施合同](implementation-plan.md)。代码已按固定策略实现；线上验收和托管检查的实际状态单列，不把规划评分作为完成度。

## 产品意图与归属

- 需求属于 Runtime 内置 Channel 的消息反馈与执行状态消费；存储损坏本身由存储实现或宿主处理，Channel 仍须正确结束这条消息。
- 调用方提供普通消息、会话存储、展示接口及共同 KernelClient；本项不改变其任务内容、执行权限或审批模式。
- Channel 负责安全反馈、投递和释放本轮调度状态；KernelClient 负责接纳事实、身份及未知提交结果的判断；ImTask 保留单次尝试的事实。
- Gateway 与 WeCom 的同类失败均纳入后续修复，保留各自平台投递方式。其他 SDK 产品仅消费执行合同，不强制继承 IM 文案或展示策略。

## 关键合同

1. 会话读取在执行前失败时，保留 `IM_SESSION_STORE_FAILED`，通过统一错误投影生成错误卡片和独立文本，明确本轮尚未发起执行；不调用 Provider 或取消不存在的执行。
2. 展示初始化或首次 update 在消费执行 iterator 前抛错时，必须终止本轮并反馈未执行，不降级继续执行。展示方法未提供沿原可选合同处理。执行中的 update 故障按实施合同尽力取消并观察原流，不隐式放行审批。
3. 对有可靠来源和阶段证据的接纳前拒绝，保留受控原因，不能进入 unknown 或取消路径。进入 invoke 包装器、生成 runId、登记 attempt 均不等于提交成功。
4. 已写出但 ACK 不明、真正流丢失和未能确认的其他异常仍保持保守 unknown；按既有共同客户端恢复，不自动重新 invoke。
5. 未提交是单次尝试事实。此前已有执行尝试时，不能由后一次拒绝推断整轮没有执行。
6. 文本反馈不依赖已经失败的 store 或 presentation。投递使用既有有界机制；反馈自身失败时记录受控诊断并收敛，不递归通知或泄露原始异常。
7. 回收工作槽位、队列与活动身份，保持 session/generation 保护。未提交故障不能留下永久去重；已提交及未知调用的防重保护保持有效。
8. 单次任务错误不改变 Bot 连接状态，不触发重连、Kernel 重启或存储重建。

## 统一错误投影与日志（用户已确认）

2026-10-26 用户要求：本任务必须使用统一错误投影和日志链路，并新增统一错误码。以下合同已接入产品目录与双渠道消费路径，实际验证范围见[验证记录](validation.md)。

### 新增公共错误码

统一码注册在 [failure.ts](../../../packages/octo-runtime-protocol/src/failure.ts) 的 `FAILURE_CATALOG`，分类映射、文案、messageKey、retryable 和 action 由同一共享模块维护。不得在 Channel、Adapter 或卡片组件建立另一份错误码或文案映射。实施时重新 fetch 并核对目标 main，以下编号没有既有占用；后续如发生并发分配冲突，须调整全部消费引用，不覆盖既有定义。

| 新增公共码 | 受控 reasonCode | stage | 分类与用户反馈 | retryable / action |
| --- | --- | --- | --- | --- |
| `OH-RUN-2010` | `IM_SESSION_STORE_FAILED` | `channel_session_read` | `channel_session_store`；会话读取失败，尚未发起执行，请检查运行设备或稍后重试 | `true` / `check_runtime` |
| `OH-RUN-2011` | `IM_PRESENTATION_INITIALIZATION_FAILED` | `channel_presentation_initialize` | `channel_presentation_initialization`；状态展示初始化失败，尚未发起执行，请检查运行设备或稍后重试 | `true` / `check_runtime` |
| `OH-RUN-2012` | `CLIENT_INVOCATION_ADMISSION_CLOSED` | `channel_admission` | `channel_invocation_admission`；执行服务当前不接收新任务，本次尝试尚未提交，请稍后重试 | `true` / `retry_later` |

前两项只覆盖当前尝试尚未调用执行时的故障；`OH-RUN-2011` 同时包含 beginPresentation 和首次 update 抛错。第三项只接受真实客户端在本次提交前产生的明确拒绝，不能仅凭同名字符串判断。此前已有尝试时，投影必须按尝试范围表述，不能把表中未提交文案用于概括整轮。未知接纳、丢流和执行后的存储/展示错误不得套用这三个码。`retryable` 只表示允许显式重试，不授权自动重新 invoke。

本任务新增专用公共码，不直接用 `OH-RUN-2008`、`OH-RUN-2002` 或通用 `OH-SYS-9001` 替代。既有公共码继续保留原用途。统一码是 `failure.code`，内部原因是 `failure.reasonCode`；兼容 payload.code 的原语义不变。

### 一份错误对象、三个消费出口

1. Channel 在确认失败阶段后，通过共享 `failurePayload` 创建一次 `FailureEnvelope`。保留 code、reasonCode、stage、source、diagnosticId、occurredAt 及共同目录定义的 action/retryable。
2. Gateway 复用已有 Channel 本地失败的 CanonicalEvent `run.failed` 标准投影，以及 `replyFailure`、`ImRunProjector` 和 `buildReasoningFrame` 链路。此事件只用于本地错误展示，不注入 Kernel/Provider 源流，不创建真实 AgentRun，不伪造执行启动。卡片必须明确“尚未执行”或“本次尝试尚未提交”。
3. 错误卡片与普通文本独立、有界投递；两者展示相同公共码和 diagnosticId。展示初始化已失败时，独立错误投影不得再次调用原 beginPresentation 或首次 update。模板缺失、平台不支持或卡片发送失败时，仍尝试文本并记录实际投递结果，不承诺卡片必达。WeCom 使用同一 FailureEnvelope 和自身回复协议，当前没有独立错误卡片端口时不伪称已发送卡片。
4. 根因错误通过既有 `context.log` / `dependencies.log` → `channel.diagnostic` 结构化链路记录；沿用当前诊断级别 `warn`，不另建文件日志、直接 console 输出或旁路 logger。同一对象的 `failure.code`、reasonCode、stage、diagnosticId、source、occurredAt 必须完整进入对应安全元数据字段，不得只记 IM_* 或 CLIENT_* 原因。已有 endpoint/run/invocation 关联只填实际存在的身份，不为执行前错误伪造 Run。
5. 卡片、文本、attempt 及对应日志必须关联原错误对象。没有 runId 时也由共享 failure 机制生成 diagnosticId；不得在各出口分别创建编号。普通运行日志的白名单须按实施合同补齐；最终 sink 指健康配置下经 worker 写出的普通运行日志，不扩大 statusOutput 或组件状态镜像的任务字段。
6. 不记录或展示原始异常堆栈、凭据、存储路径、聊天正文或完整配置。投递失败属于单独故障，沿现有投递诊断记录并关联原 diagnosticId，不覆盖原始根因、不递归发送错误卡片。

## 范围外

不修复所有存储故障，不新增数据库、持久投递账本、第二套执行 API 或自动重放策略。不将这两个明确反例视为 Issue 93 睡眠恢复问题的生产根因。不扩大为所有 Provider、所有错误码的全面重新分类。

## 验收合同

| 场景 | 可观察的通过条件 |
| --- | --- |
| Gateway / WeCom 的 read 抛错 | 生成 `OH-RUN-2010` 标准错误对象及未执行反馈；invoke=0、cancel=0；保留存储原因 |
| 存储恢复后重发 #117 同一消息 | 可再次正常受理；无残留调度资源或永久去重；不自动重放原消息 |
| 两渠道 beginPresentation 抛错 | invoke=0、cancel=0；投影 `OH-RUN-2011` 未执行反馈，无 unknown 展示 |
| 展示首次 update 抛错 | 同样根据实际调用阶段处理，未提交时不误报未知 |
| 真实 KernelClient stopAdmission | 执行提交与 Provider 调用为零，登记为空；以 `OH-RUN-2012` 关联展示、attempt、文本及日志；不取消 |
| 首次拒绝与重试拒绝 | 前者可说本轮未执行；后者准确说明本次重试未提交，不抹去此前尝试 |
| 已写出但 ACK 不明、先有输出再丢流 | unknown 仍成立；不自动重跑；不因首帧缺失或登记为空改判未执行 |
| 错误文本或错误卡片投递失败 | 有界结束，无递归通知、无 Provider 调用或未处理 rejection；独立文本出口不被卡片失败阻断 |
| 统一码、投影与日志一致性 | 三个公共码分类断言通过；可用卡片和文本中的 code/diagnosticId 与最终日志 sink、attempt 的关联一致；stage/reasonCode/source 保留，无字段被包装层丢弃 |
| 无 Run、无卡片及隐私边界 | 没有 Run 仍有合法 diagnosticId；卡片不可用时文本仍投递；日志不含原始异常、凭据、路径、正文或完整配置 |
| 故障后下一条消息、并发会话与关闭 | 槽位、pending、活动身份正确释放；不污染其他会话和连接状态 |

实施时优先在现有 `failure`、`im-task-channel`、`im-task-retry`、`im-wecom`、`im-session-scheduling` 及 `kernel-invoke-lifecycle` 测试组补合同断言，并验证标准卡片投影及实际日志 sink。此次新增共享错误码属于跨包合同改动，实施后须运行相关回归、lint/typecheck 及完整 `pnpm test`。

真实 IM 验收使用线上测试环境，分别观察失败文本、可用时的错误卡片及正常后续消息；本地 fixture 不能替代真实投递证据。Gateway 因缺少 QA 账号文件路径未验；WeCom 真实平台验收按用户明确指示跳过，双渠道本地故障注入仍覆盖。
