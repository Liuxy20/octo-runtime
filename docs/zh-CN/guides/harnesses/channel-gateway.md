# 独立渠道接入

[English](../../../en/guides/harnesses/channel-gateway.md)

渠道 SDK、CLI、配置和逐轮业务依赖已迁至 [octo-channel-gateway](https://github.com/Mininglamp-OSS/octo-channel-gateway).

`ChannelRegistry.register(endpoint, definition)` 通过公开 octo-runtime-client 连接已有 Kernel。Runtime 不定义通用业务 JSON/schema，也不发现或装配业务插件。
