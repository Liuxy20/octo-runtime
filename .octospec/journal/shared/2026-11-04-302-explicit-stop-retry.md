---
type: Journal
title: Issue 302：显式控制尝试与原观察的分离
description: 记录失败取消的再次显式 Stop、内部不重试与首次控制观察的修复原则。
tags: [kernel, cancellation, lifecycle]
timestamp: 2026-11-04T00:00:00Z
source: self
---

# 结论

取消控制结果未知不授权自动重试，也不能永久禁止用户的新 Stop。只清空失败 Promise 会让内部 drain 重发副作用；只替换 Promise 又会覆盖原 invoke 观察的失败。因此当前尝试去重与原观察结果分别保留，新尝试只由新的公开显式调用授权，继续使用原 RunRef。

首次尝试与当前尝试各保留一个 Promise 引用，不维护无界历史。原错误对象、真实尾事件与取消 ACK 分别验证。规则已回流 [本地执行](../../rules/local-execution.md)，环境、基线、实际结果及缺口见 [任务验证](../../tasks/302-explicit-stop-retry/validation.md)。
