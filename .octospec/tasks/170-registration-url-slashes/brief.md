---
type: Task
title: Issue 170 注册请求统一移除 API URL 尾斜杠
description: 在 Gateway 注册请求处复用已有规范化，修复鉴权成功后多斜杠注册失败。
tags: [channel, testing]
---

# 目标与背景

处理 [Issue #170](https://github.com/Mininglamp-OSS/octo-runtime/issues/170)。
Windows 11 原生在干净 main `96a6f58` 已复现：配置接受多个尾斜杠，鉴权成功，注册发出重复斜杠路径并在严格路由下返回不可重试的 404。

## 归属与关键合同

- 业务目标是同一合法 API base URL 的无、单、多尾斜杠配置使用一致的鉴权及注册路径；保留 `/api` 等既有前缀。
- 宿主决定 API 地址和凭据，Gateway 传输层负责拼接请求。显式输入仍为原 apiUrl、token、signal；修改 registerBot 最先违反一致性合同的位置。
- 复用已有 trimTrailingSlashes，不改公共 SDK 签名、配置、协议、身份 key、错误分类、重试或服务所有权。
- 不为此要求上层 SDK 消费方修改接入；CLI 与 SDK 继续使用同一实现。

## 范围

生产代码只改 wukong.ts 的注册 URL 拼接并补就近说明。新增显式手动回归，使用真实 loopback HTTP/WebSocket 和生产 ImRuntime 启动链路，检查实际路径及 online 状态。
依照现有架构规则，不修改 CI workflow、package scripts、默认测试 glob 或 Gate。

## 范围外

不修改 Issue，不改 IM 服务端或 Provider，不增加平台分支，不做全局 URL 清洗，不改 SDK/执行/会话/存储/重试合同。用户授权实现、提交并创建对应 PR；合并、部署和发布不在本次范围。

## 验收

1. 根路径和 `/api` 前缀分别覆盖 0/1/2/3 个尾斜杠；基线多斜杠失败，修复后全部规范路径并上线。
2. 配置校验接受输入，身份 key 对尾斜杠等价；其他 REST 对照仍使用相同 base 路径。
3. 运行手动专项、既有连接/协议/Runtime 相关回归、lint、命名、格式、typecheck/build 和 Octospec lint。
4. 审查全部 diff，排除生成物、凭据及无关修改；PR 说明 Windows 实测、服务端容错掩盖缺陷、最小修复与未验证边界。
