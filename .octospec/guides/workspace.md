---
type: Guide
title: 工作区与开发组织
description: pnpm workspace、包依赖、构建和新增项目步骤。
tags: []
timestamp: 2026-10-20T00:00:00Z
implementation_baseline: feat/executor-kernel-host-lifecycle
---

# 工作区与开发组织

Runtime 使用根 pnpm workspace，包含 apps/cli、Protocol、Client、Core、Kernel、Host 辅助和 Provider Adapter。边界见[架构](../rules/architecture.md)。packages 不依赖 apps，Core/Kernel 不依赖具体 Provider，宿主原生导入并注入 Adapter。

根发行物为 @mininglamp-oss/octo-runtime，独立消费端为 @mininglamp-oss/octo-runtime-client。内部 workspace 依赖使用 workspace:*；发行打包收集实际生产依赖，不能发布源码链接。源码版本保持 0.0.0，由发行流程注入稳定版本。

Channel Gateway 在独立仓库 octo-channel-gateway 维护，发布自己的 npm 包、SDK 和 CLI。Runtime 不包含业务渠道、WebUI、native 目录、Extra 加载器或 Extra 配置清单。

常用检查为 pnpm run build、pnpm run lint、pnpm run typecheck、pnpm run test:suites、pnpm run docs:check。各 package 的实现位于 src，编译至忽略的 dist。TypeScript 使用 strict、NodeNext 和 declaration；文档与公开导出随合同同步。

新增 Provider 时创建 octo-runtime-adapter-<name>，实现 metadata/probe/invoke/session/event 映射；CLI 清单在 apps/cli/src/manifest.json，其他宿主显式选择 Adapter。新增业务集成应使用公开 Client，并放在自己的仓库。

接入与发行步骤见[部署说明](../../DEPLOYMENTS.md)、[SDK 入门](../../docs/zh-CN/getting-started/sdk.md)。
