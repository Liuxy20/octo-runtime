---
type: Review
title: Antigravity 代理与 Harness 文档交付审查
description: 相对最新 main 的双轴审查、用户反馈和修复结果。
tags: [documentation, review, adapter, channel]
timestamp: 2026-11-01T00:00:00Z
---

# 范围

固定基线 `3f2a810b61fefeafa6ad1571f68362b73494b85a`。审查包含已跟踪 diff 及尚未跟踪的全部双语 Harness 专题和任务记录。采用 code-review 的两个独立只读审查者，分别检查 Standards 与 Spec。

# Standards

发现并修复 3 项：ZCode 能力限制明确归于当前 Runtime Adapter，并链接独立的 V4 增强 Issue #286；恢复 MiniMax Code 中英文安装表格行；公共验证指引不再引用已从 Antigravity 专题删除的原生探针。

原审查者复核通过，剩余确定问题 0 项。未发现源码或 GitHub CI 范围变化。

# Spec

发现并修复 3 项：所有专题均提供完整 `extraset <<<` 内联声明；MiniMax 代理引用明确移除不支持的 model/effort；公共页移除失效的原生探针说明。另已更新 brief/context 的用户授权和最新 main 基线。

原审查者复核通过，剩余确定问题 0 项。文档中的 bot_name、可选模型/强度说明、默认审批模式省略及 OpenClaw 独立进程例外保留。mcode 是 MiniMax Code，不是小米 mimocode。

# 验证边界

审查不代替真实模型或 IM 验收。真实 agy 配置链路的证据来自 `85411725`；完整 QA IM 仍受凭据阻塞，Extra 实际 TCP 直连未确认，其他 Harness 没有新增真实模型验收。此次 PR 只交付文档，不自动关闭 #252。
