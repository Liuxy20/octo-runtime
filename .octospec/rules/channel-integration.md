---
type: Rule
title: 渠道接入与业务投递
description: Channel 显式调用本地 Host，自己管理上下文、会话与投递。
tags: ["channel","delivery","session"]
timestamp: 2026-10-19T00:00:00Z
implementation_baseline: df63c8f
id: runtime-channel
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
