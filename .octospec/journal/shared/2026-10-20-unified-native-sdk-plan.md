---
type: Journal
title: Issue 71 原生服务规划与架构原则修正
description: 记录最新主线、独立 worktree、严格原生构造要求与规划阶段的验证边界。
tags: [architecture, runtime, extra, lifecycle]
---

# 结论

从 2026-10-20 拉取的 `origin/main@fae6333632010602506774b0648b639b70d25e22` 创建独立 worktree `octo-runtime-71-unified-sdk`，分支 `refactor/71-unified-sdk-services`。Codex App 的 worktree 创建工具在父目录返回 Not a git repository，已在实际仓库用 `git worktree add` 创建；原 main checkout 未修改。

读取 #71/#69/#66 和实际 SDK/Kernel/CLI 源码，建立[简报](../../tasks/unified-native-sdk-services/brief.md)、[设计](../../tasks/unified-native-sdk-services/design.md)、[迁移](../../tasks/unified-native-sdk-services/migration.md)、[验收](../../tasks/unified-native-sdk-services/acceptance.md)与 context。修正现行架构规则及相关规则的 launcher 推荐，明确区分基线事实、确定原则和待实施 API。

用户补充要求：CLI 服务进程与 Electron 主进程必须严格原生、直接构造服务，严禁外部 Node 代替启动。此要求已记录为[强制架构原则](../../rules/architecture.md#统一原生服务构造与部署边界)，并转为 PID/socket 和无外部 Node 的验收标准。禁止 startOwnedKernel 及换名、兼容包装或宿主 supervisor 等价替身。

内部 worker 只承担执行隔离，合法 Provider CLI 不在此次禁止范围。初稿将外部 Electron 打包/fuse 验证设为 M0 并据此给出 76 分，用户随后明确只评估 octo-runtime 库本身。现已纠正：复用既有内部 worker，以 CLI 直接加载公共 SDK 和包外 SDK 消费验证共同逻辑，外部 Electron 集成移出本次前置条件。库内方案可执行性重新评估为 92/100，现有执行分层合理，剩余重点是原生装配、统一 invoke 与清理迁移；禁止外部 Node 代启服务的要求保持。

本次只修改规划和规则；未改运行代码，未进行服务/Provider/IM/Electron 验证，未提交、推送、创建 PR 或发布。规划文档检查结果记录在任务 context，不能用其代表 22 项产品验收通过。
