---
type: Journal
title: Issue 312 双模式 Extra 实施
description: 记录独立调用 scope、Core 清理凭据、公共发行与本地验证的实现结论。
tags: [extra, lifecycle, ipc, testing]
---

# 实现结论

用户明确暂缓 #313，先实现 #312。基于 main@6fe5b5fc，在原独立 worktree 完成 direct/ipc/legacy 装配、统一 context.execution、独立调用控制、后台源消费与 Core 清理凭据；三个内置 Extra 已迁移，公开 /adapters/codex 入口已补齐。

direct 是调用 Core 的装配方式，不等于 Provider 常驻，也不赋予宿主崩溃恢复。终态、消费完成、首次 finally 清理和业务投递分别确认；Extra 不关闭借用 Core/Kernel。旧规划 95 分已撤回，实际结果见[验证记录](../../tasks/312-extra-execution-modes/validation.md)。

手动专项、既有全量、包外严格类型与独立 IPC 宿主、本机真实 Codex 两种模式均已执行。真实渠道、Windows/Linux 原生和外部业务 App 未运行。专项未接入默认测试、workflow 或 gate。code-review 两轴审查均无待修复项，按用户授权提交目标为 main 的 PR。
