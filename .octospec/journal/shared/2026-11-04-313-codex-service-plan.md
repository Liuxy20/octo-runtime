---
type: Journal
title: Issue 313：Codex 常驻服务规划
description: 记录最新 main 独立 worktree、服务级所有权方案及规划证据和未验边界。
tags: [architecture, adapter, lifecycle, testing]
---

# 规划结果

从成功 fetch 的 `origin/main@de3ff37a86ee3cb8f6ab66148ceca817f6ae5240` 创建独立 worktree `octo-runtime-issue-313`，分支 `plan/issue-313-codex-service`。主线已合入 #294/#312；Codex 逐轮进程模型仍存在。

完成[需求简报](../../tasks/313-codex-service-lifecycle/brief.md)、[设计](../../tasks/313-codex-service-lifecycle/design.md)、[实施计划](../../tasks/313-codex-service-lifecycle/plan.md)、[20 组验收](../../tasks/313-codex-service-lifecycle/acceptance.md)、[96 分执行性评估](../../tasks/313-codex-service-lifecycle/assessment.md)及[验证记录](../../tasks/313-codex-service-lifecycle/validation.md)。分数为规划自评，剩余 4 分公开，未声称修复完成。

设计选择 Core 注册时绑定独立 scope，Codex 在 scope 内管理有界 owned stdio 服务池和主动恢复，Kernel/direct 共用 Core。正常完成与 Stop 仅清理原轮，owner shutdown 才关闭 owned 服务；外部 daemon attach 不纳入首版。

源码发现两个必须处理的配置/协议细节：HTTP MCP 的每轮随机环境名会破坏复用键；共享 writer 的全局取消不能再由单轮调用。0.164.0 离线 schema 还显示 MCP elicitation 的 turnId 可空，不能猜当前轮路由。真实并发与完整关联是 M0 阻塞验收。

#307 的已澄清成功/清理分离列为本次回归；服务复用不能证明其根因解决。需要在 Core/Adapter 的终态和清理合同中明确处理，避免只修 Adapter 后仍被 finally 覆盖。

已读取 issue 和官方协议文档，完成本机 version/help/schema 只读检查。具体知识检查结果见 validation。未改生产代码、测试、workflow、脚本或默认 selector；未启动模型、kill 现有服务、操作 IM、提交、推送或创建 PR。

## 2026-11-05：doctor 只展示常驻进程

用户确认 doctor 的 PID 树只看常驻服务，不需要 turn。规划增加所选实例的 Host/Kernel、独立 Extra 与受管 app-server 快照；同 PID 合并角色，不展示 turn/thread/Run、调用计数和临时工具。现有 Kernel status 增量提供安全快照，Schema 与生成类型同步；direct 宿主读取同源 Core 快照，CLI 不扫描其他宿主或全局 Codex。

新增 A21 覆盖未启动、复用、重启换代、旧清理未确认、owner 不可达和数据脱敏，合计 21 组验收。评分仍为 96/100；此处仍只更新规划，没有实现 doctor。
