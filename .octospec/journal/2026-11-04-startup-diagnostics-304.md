---
type: Journal
title: "Issue 304：整合启动诊断与已合并 Home/端点合同"
description: "记录统一安全诊断、资源分类及兼容输出的可复用结论。"
tags: [startup, lifecycle, windows, sdk]
timestamp: 2026-11-04T12:17:00Z
source: self
---

# Issue 304：启动诊断

基于已合并 #306（#310）、#303（#311）的 main `6fe5b5fc`，集中 startup catalog、安全投影与 SDK/CLI 输出，直接从失败调用取得根因和 cleanup，无需等待 IPC 或建立 Run。需求与验证见 [brief](../tasks/304-startup-diagnostics/brief.md)、[validation](../tasks/304-startup-diagnostics/validation.md)、[review](../tasks/304-startup-diagnostics/review.md)。

可复用合同已回写 [生命周期规则](../rules/runtime-lifecycle.md#启动失败诊断与执行域)：诊断复用既有 phase/readiness；资源事实必须来自责任边界；回读文案不可信，只重建白名单事实并使用当前 catalog；完整外层回收不能掩盖内部未完成回收。

整合时不能把全部 ENOENT 都归为 Home，也不能让日志诊断递归补建无效 Home。旧路径属性从共享结构生成兼容别名，CLI flat startup 与规范 diagnostic 同源。两个必要分类映射在双语目录公开。

Node24/26 已完成构建、相关回归、WebUI 与包外 SDK 消费；全量发现 4 项 Playboard 执行域误分类，修正后双 Node 各 133 项相关回归通过；2 项 OpenClaw 强制结束后重启失败在干净 main 复现，已记录限制。知识检查通过，详见 validation。Windows 实测与 POSIX 纯计算、fake Provider 与真实业务验收分别记录。没有扩大 CI/默认测试或访问线上 Bot。
