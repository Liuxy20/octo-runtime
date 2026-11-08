---
type: Guide
title: 独立渠道接入迁移
description: 旧 Extra 配置文档的迁移入口，指向独立 Gateway SDK 与 CLI。
tags: ["extra"]
timestamp: 2026-10-27T00:00:00Z
implementation_baseline: a7c33b6
---

# 独立渠道接入

本文对应的渠道功能已迁至[独立 Gateway](https://github.com/Mininglamp-OSS/octo-channel-gateway)，使用 `ChannelRegistry.register(endpoint, definition)`。配置、逐轮 Context、会话历史和投递由 Gateway/应用负责。Runtime 不提供插件配置和业务 schema；旧任务中的 Extra 设计已由 Issue 328 替代。
