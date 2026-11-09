---
type: Journal
title: Issue 341：AgentEnv 直传 Adapter
description: 记录配置投影移除、宿主私有扩展边界、双轴审查及最新 main 整合验证。
tags: [architecture, adapter, protocol, testing]
---

从 main d5aeae707fcda0b138b360136f164c085c9a5e87 创建独立 worktree，95 分规划后实施；提交前整合 4d7e272d1bb30957c815410f68758a9d2445d708，保留 #339 宿主 Engine 所有权。AgentEnv 只有 schema/items，Core 只做路由、快照与生命周期，Adapter 直接读取配置。公共层不注册 Harness 私有 payload；OpenClaw agentId 完全属于宿主与对应 Adapter 的约定。默认信封由调用方显式选择，可信连接独立于信封。

测试迁移删除会补条目的读取 helper，区分调用方构造默认值与生产透传。独立审查修复外层 getter 共享、准备失败清理证据、探针预算前置、跨调用错误证据污染、包外 SDK 导入和常驻发送队列容量，保留失败反例及清理断言。Standards、Spec 和测试/验证 JS 定制审查无剩余问题。

最新 main 上既有全量 1516 项：1455 通过、61 跳过、0 失败；手动专项、双包和包外 owner/IPC 验证通过，真实 Provider 与原生 Windows 未执行。详细命令、暂态失败复验和限制见[验证](../../tasks/341-adapter-agentenv/validation.md)，[审查](../../tasks/341-adapter-agentenv/review.md)保留已修问题。删除源码的历史链接固定到旧提交，不改历史结论。

不扩大 GitHub CI。按用户追加授权英文提交并创建 main PR；明确禁止自动合并，不启用 auto-merge，不合并或发行。
