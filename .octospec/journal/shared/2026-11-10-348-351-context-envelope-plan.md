---
type: Journal
title: Issue 348–351 联合清理任务规划
description: 记录最新 main 独立 worktree、四项联合合同及规划阶段检查结果。
tags: [architecture, context, protocol, adapter, planning]
---

# 规划结果

2026-11-10 按用户要求创建 `/Users/lvsijia/.codex/worktrees/context-envelope-cleanup/octo-runtime`，HEAD 与本次成功 fetch 的 `origin/main@7892ebdf2ed9b1fa859bd51f15da6d7f03c247e2` 相同。原 checkout 的未跟踪文件保留原处，新 worktree 未带入这些文件。

建立 [联合 brief](../../tasks/348-351-context-envelope/brief.md)、[模块设计](../../tasks/348-351-context-envelope/design.md)、[实施及验收矩阵](../../tasks/348-351-context-envelope/plan.md)和实际阅读清单。覆盖四个 issue 与 #351 评论：删除来源分类、业务公共类型及专用合并、默认值哨兵；原生模式及私有 AgentEnv.Item 的定义、校验、默认与 README 归对应 Adapter 包，包括 OpenClaw options。

当前只规划，不修改实现。保留执行输入快照与通用 JSON 约束；不顺带删除其他执行配置组合 API，不处理 limits.enforcement 或 runtime selection。公共 SDK 文档说明机制并链接包级合同，不维护第二份私有字段定义。

初稿规划自评为 94/100：3 分为各 Adapter 私有 item 最终合同，2 分为最新下游依赖核对，1 分为旧专属 evidence 完整消费审计。

用户要求补齐后，新增 [私有 item 实施合同](../../tasks/348-351-context-envelope/adapter-items.md)和 [消费者审计](../../tasks/348-351-context-envelope/consumer-audit.md)。已确定各包字段、缺省、审批关系、原生失败语义和 OpenCode 双路径限制；核对 Gateway 远端 main@beb80493 的业务类型/校验依赖；确认统一 execution evidence 删除闭包与 session evidence 保留范围。当前自评 [97/100](../../tasks/348-351-context-envelope/assessment.md)，剩余 3 分对应实现后的真实原生响应和双包消费验证风险，未作为已通过测试计算。

## 检查与限制

全库 octospec lint、本次任务 Markdown 元数据与 context.yaml 解析、diff 格式和 CI 范围检查见 [validation](../../tasks/348-351-context-envelope/validation.md)。系统 Python 缺 PyYAML，使用 uv 临时依赖环境，未修改仓库依赖。Gateway 通过 API 核对远端 SHA 后读取同版本 git 对象，SSH fetch 等待后已终止；未宣称集成通过。

未运行实现测试、真实 Provider、IM、Windows/Electron 或双包验证。未提交、推送、创建 PR、合并、发布；没有扩大 CI 范围。
