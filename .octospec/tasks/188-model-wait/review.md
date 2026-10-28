---
type: Task
title: Issue 188 本地双轴审查与修复
description: 相对最新 main 固定基线独立审查规范和需求，记录发现、修复与复审结果。
tags: [channel, testing, architecture]
---

# 审查依据

用户授权本地 code-review、fix 和 PR。固定基线 `59cb21a14259b6dc828f8791b8117ba1f3689f4c`；分支 `fix/188-model-wait-feedback`。审查开始时 HEAD 即基线，全部实现尚未提交，故以 `git diff --cached <baseline>` 审查暂存改动，复审包含工作区最新修复；交付前统一暂存。未创建历史提交，`git log <baseline>..HEAD` 为空。

规范依据为 AGENTS.md、CONTRIBUTING.md、命中的 OctoSpec 规则及 code-review 的 Fowler smell baseline。需求依据为 [Issue 指定评论](https://github.com/Mininglamp-OSS/octo-runtime/issues/188#issuecomment-6460043487) 和 [brief.md](brief.md)。两个独立审查代理并行执行，发现保持各轴归属，不合并或跨轴排序。仓库缺少 `docs/agents/issue-tracker.md`，已告知可运行 `/setup-matt-pocock-skills` 补齐；本轮以已知 GitHub issue/comment 为直接来源。

## Standards

- **P2，已修复：清理失败后删除证据。** `scripts/verify-model-wait-im-live.mjs` 原 finally 无条件删除临时目录。违反 engineering.md 关于确认退出和保留清理事实的约束。现在只有 Gateway 关闭且 Kernel close.complete 时删除，失败保留目录、待清理资源及结构化错误码。
- **P3，已修复：Core 新增关键注释使用英文。** `watchdog.ts` 首帧预算注释违反核心代码就近中文注释要求，已改为中文说明恢复 starting 时重开预算。
- **P2，已修复：仅活动工具绕过 idle/wall。** 复审发现仅 `activity.started(executing_tool)` 进入 tool_active 却未持有工具时钟，违反 architecture.md 的预算合同和 invoke-input.md 的工具预算语义。活动工具现在持有独立 startedAt/progressAt，参与 idle/wall 期限与人工等待重叠暂停；真实工具进度只更新 idle，重复开始和心跳不续期。

最终复审：**0 项开放问题**，历史 3 项均关闭，最高 P2。未报告需处理的 smell heuristic。

## Spec

- **P2，已修复：仅活动等待仍被 Core 首帧取消。** 需求明确工具、审批和用户输入等待不触发模型静默取消；Gateway 已暂停而 Core 原本不识别统一活动，长等待可能被 310 秒首帧期限抢先取消。Core 现在识别三个等待种类，与正式工具和交互分别持有生命周期；结束活动不提前结束正式等待，正式终态只关闭匹配活动，并行等待保留。返回模型等待后重新开始首帧预算；30/300 秒产品策略仍仅属于 Gateway。

最终复审：**0 项开放问题**，历史 1 项 P2 已关闭。审查代理独立运行三个相关测试文件，81 项全部通过。真实 renderer 截图尚未验收。

结论：Standards 3 项、最高 P2，全部修复；Spec 1 项、最高 P2，全部修复。
