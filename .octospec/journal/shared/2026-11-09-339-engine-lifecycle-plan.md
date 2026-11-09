---
type: Journal
title: Issue 339：常驻 Engine 所有权规划与架构文档细化
description: 记录新 worktree 的规划交付、CODEX_HOME 权属说明、95 分自评及实施验证边界。
tags: [architecture, adapter, lifecycle, ownership, documentation]
---

# 规划交付

用户要求从最新 main 新建 worktree，启动 octospec 并完成 95 分可执行性评估。本次是架构边界细化，重点是每个模块持有对象的生命周期责任；追加说明 CODEX_HOME 必须由宿主注入，权限与数据生命周期归宿主维护。

基线为 `origin/main@157fabb7d680df1ee72d9d9e5ed40cfc6c22b336`，分支 `plan/issue-339-engine-lifecycle`，工作区 `/Users/lvsijia/.codex/worktrees/issue-339-engine-lifecycle/octo-runtime`。原工作区保留。

交付[简报](../../tasks/339-engine-lifecycle/brief.md)、[设计](../../tasks/339-engine-lifecycle/design.md)、[计划](../../tasks/339-engine-lifecycle/plan.md)与[95 分评估](../../tasks/339-engine-lifecycle/assessment.md)。双语 docs 架构增加当前模块对象表、常驻 Engine 目标所有权表、Home/进程/租约边界与关闭故障顺序；规则只追加明确标记为尚未实施的目标，不改写历史证据。

CODEX_HOME 由宿主选择和准备，Home owner 管理权限、保留、迁移和删除；Engine owner 管理进程；Adapter 释放本调用 lease。默认 CLI 在实际服务宿主进程装配托管模块，业务 SDK 可以注入自管依赖。目标 API 尚未发布，不将设计写成当前可用行为。

用户追加确认可扩展性约束：Runtime 不限制 Adapter 的构造方法、参数数量/类型/顺序或依赖形式；可传具体 client，也可传任意其他对象、配置和函数。双语 docs、架构规则及方案已明确只约束注册结果的执行合同；CLI manifest 工厂和 Codex provider 不能成为所有 Adapter 的构造要求。新增 A16 规划验收覆盖非 Codex 黑盒依赖与多种构造方式，尚未执行实现测试；评分维持 95，不以补充文字代替原型证据。

实际检查与未验范围见[验证](../../tasks/339-engine-lifecycle/validation.md)。规划 95 分不等于实现验收；剩余 5 分对应共享 provider、Home 配置、CLI 回滚与真实平台证据。本阶段不修改运行代码或 CI，不提交、推送、创建 PR、合并或发布。
