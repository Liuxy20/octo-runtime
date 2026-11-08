---
type: Journal
title: Issue 328 执行底座与独立 Gateway 拆分
description: 用户决定移除 Extra 框架，Gateway 独立 npm SDK/CLI，记录本地实施与验证边界。
tags: [architecture, channel, installation]
timestamp: 2026-11-07T00:00:00Z
---

# 决定与交付

用户明确 Extra 属于过度设计，channel-gateway 必须为独立 Git 仓库，不采用 Runtime 统一业务 JSON/schema。按授权建立两仓新 worktree，先开 octospec、评估实施准备度 95/100，再实施。

Runtime 删除 native、WebUI、WeCom、Gateway 与 Extra 框架，保留执行底座和 runtime/client 双包。Gateway 继承原 Mininglamp-OSS/octo-spec，单独发布 npm package，提供 ChannelRegistry.register(endpoint, definition) 和 apps/cli 的 doctor/install/uninstall/start/stop/restart/status/run/logs/配置命令。Gateway 使用公开 client，不启动或关闭共享 Kernel。

本地构建、类型、lint、文档、适用离线回归和实际包外安装验证通过；完整结果、一次探针并发超时及真实环境缺口见[验收](../../tasks/328-remove-extra/validation.md)。未提交或发布，规划评分不代表实机验收。

用户追加要求清理 Runtime 文档：完成双语入口、Harness、Context/会话、IPC、交互和运维参考的一致性清理，同步移除当前工程规则中的 Extra 装配要求并修复失效锚点。渠道 SDK/CLI 与业务策略由独立仓库维护，保留旧路径的迁移指引与有版本归属的历史证据；本次文档检查结果另记于同一验收文件。
