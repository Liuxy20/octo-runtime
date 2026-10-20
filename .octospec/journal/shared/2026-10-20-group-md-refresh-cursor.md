---
type: Journal
title: GROUP.md 通知分流与会话规则状态修复
description: 记录 Issue 54/55 的实现边界、自动化证据及线上未验证项。
tags: [channel, session, reset, context, testing]
timestamp: 2026-10-20T00:00:00Z
---

# 实现

基于 main `6f5f25f97ec4b2ca879ac78ca2990ee2019f9eeb`，分支 `fix/group-md-refresh-cursor`。任务与状态形状见[简报](../../tasks/group-md-refresh-cursor/brief.md)及[计划](../../tasks/group-md-refresh-cursor/plan.md)。

更新通知在 transport 普通准入前分流，只使已有相关 binding 的单个 `rulesContext` 字段失效。普通请求仍每轮读取权威规则 API；同一可续接 Provider 会话成功执行过相同版本时，省略自动规则正文。首次、reset/new、版本变化、失效或失败后重新携带；成功条件 patch 防止旧执行覆盖新通知。字段计入原有 binding 数量、字节和 TTL，通知 patch 不续期。

正常续聊省略规则时，通过既有 fresh fallback 输入字段冻结完整规则与原 inputs；同代次卡片重试保留快照。未修改服务端、通用协议、Core、Kernel 或 Adapter。规则失效不修改历史 gap。

# 验证

- `pnpm typecheck`：通过，包含全 workspace 构建。
- `pnpm lint`、`pnpm lint:names`：通过。
- 专项 14 项：通过。覆盖首次/未变版本、漏通知、群与话题失效、运行中更新及排队、失败/准备失败、冻结重试、空/删除/重建、reset/new、旧执行迟到、旧 store 兼容、TTL、generation 条件 patch；真实 transport 回调验证通知无任务准入或发送；加密 WS 验证自身 Bot 通知保留。
- Core 既有准备和模型渲染合同验证：普通续聊输入省略规则，fresh recovery 第一个输入含完整规则并保留当前图片字节。
- `pnpm test:suites`：最终复验 Node 1281 通过、10 跳过，WebUI 35 通过。
- `pnpm format:check`、Octospec 格式/索引/链接检查：通过。

# 未验证项

当前进程未配置 `OCTO_CHANNEL_QA_ACCOUNTS`。未进行 im-test 线上编辑至多 Bot 的完整广播联验，也未调用真实 Codex/ACP 验证模型对更新规则的实际应用。自动化使用受控 API、Host 和 Provider 输入，不把成功终态等同于模型已遵守。多 Runtime/Space 的线上隔离、真实 Provider 同轮恢复仍需独立联验；本地结果不能替代这些证据。
