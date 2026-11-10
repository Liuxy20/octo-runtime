---
type: Journal
title: Runtime 模型输出静默通知实现与专项复核
description: 复用既有通知外壳并记录真实输出重置、消息身份复用和文档校验修复结论。
tags: [runtime, silence, protocol, review]
---

# 实现结论

canonical 使用既有 run.notice/code=model_output_idle，Runtime连续60秒无新增公开模型文本后通知一次；真实输出恢复后重新计满60秒。JSON-RPC外壳仍为agent_run.event notification，无顶层id；内部noticeId与请求ID无关。native无新增类型，旧预算不改变，Gateway仅建issue #34待迁移。

按用户要求并行审查计时、协议删除闭包、文档质量。两项计时P2（第257消息不刷新、匿名消息混算）移除第二套消息缓存后修复，统一复用Core准备后的消息身份与公开性。文档检查器误按Request校验通知的P2修复为既有EventNotification；两项文档歧义一并修正。另追加P1背压专项：源终态/错误已到达却被旧首帧预算覆盖，已将watchdog事实更新移到源next就绪处，并区分源异常与协议校验失败。独立8场景复核通过，三组Agent最终无未关闭发现。

复用现有身份比再建简化缓存更可靠；状态补丁和回退快照不降低已见长度。源端next就绪就更新静默事实，notice不能丢弃在途next或并发拉取。规则已回写[输出合同](../../rules/output-protocol.md)。

实际本地Kernel/client完成两段60秒、重放和恢复计时；全量1404通过/61既有跳过，双包校验及临时lint通过。详细命令、证据与未验边界见[验证](../../tasks/runtime-model-output-idle/validation.md)及[审查](../../tasks/runtime-model-output-idle/review.md)。未扩大CI、未提交或发布。
