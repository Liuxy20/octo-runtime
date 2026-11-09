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
