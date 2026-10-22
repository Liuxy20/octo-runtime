---
type: Journal
title: Issue 110 Gateway 默认发送者准入修复
description: 新 worktree 内修复消息与卡片 owner 默认，记录自动化验证和相邻入口检查。
tags: [channel, authorization, testing]
timestamp: 2026-10-22T00:00:00+08:00
---

# Issue 110 实施与验证

基于最新 `origin/main@5c1921d` 新建 worktree `octo-runtime-channel-default-admission`、分支 `fix/channel-default-admission`。用户明确省略 `allowed_sender_ids` 时 DM 沿用平台好友准入，群/话题不额外限制发送者；显式名单语义保留。已创建英文 [P1 Bug #110](https://github.com/Mininglamp-OSS/octo-runtime/issues/110)，标签 bug、P1。

消息入口与卡片入口删除 owner 回退；省略时不额外限制发送者，显式非空及空名单仍生效。删除内部不再使用的 owner 参数及调用处，空发送者继续拒绝。应用层原有省略语义不变。架构正文、Channel 规则、Schema 描述、README、CLI/SDK 和双语开发者指南已同步。历史任务按原证据保留，现行规则明确取代旧 owner 默认。

## 验证

- 新回归在旧实现上失败两项：非 owner 默认准入与传输回调投递；修复后通过。
- 定向 Node：81 通过，包括 DM/群/话题发送者矩阵、Bot 原生 handoff、显式名单、消息结构/Space/群/mention、自消息与真实加密 WS 非 owner 执行及卡片控制。
- 五 Bot 隔离四项回归：非 owner 用户/Bot × 群/子区，通过真实 GatewayTransport → ImRuntime 路径触发，网络及 Provider 使用 fixture。五个独立在途任务中只点名 B 的 reset 不取消原 Run，stop 只取消 B，后续 B 使用新会话/代次，另外四个 Bot 的状态和调用数不变。
- 全量 Node：1665 项，1630 通过、35 跳过、0 失败，严格未处理异常和并发 4，约 59 秒。
- UI：35 通过；开发者文档检查：类型样例、链接及 4 项运行样例通过。
- `pnpm typecheck`（含全 workspace build）、`pnpm lint`、`pnpm lint:names`、`git diff --check` 通过。
- Octospec lint：任务 frontmatter、规则索引和本地链接检查通过；收尾新增本 journal 后再次检查。
- 相邻入口：同群非发起者 `/stop` 的本地 fake 探针确认能取消原任务，详见[检查记录](../../tasks/channel-default-admission/audit.md)。

核心修复的[可执行性评估](../../tasks/channel-default-admission/assessment.md)为 100/100；没有待定的核心实现决策，剩余提交、PR、远端 CI 与真实部署验收不计为已完成。

用户已授权将独立 worktree 的改动提交 PR，并在远端门禁满足后合并 main；CI、审批和合并状态以关联 PR 为准。没有修改运行中服务配置、重启服务、发送真实消息或验证 compaction。真实截图消息链及平台 DM 好友部署行为未验，不将自动化结果当作线上已恢复证据。

## PR 112 Windows CI

首轮远端 Windows Node 24 在身份登记约 10.56 秒处失败，原查询期限 10 秒且错误被折叠为未知身份；同轮 Windows Node 26 通过。调整有界身份查询为 30 秒，登记失败保留系统 cause，公开查询仍返回未知，未确认身份仍不得登记或回收。该改动尚待新一轮 Windows CI 验证，不能将延长期限当作已证明消除了 PowerShell 冷启动瓶颈。

追加修复后的本地 Node 全量回归 1631 通过、35 跳过、0 失败；构建/类型、lint、命名、格式、文档和差异检查通过。新增回归使用命令边界 fixture 验证 Windows 查询失败及身份不缓存，真实 Windows 系统调用以关联 PR 的新一轮 CI 为准。同步修正发行验收对旧 10 秒常量的断言；双语指南明确平台实际访问策略，不承诺新增加的仅好友保证。

## 可复用结论

修改默认准入时同时检查消息入口、应用层与卡片回调，避免普通任务已放开但控制入口仍按旧 owner 默认拒绝。平台投递权限、可选本地名单、群 mention 门槛、任务控制归属分别维护；不得用一个 owner 默认或提示词代替所有边界。被点名 Bot 在当前群内的共享会话命令与原任务卡片的不同控制范围应按产品决策解释，不在本次默默更改。此处共享仅指同一 Bot、同一频道的多个发送者；不同 Bot 的 Runtime 和会话分别隔离，单独点名一个 Bot 的命令不会影响其他 Bot。
