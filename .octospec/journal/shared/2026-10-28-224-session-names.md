---
type: Journal
title: Issue 224 会话名称与原生续接
description: 调用方名称、通用默认值和原生恢复句柄的职责及验证边界。
tags: [session, openclaw, channel]
---

# 决策与实现

用户要求从最新 main 新建 worktree，先 OctoSpec，再以可执行性超过 95 分进入实施、审查与 PR。起点 `0ca12a0`，准备度 96/100。需求见 [Issue 224](https://github.com/Mininglamp-OSS/octo-runtime/issues/224)，范围见[任务](../../tasks/224-session-names/brief.md)。

`sessionName` 是可选展示字段，既不是授权边界，也不是恢复句柄；同名不能合并会话。Core 只提供通用 UUID，Host SDK 不生成名称或持久化名称。Gateway 在自己的 binding 中保存 `octo-dm-...`、`octo-group-...` 和 `octo-group-...-topic-...` 名称；reset/new 后重新生成。其他调用方自行选择策略。

OpenClaw fresh 才创建会话；resume 使用原 key，先 describe 确认原生存在，再应用权限，保留逐轮 idempotency、事件过滤及取消关联。不存在或不兼容明确失败，不暗中 fresh。Codex 仅 fresh 设置 thread 名称，CC 仅 fresh 传 `--name`；ACP 不虚构标准标题能力，保留原生 session/load/new 并报告限制。

# 证据与限制

27 个固定 OpenClaw commit 的请求 schema 子集由源码提取，离线回归不等于 27 个真实 Gateway。OpenClaw 2026.9.4、Codex 0.164.0、CC 2.1.306 分别完成真实三轮句柄及记忆验证、同名 fresh 隔离；名称持久化也在 Codex/CC 原生索引或 transcript 中确认。

真实 IM 因 QA 凭据为占位值、无已保存凭据而阻塞，尚未完成 DM/群/话题链路回读。自动检查及所有真实验证的范围、失败修正、版本与限制见[验证记录](../../tasks/224-session-names/validation.md)。独立真实入口只手动运行，保持既有 CI 范围；未合并、未部署。

# PR 后续评审

外部评审复现了此前共享 schema 前瞻在 Go RE2 上不受支持的 P1；旧原生套件未包含名称用例，因此初轮通过范围不足。用户明确名称只允许英文字母、数字和 `-`，据此收紧为 1–256 ASCII 字符，采用现有 schema 的 `not` 加非法字符类，不增加 native 特判。新增 30 项三端共享 fixtures，覆盖两种 wire、合法名称、长度、非法字符和类型；Go/Python 协议集各 418 项通过。后续证据见上述验证记录；没有扩展 CI。
