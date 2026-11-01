---
type: Journal
title: Issue 136 每轮配置快照修复
description: 更新主线后修复两次配置读取，记录本地验证和交付边界。
tags: [invocation, ipc, stream, testing]
---

# Issue 136 每轮配置快照

用户确认“一次 AgentRun 只读一次配置”，认可规格并要求先更新最新代码。独立分支已快进到 `origin/main@4a0f53b50723422d90f051944ae19eb28f60712a` 后实施。

Kernel 提交前一次性取值、校验并复制配置，后续 transport、worker 和源窗口共用本轮数据。Provider 选项合并后检查预算；保留静态回退、覆盖顺序及后续调用读取新配置。不增加公共 API、配置缓存或 CI 范围。

修复前手动专项确认 resolver 被调用 2 次；修复后 5 项专项与 50 项相关回归通过，类型、lint、命名及改动格式检查通过。双轴审查各 0 项实现问题，默认 codex 选择覆盖缺口已补测。证据及未验边界见 [验证](../../tasks/136-configuration-snapshot/validation.md) 与 [审查](../../tasks/136-configuration-snapshot/review.md)。

当前实现和知识文件未提交、未推送，等待用户审查验证结果。Windows 原生和真实 Provider/IM 不在本轮已验证结果中。

后续用户认可结果并授权提交、推送和创建目标为 main 的 PR。交付前同步 main@88fe84ef，仅新增入门文档及示例，无执行代码或专项变化；原验证结论适用。最终 PR 引用保存在 Loop 任务 ORT-40 的交付评论中，不自动合并。
