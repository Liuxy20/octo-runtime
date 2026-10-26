---
type: Task
title: Issue 117/118 目标与合理性分析
description: 基于最新主线核对双渠道失败出口，给出用户可见效果、修复归属及安全分类边界。
tags: [channel, delivery, session, invocation, stream]
---

# 结论

本文件保留实施前的基线调查与建议，下文“当前”和“未实施”均指分析时的 `8af8360`。后续用户已授权实现；最新状态以[验证记录](validation.md)为准。

两个 issue 的目标合理，建议作为同一个“准确反馈执行事实”专题处理，保留各自验收。#117 补齐执行前失败的反馈，#118 修正执行前失败被当作执行未知的分类。真正需要交付的是可信的状态与下一步提示，修改文案本身不足以完成修复。

2026-10-26 用户进一步确认：必须复用统一错误投影及日志链路，并新增统一错误码。三类故障规划为 `OH-RUN-2010` / `2011` / `2012`，卡片、文本与结构化日志共用同一错误对象和诊断编号；完整映射与验收以[简报](brief.md#统一错误投影与日志用户已确认)为准。此前仅补文本或直接复用通用存储/维护码的建议，由此项要求替代；产品目录尚未实施新增。

本轮基于 `main@8af836068780ebb76581225254ad7bef18cc8170` 做源码分析，已读取 issue 正文及补充评论。以下“现状”是当前调用链核对结果；旧评论中的 macOS/Windows 复现和测试数量属于历史证据，本轮未重跑。

## 用户希望看到什么

| 实际情况 | 当前问题 | 建议效果 |
| --- | --- | --- |
| #117 会话存储读取失败 | 两渠道只记诊断，普通用户收不到回复 | “本轮会话读取失败，尚未发起执行。请稍后重试。” |
| #118 展示初始化抛错 | Gateway 报未知并尝试取消；WeCom 只记任务失败而无文本 | 必须终止本轮：“本轮状态展示初始化失败，尚未发起执行。请稍后重试。” |
| #118 客户端明确停止接纳 | 当前路径报未知；Gateway attempt 也被标 unknown | “执行服务当前不接收新任务，本轮尚未提交。请稍后重试。” |
| 已提交但 ACK 不明，或执行流真正丢失 | 此时保守未知是正确处理 | 保留“结果未知，请先核查，避免重复执行”，不自动重跑 |
| 收到真实执行终态 | 应按真实 completed/failed/cancelled 处理 | 保留既有终态与投递合同，不用后续展示或存储错误改写执行事实 |

以上是待实施的文案建议，不代表已经更改或验收。未提交可重试的含义是用户可在故障排除后明确重试；不是要求在同一故障上自动循环重发，也不承诺关闭中的服务仍接受新消息。

## 当前源码依据

下表行号固定于分析基线，路径均为当前实际文件。

| 位置 | 已核对的事实 |
| --- | --- |
| [Gateway im-channel.ts](../../../packages/octo-runtime-extra-channel-gateway/src/application/im-channel.ts)，#receive 约 397–478，#session 约 480–492 | 先写 seen，再读取 store；catch 删除 seen 并记 `IM_SESSION_STORE_FAILED`，没有回复。本轮还未进入执行 |
| [WeCom im-channel.ts](../../../packages/octo-runtime-extra-channel-wecom/src/application/im-channel.ts)，约 255–318 | 同样存在 read 失败只记诊断的出口，故 #117 不能仅修 Gateway |
| Gateway im-channel.ts，约 995–1117 | beginPresentation 和首次 update 早于消费 task.events，却与消费共用 try；catch 在没有终态时一律 cancel、记 unknown |
| [ImTask](../../../packages/octo-runtime-extra-channel-gateway/src/execution/task.ts)，约 217–267 | onAttempt 和 running 记录在 kernel.invoke 消费之前，异常统一把 attempt 标 unknown；只是改 Channel 文本会留下不一致状态 |
| WeCom im-channel.ts，约 520–527、578–586、608–614 | 展示初始化与首次 update 位于执行 try 外，抛错直接进入队列 catch；执行 try 内的异常又统一落到 unknown。两渠道的展示故障结果不同 |
| [KernelClient](../../../packages/octo-runtime-executor-kernel/src/client.ts)，约 171–189 | registry.begin 先于 submit；不是进入 invoke 就已经发 IPC 请求 |
| [InvocationRegistry](../../../packages/octo-runtime-executor-kernel/src/invocation-lifecycle.ts)，约 59–82 | begin 首先检查接纳开关；stopAdmission 下的 `CLIENT_INVOCATION_ADMISSION_CLOSED` 在登记及提交前产生 |
| KernelClient，约 345–419；InvocationRegistry，约 115–132 | 已有 submitted、明确拒绝与 acceptance_unknown 的事实；发送后 ACK 修复只查询原身份，不重新 invoke |

这说明需求仍有当前源码依据，但本轮没有构建和执行反例，不能把静态核对写成在新 SHA 上完成了动态复现。

## 为什么合理、边界在哪里

1. 用户需要知道任务是否开始，才有依据等待、修复配置或重试。这是 Channel 自身的反馈责任，不要求 Runtime 修好宿主数据库。
2. 保守 unknown 用于真实不确定性。对确知没提交的异常也报 unknown，会失去这个提示的实际意义，并阻止正常恢复。
3. #117 在双渠道接收边界构造统一错误对象，经标准投影和既有日志链路消费；Gateway 独立错误卡片与文本分别投递，WeCom 按自身协议反馈。错误出口不能再调用失败的 store。存储工厂创建期失败属于 #57 的独立合同。
4. #118 应区分本地准备、展示初始化、调用接纳及执行观察阶段。Channel 解释已有可靠事实；接纳事实不足时由 KernelClient 边界提供，Channel 不复制 submit/subscribe 流程。
5. 不应凭“没看到输出”、任意 error.message、统一 socket 错误或登记已删除推断未执行。错误码的来源和发生阶段必须可靠；只有明确证明未提交的窄分类才能进入该出口，其他异常保持保守。
6. 本次固定展示初始化和首次 update 在执行前抛错就结束本轮。执行中 update 故障尽力请求停止并消费原流，按真实结果收尾；不得因卡片失败把审批视为通过。具体策略见[实施合同](implementation-plan.md#展示失败的固定策略)。
7. 对单次尝试的未提交结论不能覆盖此前尝试。比如第一次已经产生 partial 并以真实失败终态结束，第二次接纳被拒，用户应看到“重试未提交”，仍可核查第一次的结果。
8. 展示对象未提供原本就是可选合同，不应因为修复“方法抛错”而强制所有接入方必须提供卡片。

## 建议实施顺序

- 先在共享 `FAILURE_CATALOG` 注册三个专用码，补精确分类及安全文案，明确 reasonCode、stage、action 与显式重试语义。
- 完成 #117 的双渠道反馈与资源释放，覆盖反馈发送失败、存储恢复后原消息重试。
- 再完成 #118 的展示前置失败分支及明确接纳拒绝分类，同步 ImTask attempt、日志和最终文本；只引入本项需要的最小受控分类。
- 验证同一 FailureEnvelope 经标准投影和现有结构化日志链路消费，断言卡片、文本和最终日志 sink 的统一码及诊断编号一致。
- 同组保留 ACK 不明、流丢失、首帧前失败及多次尝试对照，防止为消除误报而扩大重放权限。
- 最后做真实 IM 投递验收。Gateway 复用现有标准失败投影；错误卡片失败不能阻止安全文本。WeCom 按其回复协议验证，不强行复制 Gateway 卡片实现。

无需将目标扩大为通用错误平台、存储重试框架或全套状态机重写。具体后续验收见[任务简报](brief.md)和[实施合同](implementation-plan.md)。此前可执行性自评为 92/100；本轮补齐日志字段与白名单位置、可信拒绝证据、attempt/收尾分类和展示策略后，规划准备度自评为 98/100。该分数是工程判断，不是测试通过率或产品完成度；代码和真实环境验证仍未执行。
