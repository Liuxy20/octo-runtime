---
type: Journal
title: "Issue 166：Playboard 自动审批与宿主默认值"
description: "公共交互事实区分外部回答，保持 SDK 默认与 CLI 自动审批可完成性。"
tags: [cli, interaction, protocol, testing]
---

基于 `main@4a0f53b5` 的未提交实现新增可选 responseRequired，缺字段按需要外部回答处理；Codex 与共享 canonical 审批桥声明实际响应归属。Playboard 只在字段为 false 时继续消费到真实终态，自动通知和 resolved 均不替代 completed/cleanup。

full_access 缺省仅属于 Playboard，通用 SDK 继续 ask。现有 OpenClaw 简写依赖共享入口归一化，不能提前用严格原始 Context 校验阻止该步骤；入口默认值只检查是否已显式指定策略，完整校验仍在原边界。

手动专项 19 通过；同版本 Node 隔离目录全量 2389 通过、91 跳过、0 失败；真实 Codex 两模式均观察审批并完成工具回执。原 Node 目录包含 octo-cli 导致的 missing-installation 测试失败已在未修改主线对照复现。专项不接入默认测试或 CI。

用户随后认可验证并授权更新代码、提交和创建 PR。已同步至 `main@42102c60`，保留新版入门文档与 Kernel 配置快照，重新完成类型、lint、命名、生成产物、全量 2389/91、专项 19 项和真实 Codex 双模式验证。CI 范围不变，PR 供审查，不自动合并。

完整范围、双轴问题处置、验证及 Windows/外部宿主未验边界见[任务验证](../../tasks/166-playboard-auto-approval/validation.md)。具体提交及 PR 引用记录在 Loop 交付评论。
