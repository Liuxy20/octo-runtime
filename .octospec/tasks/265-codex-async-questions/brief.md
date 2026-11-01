---
type: Task
title: Issue 265：异步 ask 是会话旁路补充信息
description: 活动 Run 通过 steer 接收补充，正常结束后通过同一问题启动新 AgentRun，问题不阻塞执行。
tags: [protocol, interaction, adapter, invocation, testing]
---

# 产品意图与授权

异步 ask 是额外信息的旁路，用户可以不填，原任务照常执行和完成。填写时仍在运行则 steer；已经正常完成则在同一业务会话、同一 Provider 会话开启新的 AgentRun，携带原题和答案继续。用户不需判断执行状态、不需改发普通聊天消息。

本规格替代 [首版](brief-v1.md) 中“Run 完成即问题失效”“禁止新 Run”的限制。来源为当前会话“按照我的最新的这个旁路ask的意图。写清楚spec 然后继续实现 +codereview”，授权连续修改规格、实现和本地审查；沿用提交/推送/更新 PR 授权，不合并，不扩大 CI。

基线 `59bed1986c66657f5a7318acbb51d361d914cbf3`；分支 `fix/265-codex-async-questions`；[Issue #265](https://github.com/Mininglamp-OSS/octo-runtime/issues/265)、[PR #280](https://github.com/Mininglamp-OSS/octo-runtime/pull/280)。历史实测不作为新合同已通过的依据。

交付前同步 main `28c3ffa2ef685e14ac58d57c2788c9d07b92471c`，保留配置快照与自动审批 responseRequired 合同；旁路 ask 的用户意图不变。

## 责任与公共入口

拓扑维持原生宿主 → 公共 Kernel SDK → Kernel IPC → 内部 worker → 唯一 Core → Adapter。不新增服务、Provider 代理或 Runtime 数据库。

- Adapter 保留原生问题，只向原活动 thread/turn steer。同步响应、审批、full_access、native 模式保持。
- 公共 `/executor-kernel` 提供 `AsyncQuestionReply`：持有原请求、原 RunRef 和宿主提供的 continuation input，统一决定 steer / new_run。新 Run 复用唯一 `KernelClient.invoke`，沿用登记、signal、尾流、排空；不复制 submit/subscribe 实现。
- 宿主拥有问题、会话和保存策略，负责保存回复状态、generation/provider binding、同一会话提交串行、新 Run 消费/取消/业务收尾。一个问题只有一个控制者；不承诺多客户端和宿主数据库之间恰好一次。
- continuation input 显式携带当前业务 sessionId/generation、可恢复 providerSession、Context、配置与环境。SDK 校验同会话，生成新 runId/invocationId，替换输入为原题答案；不复制旧用户输入/图片或猜 Provider 私有参数。恢复失败如实报告，不能宣称已恢复同一 Provider 会话。
- 直接 Core 用户可按同一合同调用现有 respondInteraction/invoke，不绕过 Core 终态限制。Work App UI 和子模块升级在宿主仓库。内置 channel-gateway、channel-wecom 与 webui 忽略 async 控制，不暂停、不新增表单或续跑。在交互登记、提示与状态投影前成对过滤 async requested/resolved，保留消息正文及旧同步问答/审批。WebUI 忽略控制时仍推进源事件游标，保证后续正文、终态和重连序号连续。

## 结构与非阻塞

保留首版消息 delivery/questions、原生 messageId、由 invocation/thread/turn/message 元组派生的稳定 interactionId、q:0 起的位置题号、多问题、null/空选项、allowCustom=true、completed 去重与冲突检测。只从结构注册，不解析 Markdown。公开请求和响应仍为 octo.question-request/v1 与 octo.question-response/v1。

每批一次，每题一个文本，选择/自定义同字段。漏题、重复/未知题号、空白、非 Unicode scalar 或超过 4096 码点在写入前拒绝；按原题顺序 JSON 编码，冻结原题防止 UI 修改关联。

不填不暂停、不生成 waiting_input、不豁免真实执行超时。async final_answer 不是执行收尾，不能启动 finalization timer；普通最终回答的保护保留。

旁路问题默认无到期时间，不随原 Run 正常完成失效；async 的 expiresAt 可省略，同步仍必须提供。显式期限到期后拒绝投递。取消只关闭问题，不取消 Run。宿主会话重置、Provider 更换、generation 改变使旧问题 stale，不得投到新会话。

Adapter 上限沿用 16 个在途交互、每批 50 题/50 选项、4096 码点、每 invocation 1024 去重批次；终态释放所有 Adapter Map/timer/子进程，不等待人填写。跨 Run 表单由宿主持有，不新增 Runtime 持久化。

## 路由与生命周期

`AsyncQuestionReply.respond(value)` 先校验整批答案，原子锁为 submitting，拒绝重复/并发提交和取消。本地校验失败可修改；投递后不自动重试。

| 事实 | 行为 |
| --- | --- |
| 原 Run 活动 | client.respond 原 ref，向原 turn 一次 steer；匹配 Provider ACK 后返回 route=steer/provider_accepted |
| 原 Run 正常 completed | 同一问题转为新 AgentRun，生成独立执行身份，原 Run 的身份/终态不变 |
| steer 明确未接纳，重新查询确认原 Run 正常完成 | 可转 new_run；不以错误文案猜测完成 |
| steer 已发出但接纳未知，包括终态竞态 | outcome_unknown，不重试、不转新 Run、不显示送达 |
| failed/cancelled/lost 或无可信终态证据 | 拒绝，不自动重跑失败任务 |
| 已答/取消/显式到期/会话变化 | 拒绝，不创建 Run |

new_run 返回执行流，route 只是路由选择，不能视为 Provider 接纳；开始消费才通过原 invoke 提交。未消费无执行。Kernel receipt、Provider 接纳、模型使用答案、执行完成分别确认；宿主负责消费尾流及取消，关闭观察不取消已接纳 Run。

原 Run 正常完成时，未提交问题从 Adapter 释放但不发 invalidated。提交中尚未确认的回答仍为 unknown；失败/取消/丢失则 invalidated。旧低层 respond 仍拒绝终态后响应，晚答使用旁路入口。

helper 可输出供宿主保存的 JSON snapshot：原请求/ref、正常完成证据、提交状态。源窗口消失或 Kernel 重启后，只允许有可信 completed 证据且 pending 的记录转新 Run；仅 running/查询失败不能猜完成，submitting/unknown/answered 不得恢复投递。宿主必须单控制者、原子保存状态，SDK 不承诺崩溃跨数据库恰好一次。

## 验收

所有新增专项显式运行 test/manual，不扩默认 glob、package scripts、GitHub workflow/job/matrix/trigger/required checks/CI Gate。

1. 保留首版结构、校验、同步/审批/full_access、Core 非等待与 Gateway 忽略回归。
2. async final_answer 后超过 finalization deadline 仍正常完成、无 interrupt；普通 final_answer 超时保护仍生效。
3. 公开 Kernel 验证活动 steer、完成后同题启动独立新 Run、同业务/Provider 会话，原题和选择/自定义答案实际到达。
4. 重复/并发、取消、可选到期、stale generation、无终态证据、明确拒绝、未知结果及终态竞态；未知绝不创建新 Run。
5. 完成后的 snapshot 保存/恢复及 Kernel 重启可新 Run；running/unknown snapshot 不可猜测恢复。
6. 真实 Codex Default non-gating 验证 steer 和晚答新 Run，分别记录 Provider 接纳、模型使用、源码 SHA/dirty、CLI/平台、终态与清理。
7. 构建、类型、lint、format、文档、既有跨包测试、native 生成一致性按影响执行。Standards/Spec 两个独立 code-review，修复确认缺陷并记录 validation.md/review.md 与 journal。

产品决定已由本次指令确认，不再等待规格批准；真实 Provider 能力按实际验证记录。
