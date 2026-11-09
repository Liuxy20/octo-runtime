---
type: Journal
title: DSH 公开进度与终局映射
description: 基于原生生命周期延迟分类，验证拆仓后真实消费者而不恢复旧模块。
tags: [adapter, canonical, stream, octospec-learning]
---

# 改动与经验

Issue #298 的问题在 #329 拆仓后仍适用于受支持 DSH adapter。旧 Gateway 路径已删除，但独立 Gateway 继续消费相同 canonical；修复应位于最先失真的 Provider adapter。

DSH 的 assistant/message commit 早于工具执行。sessionId 只证明 lineage，不能证明 message 是终局；单个 turn/end 也不能证明活动结束。保留一个有界候选、等工具/后续步骤或最终 receipt+terminal+idle 证据确认后再发布固定通道，比先发 final 再改分类更容易保证消费一致。

本地回放证实问题不只影响标题：旧 ImRuntime 的最终正文会混入工具前公开说明。修复后工具/步骤时间保持，replyFinal 端口只收到一次纯最终回复。新增专项显式手动；Node 24/26 各 122 passed / 5 skipped，真实 DSH 握手通过但无模型/IM验收；全量及六项基线失败详见任务 validation。

# 规则回流

已在 output-protocol.md 增补 DSH 的证据分类、身份、缓冲和 child/private 边界，精确原生合同及可用性限制记录在任务 native-mapping.md。没有新增通用产品策略或 CI 门禁。

交付按用户追加授权提交、推送并向 main 创建关联 #298 的 PR；保留全量失败与真实模型/IM 未验边界，不自动合并、关闭 Issue 或发布。
