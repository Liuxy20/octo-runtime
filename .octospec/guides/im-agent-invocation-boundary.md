---
type: Guide
title: IM Agent 与通用 invoke 的责任边界
description: 区分 IM 业务策略与 Host 执行准备，说明固定目录、公开输入和系统指令的责任边界。
tags: [architecture, channel, agent, invoke, workspace, session]
timestamp: 2026-10-16T00:00:00Z
---

# 独立渠道接入

本文对应的渠道功能已迁至[独立 Gateway](https://github.com/Mininglamp-OSS/octo-channel-gateway)，使用 `ChannelRegistry.register(endpoint, definition)`。配置、逐轮 Context、会话历史和投递由 Gateway/应用负责。Runtime 不提供插件配置和业务 schema；旧任务中的 Extra 设计已由 Issue 328 替代。
