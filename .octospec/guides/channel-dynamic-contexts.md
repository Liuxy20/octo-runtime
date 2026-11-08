---
type: Guide
title: Channel 逐轮加载宿主 Context 与插件封装
description: 说明 Agent 提示词更新场景、业务函数注入、静态动态覆盖、SDK 装配边界及内存约束。
tags: [extra, channel, context, sdk, lifecycle]
timestamp: 2026-10-17T00:00:00Z
---

# 独立渠道接入

本文对应的渠道功能已迁至[独立 Gateway](https://github.com/Mininglamp-OSS/octo-channel-gateway)，使用 `ChannelRegistry.register(endpoint, definition)`。配置、逐轮 Context、会话历史和投递由 Gateway/应用负责。Runtime 不提供插件配置和业务 schema；旧任务中的 Extra 设计已由 Issue 328 替代。
