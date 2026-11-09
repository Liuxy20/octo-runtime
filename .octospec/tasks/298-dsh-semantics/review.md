---
type: Review
title: DSH 298 本地自审
description: 对照 brief 和规则检查生命周期、职责、证据与未通过门禁。
tags: [adapter, review, canonical]
---

# 本地自审结论

实现满足本次本地交付范围；没有发现未处置的本任务代码问题。本记录是主执行者自审，不声称独立 reviewer 或 GitHub approval。全量测试仍有六项基线同样失败，真实模型/IM 未验，不能作为合并或发行批准。

| 规则 / 承重路径 | 核查 |
| --- | --- |
| architecture、adapter-metadata | 原生解释只在 DSH adapter；Gateway 只读消费，没有 Core/Gateway 私有 DSH parser、Extra、worker、模型提示协议或产品默认变更 |
| protocol-design、output-protocol | receipt/idle/durable terminal 分开，最终消息最后确认；取消/错误无 final，finish 仍在清理后发布唯一 run 终态；原生字段无虚构 |
| stateless | 单候选 4096 条/rawMessageMaxBytes，原有会话/对象/工具限制保留；不保存整轮历史 |
| message / tool 身份 | messageId 稳定，chunk 与 durable stream 分别校验，提交不重发；工具 call/result 保留身份、stepId、顺序及 duration；未闭合或错误 step 拒绝 |
| lineage / reasoning | child 不进入 final；analysis 保持 private_reasoning；公开卡片中合成私有哨兵不可见 |
| context-input、environment、mcp、reasoning | 仅阅读命中的约束，不改变输入、认证、执行环境、MCP 或 effort |
| engineering、collaboration | 说明/注释中文，提交与 PR 按 CONTRIBUTING 使用英文；手动专项不进入默认测试；无 workflow/job/matrix/trigger/gate 扩大；用户已授权提交、推送和关联 PR，未授权合并或发布 |

修复中处理的自审点：缓冲 flush 的 commentary 不得再次缓冲；last turn 不等于整个活动区间结束；已有 chunks 时仍须核对 durable stream；canonical 消息使用 messageId；tool/result 必须属于原步骤；既有工具 fixture 按原生 commit → tool → next-step 顺序修正，不能放宽协议来使旧夹具通过。

PR 交付前将手动 fixture 的直接运行判断统一为 pathToFileURL，避免编码后的 URL pathname 与含空格/中文的原生路径不相等。Node 24/26 手动专项各 11 项重验通过，另在任务外置 TEMP 的空格/中文路径复制入口并探测版本成功。

关键限制及测试失败全部在 validation.md；没有把 fixture 卡片 HTML 或 replyFinal 端口调用标为 live IM 验收。

# yujiawei 评审复核

针对 [review 5823849154](https://github.com/Mininglamp-OSS/octo-runtime/pull/340#pullrequestreview-5823849154)，按评审所针对的 `3a85e069be20ba996972760e5726c5d4684adef9` 核查，没有复现 P1 所述的成功发布 partial final。评论跟踪了 assistant/message 的 step.answer 赋值，但没有计入同一提交 trajectory.ts 第 225 行在 step/end 构造 pending 时的 `answer: step.answer && !step.interrupted`。直接回放 `interrupted: true` 加 completed turn 的结果为 DSH_NO_FINAL_OUTPUT，final 事件为零。

测试覆盖缺口成立：原 cancelled 用例走 aborted turn，不能代替 completed turn 的组合。仅补手动 trajectory 和官方 SDK→Adapter→Core 两项回归及相应 fixture，不修改生产实现、通用 Gateway、规则、CI 或范围外失败项。Core 用例要求唯一 run.failed、reasonCode=DSH_NO_FINAL_OUTPUT，并拒绝所有 final create/delta/update。

负向验证只临时移除本任务构建 JS 中的既有守卫，两项新增回归均失败；finally 恢复产物后，Node 24/26 各 124 passed / 5 skipped，启用独立 Gateway 的手动专项各 13 passed。该证据证明新增测试能检出评审描述的缺陷，而非通过更改生产语义使断言成立。Gateway 专项需要显式环境变量的观察属实；本轮已显式启用，未扩大默认 CI。

此结论为代码和执行证据的复核，不等同于外部 reviewer 已批准；不自行撤销 CHANGES_REQUESTED。
