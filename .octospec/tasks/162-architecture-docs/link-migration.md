---
type: Task
title: Issue 162 原始 21 个失效锚点的迁移核对
description: 对照原提交和当前文档，区分先前迁移与本次修正。
tags: [documentation, architecture]
timestamp: 2026-11-01T00:00:00+08:00
---

历史验证数量沿用当时完整范围，不表示当前支持范围。

# 核对依据

原提交：`8214292132d260c04cf72218580bef741788dd4a`。当前基线：`0bcd89c528018ffd508ca8099c8ac9c6b88de35d` 加本任务未提交改动。

原始位置来自 `git grep -n` 对上述提交的 Markdown 查询，并通过原目标标题确认。旧 SDK 指南当时已有 `#3-原生-extra` 与 `#0-源码接入使用最新-main` 等有效标题；这些有效引用不计入 21 项。真正失效的三项 SDK 标题分别是 `#1-worker-入口`、`#1-原生启动-octo-runtime` 和 `#3-独立-extra`。

下表中的迁移均已存在于当前 main，不把前人修正记为本次新改动。本次新增检查读取这些当前来源的实际内容、解析当前所有出站链接并验证目标；结果为 131 份文档、1748 个链接、87 个 fragment、0 错误。被删除的原来源单独注明，不据删除推断旧命令曾经执行成功。

## README 旧执行结构：15 项

以下旧链接的原始 URL 均为 `../../README.md#执行结构`。对应来源文件现存，旧的统一「协作边界」段落已被按包职责重写；每份 README 都保留有效的 `../README.md` 包目录入口。包目录继续链接架构与按场景文档，当前来源与目的地均已被显式检查覆盖。

| 编号 | 原来源（相对仓库根）及原行号 | 当前情况与目标 |
| --- | --- | --- |
| 01 | `packages/octo-runtime-acp-client/README.md:101` | 旧段删除；Packages 指向 `packages/README.md`，补充 ACP/Adapter SDK 与 Provider matrix |
| 02 | `packages/octo-runtime-adapter-acp/README.md:9` | 旧段删除；Packages 指向 `packages/README.md`，补充 ACP transport 与 Adapter SDK |
| 03 | `packages/octo-runtime-adapter-antigravity/README.md:45` | 旧段删除；Packages 指向 `packages/README.md`，执行生命周期指向 Core README |
| 04 | `packages/octo-runtime-adapter-claude-code/README.md:124` | 旧段删除；Packages 指向 `packages/README.md`，执行生命周期指向 Core README |
| 05 | `packages/octo-runtime-adapter-codebuddy/README.md:112` | 旧段删除；Packages 指向 `packages/README.md`，补充 ACP transport 与 Core README |
| 06 | `packages/octo-runtime-adapter-codex/README.md:184` | 旧段删除；Packages 指向 `packages/README.md`，执行生命周期指向 Core README |
| 07 | `packages/octo-runtime-adapter-hermes/README.md:27` | 旧段删除；Packages 指向 `packages/README.md`，补充通用 ACP Adapter 与 Core README |
| 08 | `packages/octo-runtime-adapter-kimi-code/README.md:27` | 旧段删除；Packages 指向 `packages/README.md`，补充通用 ACP Adapter 与 Core README |
| 09 | `packages/octo-runtime-adapter-mcode/README.md:27` | 旧段删除；Packages 指向 `packages/README.md`，补充通用 ACP Adapter 与 Core README |
| 10 | `packages/octo-runtime-adapter-qodercli/README.md:33` | 旧段删除；Packages 指向 `packages/README.md`，补充独立 CN Adapter 与 Core README |
| 11 | `packages/octo-runtime-adapter-qoderclicn/README.md:35` | 旧段删除；Packages 指向 `packages/README.md`，补充独立国际版 Adapter 与 Core README |
| 12 | `packages/octo-runtime-adapter-sdk/README.md:91` | 旧段删除；Packages 指向 `packages/README.md`，补充 authoring guide 与 metadata rule |
| 14 | `packages/octo-runtime-cross-service/README.md:128` | 旧段删除；Packages 指向 `packages/README.md`，部署说明指向 CLI Operations |
| 15 | `packages/octo-runtime-protocol/README.md:135` | 旧段删除；Packages 指向 `packages/README.md`，补充 InvokeInput/output/Kernel IPC |

共同现有入口：[包目录](../../../packages/README.md)、[Core 生命周期](../../../packages/octo-runtime-executor-core/README.md)、[CLI Operations](../../../docs/en/getting-started/cli.md)。

## Extra 配置旧标题：3 项

原始 URL 均为 `../../.octospec/guides/extra-configuration.md#原始-json-schema-配置合同`。

| 编号 | 原来源及原行号 | 当前情况与目标 |
| --- | --- | --- |
| 16 | `packages/octo-runtime-extra-channel-gateway/README.md:37` | 旧段迁移；当前 Field list 链接同包 `config-schema.json`，区分 CLI 完整声明和 SDK config |
| 17 | `packages/octo-runtime-extra-channel-wecom/README.md:17` | 旧段迁移；当前 Full field list 链接同包 `config-schema.json` |
| 18 | `packages/octo-runtime-extra-webui/README.md:7` | 旧段迁移；当前 Full declaration 链接同包 `config-schema.json`，说明 CLI/SDK 字段差异 |

目标：[Gateway Schema](../../../packages/octo-runtime-extra-channel-gateway/config-schema.json)、[WeCom Schema](../../../packages/octo-runtime-extra-channel-wecom/config-schema.json)、[WebUI Schema](../../../packages/octo-runtime-extra-webui/config-schema.json)。配置指南现有公共 Schema 子路径说明保留，无需重新添加已删除标题。

## SDK 指南改名标题：3 项

| 编号 | 原来源及原行号 | 原始 URL | 当前情况与目标 |
| --- | --- | --- | --- |
| 19 | `.octospec/guides/adapter-authoring.md:39` | `../../SDK_NATIVE_INTEGRATION_FULL_GUIDE.md#1-worker-入口` | 来源现存，现链接 `../../docs/zh-CN/getting-started/sdk.md`；正文保留 `serveWorker` 注册说明 |
| 20 | `DEVELOPMENT.md:40` | `SDK_NATIVE_INTEGRATION_FULL_GUIDE.md#1-原生启动-octo-runtime` | 来源与旧 SDK 大指南均已删除；当前 README Development 指向 CONTRIBUTING，SDK 入门说明原生 Kernel 构造和源码集成 |
| 21 | `packages/octo-runtime-extra-channel-wecom/README.md:179` | `../../SDK_NATIVE_INTEGRATION_FULL_GUIDE.md#3-独立-extra` | 来源现存，状态/关闭正文保留，Further reading 指向 `../octo-runtime-host-sdk/README.md` |

目标：[Adapter 指南](../../guides/adapter-authoring.md)、[SDK 入门](../../../docs/zh-CN/getting-started/sdk.md)、[贡献指南](../../../CONTRIBUTING.md)、[Host SDK](../../../packages/octo-runtime-host-sdk/README.md)。

## 本次实际修改与限制

本次修正工作区的旧 launcher/依赖代理/Provider 依赖说明，以及动态 Context 指南和就近注释的 5 秒清理承诺。未改写历史 tasks/journal，也未恢复旧入口或兼容锚点。链接检查不验证外部 URL、非 Markdown fragment 或平台运行行为，不能把静态通过表述为真实 Provider、IM 或 Windows 时序验收。
