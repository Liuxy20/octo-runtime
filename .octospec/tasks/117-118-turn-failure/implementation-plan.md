---
type: Task
title: Issue 117/118 实施合同与验证步骤
description: 固定日志字段、接纳前拒绝证据、单次尝试状态及展示失败策略，供后续直接实施。
tags: [channel, delivery, session, invocation, stream, testing]
---

# 状态与范围

本文件是用户授权实施的合同，基线为 `8af836068780ebb76581225254ad7bef18cc8170`。M1–M4 已实现，M5 的本地验证和线上限制见[验证记录](validation.md)。公共码定义以[简报](brief.md#新增公共错误码)为准；本文件固定实现选择和验收标准。

## 日志字段与消费边界

双渠道通过既有 `dependencies.log` / `context.log`，以 `warn` 级别记录 `channel.diagnostic`。创建一次 FailureEnvelope，再按下表映射到现有日志的 data；不得把嵌套 envelope、原始异常或完整 source 对象直接交给任意序列化器。

| FailureEnvelope 来源 | 普通运行日志字段 | 校验与语义 |
| --- | --- | --- |
| failure.code | `code` | 共享目录中的公共码，三类新故障分别为 OH-RUN-2010/2011/2012 |
| failure.reasonCode | `reason_code` | 受控内部原因；原有未带 envelope 的诊断仍按原合同记录，不批量迁移 |
| failure.diagnosticId | `diagnostic_id` | 必须匹配共享诊断格式 `diag_` 加 32 位小写十六进制字符 |
| failure.stage | `stage` | 本任务只允许简报列出的三个阶段 |
| failure.source.component | `failure_component` | 只允许共享 FailureSource 的 component 枚举值，不覆盖日志顶层 source=extra |
| failure.source.adapter（若存在） | `adapter_type` | 沿用既有安全字段及校验；执行前不知道 Adapter 时省略 |
| failure.occurredAt | `occurred_at` | 合法 UTC ISO 8601 时间；与日志顶层 time 区分，前者是故障时间，后者是日志写入时间 |
| 原本已分配的身份（若存在） | `endpoint_id`、`run_id`、`invocation_id`、`session_id` | 沿既有身份校验；没有则省略，不为显示错误新建执行身份 |

修改位置及要求：

- 两渠道的 `application/im-channel.ts`：扩展原诊断入口，使其可消费本次错误对象；保留内部 onDiagnostic 原因码语义。根因只生成一次 envelope 和诊断编号，卡片、文本、attempt 及日志传递同一对象或其安全字段。
- [runtime-log.ts](../../../packages/octo-runtime-adapter-sdk/src/runtime-log.ts)：在现有普通日志字段白名单补入 diagnostic_id、stage、failure_component、occurred_at，并对新增字段做上述专用校验；code/reason_code/adapter_type 沿用已有字段。禁止放开任意对象或任意字段通过。
- [service-status.ts](../../../packages/octo-runtime-adapter-sdk/src/service-status.ts)：保持当前过滤合同；本任务诊断不进入 statusOutput，也不进入 `*-status-*.log`。不将任务错误变成连接/组件状态错误，不扩大状态日志白名单。
- [runtime-log-worker.ts](../../../packages/octo-runtime-adapter-sdk/src/runtime-log-worker.ts)：沿用原写入、轮转及关闭链路，不增加第二个日志文件体系。实现时核对经过 worker 后的最终普通日志文件，而不只断言注入 log 函数的参数。

普通运行日志仍是可选、有界、允许丢弃的诊断输出。未配置 logging、队列满或写盘失败时，不改变执行结论，也不无限重试写盘。字段完整性的文件验收使用可写临时目录、容量未耗尽和正常 close；不能由此承诺生产日志必达。

错误文本/卡片的投递失败沿现有投递错误码记录，使用相同 `diagnostic_id` 关联根因，并将原公共码写入已有 `primary_code`。它不替换根因日志，不触发递归错误通知。

## 接纳前拒绝的可靠证据

本任务只新增一种可识别的 Kernel 未提交原因：客户端本地停止接纳产生的 `CLIENT_INVOCATION_ADMISSION_CLOSED`。其他调用错误保持原有保守处理，不因本项改造统一扩大为未提交。

1. Kernel 包内部增加一个共享模块，持有私有 WeakSet 和本地错误标记函数；只允许包内部的接纳检查调用标记函数。
2. `InvocationRegistry.assertSubmission()` 在本地停止接纳时，创建原 KernelError 并登记到 WeakSet。begin 的入口检查与 client.submit 的写出前检查共用此入口。标记只证明本次 invoke 请求尚未写出，不表示没有进行过 status 查询。
3. Kernel 包公开只读判断函数 `isInvocationNotSubmitted(error: unknown): boolean`，从包入口及主包 `/executor-kernel` 导出；判断同时要求本地 WeakSet 成员和上述原因码。标记构造函数不公开，不新增 IPC 字段、提交 API 或第二套 invoke。
4. `client.ts` 保留原错误对象向上传递。RPC 响应重建的 KernelError、普通 Error、带相同 message/code 的对象、手工 new KernelError 均不获得标记。若错误被包装或来自另一个模块实例、来源无法确认，判断返回 false，保守归入未知。
5. ImTask、Gateway 和 WeCom 使用同一公开判断函数；不得分别维护错误字符串名单。共享 failure 分类器负责把已验证原因转换为 OH-RUN-2012，但公共码本身不能作为“确定未提交”的事实证据。

前两类本地故障使用各自同步调用阶段作为证据：store.read 失败在执行入口之前；beginPresentation 与首次 update 在消费执行 iterator 之前。read 的 catch 只包围对应存储操作，不能将 catch 范围内任意排队或控制错误归类为读取失败。

## 单次尝试状态与清理

为 Gateway 的 ImTaskAttempt.outcome 增加明确值 `not_submitted`。它是业务尝试状态，不是 Provider canonical 终态，不改变 Run 协议或 Kernel 的真实终态。

| 发生点 | attempt 记录 | 后续动作 |
| --- | --- | --- |
| store.read 失败，或执行前展示失败 | 不创建 attempt；已存在的准备身份不表示执行已发起 | 错误投影和日志后回收本轮；invoke=0、cancel=0 |
| ImTask 已进入本次 invoke，收到可信本地接纳拒绝 | 本次 outcome=`not_submitted`，failureCode=OH-RUN-2012，diagnosticId 与错误对象一致 | 停止本轮后续尝试，向 Channel 传递同一分类结果；不发取消，不落 unknown |
| 得到真实 completed/failed/cancelled，且原流正常耗尽 | 保持既有 run.completed/run.failed/run.cancelled | 保留真实执行结果及已有重试合同 |
| 写出后 ACK 不明、丢流、缺终态或终态后源错误 | outcome=`unknown` | 保留未知处理及原身份恢复；不得自动重新 invoke |

ImTask 内部的 active.finished 从“仅是否确认终态”的布尔含义改为明确的完成分类：`terminal_confirmed`、`not_submitted`、`unresolved`。它只用于业务消费者和 drain 的收尾判断，不发布为新的执行协议。可信本地拒绝允许无执行清理；`not_submitted` 不伪造真实终态，也不作为普通 `INVOCATION_NOT_TRACKED` 的通用成功理由。

drain、超时 timer 和错误 catch 共用该分类：已确认未提交后不得再调用取消；实际未知继续遵守原截止和失败合同。停止接纳与写出交错时，只有写出前检查产生的可信错误能走未提交出口；已经写出的调用保持原 ACK 查询及取消策略。

Channel 收到分类后，以一次失败对象完成展示、文本和根因日志；不再继续落入无终态的默认 unknown 分支。记录 agent_run.finished 的路径对本次未提交使用 status=`not_submitted`，该日志是调用尝试记录，不声称 Provider 已启动。

此前已经执行过的 attempts 原样保留。只有全部尝试均未提交时才可描述整轮未执行；已有真实执行尝试时，文本及卡片使用“本次重试未提交”，并保留原尝试可核查信息。

收尾必须移除当前任务映射、preparing、activeInvocationId、当前交互引用及 queuedOccurrences，并在独立通知投递结束或达到既有截止后释放 pending/working；旧代次不得覆盖新 binding。#117 删除本次 seen，存储恢复后原消息可再次受理。#118 保留已有有界 occurrence 防重，不自动重放原 messageId；显式重新发送使用新消息身份，旧消息重复通知不得再声称“已经提交执行”。本项不新增卡片重试按钮，也不单凭 retryable=true 打开原 controls.failed 的执行重试入口。

两渠道的 `application/session-store.ts` 为 occurrence 增加可选 `notSubmittedFailure?: FailureEnvelope`，仅在本轮没有任何已执行或未知尝试时保存同一安全错误对象；Gateway 的重试拒绝仍由已有 attempts 保留单次事实，不写入该整轮标记。重复消息先检查正文身份冲突，再根据该字段反馈“原消息尚未提交”及原 code/diagnosticId；没有该字段的旧记录沿原合同处理，不推测其执行状态。存储读写、独立快照和宿主序列化须保留此可选字段，不增加删除接口或新存储；字段写入失败记存储诊断并回收本轮，禁止因此重放执行。

## 展示失败的固定策略

本次采用以下唯一策略，删除“展示失败后是否继续”的临时选择。展示方法未提供继续沿原可选合同执行，不等于展示调用失败。

| 阶段 | 固定处理 | 执行结论与错误使用 |
| --- | --- | --- |
| beginPresentation 抛错 | 立即结束本轮，不进入执行迭代；独立错误投影＋文本＋日志 | OH-RUN-2011，明确未执行；invoke=0、cancel=0 |
| 首次 update 抛错，尚未消费执行 iterator | 同上；标记原展示不可用，不再次调用原 begin/update | OH-RUN-2011，明确未执行；invoke=0、cancel=0 |
| invoke 已消费、仍无真实终态时 update 抛错 | 禁用后续进度 update，记录既有 IM_PRESENTATION_FAILED；尽力请求停止当前调用，并继续消费同一原流 | 不使用 OH-RUN-2011，不据此断言未执行；有真实终态则保留，无可确认终态则 unknown |
| projector 已收到真实终态后 update 抛错 | 禁用后续 update，记录展示错误，继续耗尽原流和最终文本 | 仅展示失败不改写真实终态；若原源流随后抛错仍按未知规则处理 |
| finish 抛错 | 原 finish 在共同截止内只尝试一次，记录既有展示收尾错误，继续独立最终文本 | 不覆盖执行事实；关闭时保留既有 incomplete 合同 |

执行中的展示故障不增加新的等待预算，不通过重新 subscribe 或重新 invoke 寻找终态。请求取消的 ACK 不是终态。等待、耗尽和关闭沿原任务 deadline 与共同关闭截止；未确认必须如实 unknown/incomplete。

禁用进度卡后仍使用已有标准交互文本入口；不自动同意审批、不把用户回答改成新任务，不通过普通聊天收集秘密。现有交互发送也失败时，保留失败和取消请求，不以无法显示为由继续无审批执行。独立错误投递与原执行 presentation 分开，不能反复调用已经抛错的方法。

## 实施位置与步骤

| 步骤 | 代码位置 | 实施内容 |
| --- | --- | --- |
| M1 | protocol/src/failure.ts；test/failure.test.js | 注册三个公共码及分类，固定 messageKey/action/retryable；同名未知错误不得误用未提交分类 |
| M2 | executor-kernel 的本地错误模块、invocation-lifecycle.ts、client.ts、index.ts；主包 public/executor-kernel.ts | 标记本地拒绝、公开只读判断函数并保留对象，不改变 IPC/Run schema |
| M3 | Gateway contracts.ts、execution/task.ts；双渠道 application/im-channel.ts、application/session-store.ts 及宿主 occurrence 序列化 | 固定 not_submitted 与内部收尾分类；隔离展示阶段；复用标准错误投影，清理及独立投递；保存兼容的未提交去重事实 |
| M4 | adapter-sdk/src/runtime-log.ts；双渠道诊断入口 | 增加专用安全字段并验证普通日志；组件状态过滤保持原合同 |
| M5 | 相关测试组、真实测试环境、OctoSpec journal | 验证以下矩阵；记录本地与真实结果，更新规则中的待实施状态 |

## 验证矩阵

| 编号 | 回归入口 | 必须断言的结果 |
| --- | --- | --- |
| V01 | failure.test.js | 三码、reasonCode、stage、action/retryable 正确；unknown 不误用；公共文案无原始异常 |
| V02 | kernel-invoke-lifecycle / kernel-invoke-consumers | 真实 stopAdmission 的初次拒绝有标记且无 invoke 写出；登记后写出前关闭也有标记、正常释放；手工/RPC 同名错误不带标记 |
| V03 | 同上 | 写出后 ACK 丢失、实例变化、无首帧及源流错误不获标记；保持原查询和 unknown，不重复 invoke |
| V04 | im-task-retry / im-task-channel | not_submitted 的 failureCode/diagnosticId 一致；无自动重试/取消；第二次拒绝保留第一次真实记录；与 drain/timer 交错仍正确 |
| V05 | im-task-channel / im-wecom | 两渠道初始化和首次 update 抛错：invoke=0、cancel=0；未提供展示方法时正常执行 |
| V06 | 同上 | 执行中 update 抛错后只禁用进度、尽力取消并读原流；真实终态保留；原流失败仍未知；finish 错误不抑制最终文本 |
| V07 | im-session-scheduling / gateway-host-session-store | 两渠道 read 故障、发送失败后资源释放；#117 原消息在存储恢复后可重试；#118 未提交字段经存储往返不丢失，旧记录兼容，重试拒绝不覆盖既往执行；重复消息保留未提交事实，新消息可受理 |
| V08 | runtime-logging.test.js | 健康临时目录运行实际 RuntimeLogging、正常 close，读取 worker 写出的普通日志文件，核对 code/reason_code/stage/diagnostic_id/source 映射及 occurred_at |
| V09 | extra-status-logs.test.js | 同次任务诊断不进入 statusOutput 和状态镜像；连接状态不变；现有组件异常事件仍按原合同输出 |
| V10 | 投影/投递与真实 IM | 本地投影断言及线上测试环境卡片回读：卡片、独立文本、普通日志诊断编号一致；卡片不可用时仍尝试文本，不重复通知；WeCom 真实结果单列 |

执行顺序为构建、相关 Node 测试、lint/typecheck、完整 pnpm test 及真实环境验收。构建会清理 dist，禁止与依赖 dist 的 lint、文档示例或测试并发。真实接口遵守仓库测试环境合同，凭据不进入文档与产物。V 项实际证据见[验证记录](validation.md)，不能把文档检查计作产品通过。
