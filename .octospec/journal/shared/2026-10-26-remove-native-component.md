---
type: Journal
title: 删除外部组件启动器
description: 按用户追加要求删除 startNativeComponent，验证 CLI 与原生 SDK 服务及实际发行包。
tags: [architecture, lifecycle, sdk, testing]
timestamp: 2026-10-26T08:00:00Z
---

# 决定与删除范围

在 `codex/core-package-readmes` worktree 中，用户追加要求彻底删除 `startNativeComponent`，接入使用 CLI 或原生 SDK；任务记录见[brief](../../tasks/15-core-package-readmes/brief.md)，仍仅以 `Refs #15` 关联，不关闭 issue。当前架构规则覆盖历史任务中保留外部组件 API 的结论。

删除 Host SDK 的 `native.ts`、专属 `launch.ts`，以及包入口和主发行物 `/host` 中的 `startNativeComponent`、`NativeComponentOptions`、`ComponentStartError`、旧 `CleanupResult` 导出。删除两份专属测试和 Go/Node fixture，移除 CI 的 Go 安装与失效测试引用，并清理当前接入文档中的该路径；不保留兼容别名或替代启动器。

检查 CLI 和外部 octo-work-app 实际源码，两者的服务装配调用均为 `createKernelService` / `createExtraService`，没有调用旧启动器。保留 `ServiceCleanupResult` 及当前服务构造、close、worker 和 Provider 子进程合同。既有架构回归加入已删除标识符和构建文件的检查，并移除对旧 launcher 文件的进程启动豁免。

# 验证

- `pnpm test` 通过：先清理 dist 并构建全部 workspace；WebUI 测试通过；Node 测试共 1925 项，1871 通过、54 按条件跳过、0 失败。未在本机执行 Windows 专属验证。
- 构建后 `pnpm exec tsc -p tsconfig.json --noEmit`、`pnpm lint`、命名检查、`pnpm docs:check` 通过。首次 lint 与清理构建并发，因类型产物暂时缺失报错；构建完成后重跑通过。
- 对修改的公开导出、架构回归及 CI 文件运行 Prettier 检查，通过；`git diff --check` 通过。CI 中显式引用的 47 个测试路径全部存在。
- 检查构建后的主发行物 `/host` 和 Host SDK 真实导出：旧启动 API 消失，`createKernelService` 与 `createExtraService` 可用。
- `node scripts/pack-release.mjs` 打包成功；检查实际 tgz 不含 Host SDK 的 `native` / `launch` 构建文件，公开声明不含删除的四个符号。
- `node scripts/verify-release.mjs dist/release/mininglamp-oss-octo-runtime-0.0.0.tgz` 通过：离线安装、公开类型、文档示例、原生 Kernel、独立 Extra、内置 Extra、WebUI 资源、Gateway 宿主存储、状态与恢复探针、CLI Kernel，以及卸载保留 Home。使用未提交 worktree 产物，未声称 clean release。
- OKF 检查仍仅报告 README 阶段已确认的 7 个基线 frontmatter 缺失，详见[此前验证记录](2026-10-26-package-readmes.md#已有检查限制)。没有新增 OKF 错误。

未提交、推送或创建 PR；未修改 issue 状态。真实 Provider、IM 联调及外部 App 的打包真机运行不在此次验证范围。
