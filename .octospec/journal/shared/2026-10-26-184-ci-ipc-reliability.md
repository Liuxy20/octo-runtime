---
type: Journal
title: Issue 184 短临时 socket 与测试竞态修复
description: 记录本次收敛范围、复现、实现及交付前验证边界。
tags: [ipc, testing, lifecycle]
---

# Issue 184 实施记录

用户要求常驻 socket 继续归 SDK 自配 Home / Unix CLI 默认 `~/.octo-runtime`；仅 Playboard 一次性 socket 使用固定短临时根。本次从 `main@81284c9` 建独立 worktree，规划准备度 97/100 后实施；评估不是统计成功率。

POSIX Playboard 使用 `/tmp/op-XXXXXX/k.sock`，临时目录独占私有，Windows 命名管道保持现状；不新增配置、常驻迁移或 Home 校验。进程树 fixture 原子发布 ready，DSH fixture 的后代确认退出先于目录删除；共享 helper 只存在于 test-support。

本机原实现新回归 3/3 失败，修复后 focused 87 通过，进程场景连续 10 次通过；全量 Node 1833 通过/50 平台跳过、UI 35 通过。lint、命名、格式、typecheck、docs 和离线发行包验收通过。OKF 全库仍有 7 个与基线一致的历史 frontmatter 缺失，未夹带修复。

授权含英文 commit、PR、门禁后合并 main；PR CI 和 reviewer 保护不由本地审查替代。完整证据、未验范围和逐文件审查见 [任务](../../tasks/184-ci-ipc-reliability/brief.md)、[验证](../../tasks/184-ci-ipc-reliability/validation.md)及[review](../../tasks/184-ci-ipc-reliability/review.md)。
