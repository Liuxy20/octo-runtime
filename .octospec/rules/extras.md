---
type: Rule
title: Extra 加载与业务边界
description: 插件归属、统一 KernelClient、停止清理与显式装配。
tags: ["extra","lifecycle","installation"]
timestamp: 2026-10-21T00:00:00Z
implementation_baseline: fix/75-cli-lifecycle
id: runtime-extras
tier: repo
priority: 0
load_bearing: false
inject_when:
  paths: []
  touches: []
source: self
supersedes: []
---

# 历史入口

Issue 328 已移除 Runtime 插件定义及业务渠道。此路径仅保留历史链接，当前约束见[架构规则](architecture.md)。渠道实现与业务规则迁至[独立 Gateway 仓库](https://github.com/Mininglamp-OSS/octo-channel-gateway)。
