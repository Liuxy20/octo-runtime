---
type: Journal
title: Issue 58：Windows 控制台取消与关闭
description: 真实控制台事件、worker 关闭顺序、Playboard 主结果及测试工具归属。
tags: [windows, lifecycle, testing, octospec-learning]
timestamp: 2026-10-26T00:00:00Z
source: self
---

# Issue 58：Windows 控制台取消与关闭

Windows child.kill 是强制终止，不能代替真实控制台 Ctrl+C 验收。共享控制台可能同时通知 Kernel 与 worker；父 IPC 连接期间，worker 由 Kernel 取消并消费源终态后再 EOF 排空。约束回写 [本地执行规则](../../rules/local-execution.md)。

Playboard 清理失败须保留执行错误和非零结果，清理后的成功与执行终态分别判断。前台 IPC 测试沿用显式假管理器，控制台工具编译缓存与 Runtime Home 分离，且实际进程与事件投递进程都须等待退出；验证约定回写 [工程规则](../../rules/engineering.md)。

范围、兼容边界及 Windows 验证见 [任务简报](../../tasks/58-windows-cli-signals/brief.md) 与 [实施记录](../../tasks/58-windows-cli-signals/implementation.md)。

最新 `main@81284c9` 上构建、类型、lint、命名及格式检查通过；三份完整文件为 33 通过、2 项原有跳过、0 失败。module-loading 改为等待真实 ready 与 PID，保留原有总预算。默认全仓并发中的 foreground 耗时 11.22 秒通过，真实 Ctrl+C、兄弟组件、重启及最终状态断言均执行。

PR #183 评审发现本次新增的两处 Playboard fixture 嵌套 TMPDIR 触及 macOS socket 长度限制。仅将 macOS 临时根改为 `/tmp` 下独占短目录并登记清理，保留全部执行与回收断言。Windows 三文件复验 33 通过、2 项原有跳过，产品与 SDK 未修改；macOS 托管 CI 结果独立核对。

评审修复提交的六平台 CI 与 CI Gate 已通过。随后按用户要求 rebase 至 `main@79b11aa`，仅保留任务索引双方记录；本次产品及测试内容未变。新基线构建、类型和三份完整相关文件复验通过（33 通过、2 项原有跳过），详见实施记录。

交付期间继续同步最新 `main@a3be719`，保留主线的 IPC 短路径实现及全部长 TMPDIR 回归；#58 原有取消、终态与清理断言保持。最终构建、类型及冲突文件 lint/格式检查通过，三文件为 35 通过、2 项原有跳过、0 失败，详细同步与验证记录见实施记录。
