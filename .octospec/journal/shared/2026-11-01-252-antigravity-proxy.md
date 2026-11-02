---
type: Journal
title: Antigravity 按 Bot Context 注入代理
description: 非 TUN 模式下仅 Provider 注入代理的真实结果及 Harness 专题文档交付。
tags: [documentation, channel, envs, adapter, testing]
timestamp: 2026-11-01T00:00:00Z
---

# 结论

main@85411725 的现有实现已能把 Gateway Bot 的 `octo.execution/envs` 传给真实 agy 子进程。宿主代理变量为空时，配置校验、dispatcher、独立 Kernel 和 Adapter 成功返回预期文本、唯一成功终态及完整清理，不需要改产品代码。

完整 IM 在预检时被现有 QA 凭据认证拒绝，未发送消息；实际 Extra TCP 直连未验证。非 TUN 不消除系统代理的独立影响，不能把环境隔离解释成严格网络隔离。

# 文档

新增全部 14 个内置 Harness 的双语安装/认证、Gateway 配置和代理专题，以及完整 Gateway 声明、导入重载和非 TUN 排查指南。保留 OpenClaw 独立进程例外；只为 Antigravity 声明本轮真实模型验收。修正旧总览对 OpenCode ask 支持的过时描述。

检查与审查见[验证记录](../../tasks/252-antigravity-proxy/validation.md)和[交付审查](../../tasks/252-antigravity-proxy/review.md)；后续入口见[中文 Harness 目录](../../../docs/zh-CN/guides/harnesses.md)。用户随后授权本地 CI、审查、更新、提交、推送和 PR，按该授权交付文档；运行行为和 GitHub CI 范围均不变。
