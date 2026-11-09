---
type: Task
title: 统一修复仓库安全告警
description: 单一工作树完成五条依赖告警和六条 CodeQL 告警的修复及交付。
tags: [security, dependencies, testing]
---

用户要求统一在现有 fast-uri worktree 修复并提交 main PR。
实施期间 #336 已合并，后续从最新 main@a8685437 创建同一 worktree 内的
fix/security-alerts-unified 分支，保留已合并的 fast-uri 修复并交付剩余问题。
范围为 Dependabot #3-6、#9，以及 Code Scanning #44、#45、#51、#53、#54、#61。
不扩大 CI、不豁免告警、不改变 Provider 或宿主产品决策；保持脱敏、控制文件
安全读取、故障夹具和 Git/发行工具的既有职责。业务目标是消除已识别的安全缺陷，
决定权属于仓库维护者，显式输入为告警清单；不改变其他接入产品的公共合同。

验收为手动专项、构建、类型检查、lint、全量既有测试、依赖审计和可用的 CodeQL 分析。
分别记录本地结论和托管扫描状态；不以源码修复代替远端关闭确认。已授权提交及 PR 更新，未授权合并。
