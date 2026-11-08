---
type: Task
title: Issue 328：执行底座与独立渠道仓库拆分
description: 删除 Extra 框架和内置业务产品，将 Gateway 迁至独立仓库并以公开 client 接入。
tags: [architecture, runtime, extra, channel, installation]
---

# 目标与授权

需求：https://github.com/Mininglamp-OSS/octo-runtime/issues/328 。用户授权两个新 worktree、先 octo-spec 规划、可执行性达到 95 分后实施。Runtime 分支 `refactor/328-remove-extra`；Gateway 分支 `feat/328-standalone-gateway`。本次不提交、推送、发布或创建 PR。

Runtime 保留 Kernel/Core/Adapter/client/执行协议与必要的 Home、身份、CLI 运维。Gateway 独立 Git 仓库、构建和发布，只通过公开 client 调用已有 endpoint。产品策略、配置、凭据、会话和投递由 Gateway/宿主管理；Runtime 不扫描渠道、不规定插件 JSON、不新增渠道注册 RPC。

## 承重合同

- 保持 Kernel 接纳、取消、交互、有界恢复、终态和清理语义；不改 wire protocol，不删除 `protocol_mode: native`。
- Gateway 提供 `ChannelRegistry.register(endpoint, definition)`，definition 包含单 Bot 业务配置及可选函数，不要求 Extra JSON/schema；返回状态和异步 close 句柄。
- 每次注册拥有独立 attached client。先校验定义、连接已有 Kernel、构造渠道；失败回滚所属资源。close 先停接纳、在同一截止内关闭渠道和排空 client，最后关闭 client；保留失败事实、不停止共享 Kernel。
- 既有准入、会话、重试、交互与投递逻辑迁移；局部 shutdown/context/脱敏工具归 Gateway，不依赖私有 Host/Core/Kernel/Adapter SDK。
- Runtime 删除 `native/`、三个 Extra 业务包、Extra 定义/加载/配置/发现/命令/状态/执行 scope 及专属脚本测试。混合文件保留执行底座覆盖，不通过筛选绕过失败。
- 不删除用户 Home、身份、凭据和运行状态；旧 Extra 命令不再提供，不自动转换用户配置。
- 保留 runtime/client 双包自包含发行；Gateway 正式依赖发布 client，包外验证使用本次真实 tgz，不使用 workspace 或源码路径代替。

## 实施顺序

用户追加：同步清理 Runtime 相关文档。中英文入口、Harness 指南、Context/会话、IPC、交互与 Home 参考应描述执行底座；渠道配置、历史、投递和服务运维指向独立仓库。保留历史验证记录与迁移入口，明确其时效，不把旧 Extra API 当作当前接入方式。验收包含文档类型/示例/链接、双语配对及 octospec 检查；不变更执行协议或扩大本次代码范围。

用户补充：Gateway 按 npm 包交付，仓库含 `apps/cli`，保留 doctor/install/uninstall/start/stop/restart/status/logs、前台 run 与原有 configure/extraget/extraset 命令能力。独立命令名 `octo-channel-gateway`；允许旧 `channel-gateway` 命令层级，业务数据由独立 Home 管理。endpoint 显式指向已有 Kernel，系统服务定义必须保存 endpoint，不能隐式启动 Runtime。服务管理沿用原跨平台实现，归 CLI 私有实现，不新增执行依赖。CLI 配置是产品自身 JSON，不恢复通用 Extra 框架。

1. 两仓规范：Gateway 钉住相同 `Mininglamp-OSS/octo-spec@1.2.0` 和 revision，安装同步及 lint，记录 brief/context/assessment。
2. 迁移 Gateway 与渠道测试，删除 Extra 入口/命令，替换公开 client/protocol 依赖，实现 register 和失败/关闭测试。
3. Runtime 删除业务和框架，简化 CLI、manifest、日志、打包；保留 Adapter 装配、生命周期和执行。
4. 构建、类型、lint、回归、实际打包/包外接入，修复失败；同步规范和文档，记录验证与缺口。

## 验收

- 两仓可独立安装构建，Gateway 生产闭包无 Runtime 私有包或相邻 checkout 路径。
- Runtime 源码/依赖/default manifest/exports/发行包无 Extra 和渠道产品，native 专属入口移除。
- 包外 Gateway/client 消费覆盖执行、交互/取消、注册回滚、关闭隔离、重复关闭和失败事实。
- Core/Kernel/Adapter/CLI 适用回归保留；渠道测试迁新仓，专项手动、不扩大 CI。
- 两仓知识 lint 通过；真实 IM/Provider 和 Windows/Linux 无实际执行不记通过。

## 范围外

不新增远程 transport/认证、Kernel 渠道管理 RPC、持久队列、通用插件替代或 Gateway direct 模式；不迁移用户 Home。不建立 WebUI/WeCom 替代产品。规划评分不是实现或发布保证。

## 2026-11-08 追加交付授权

用户明确要求 Runtime 提交 PR 并合并进入 main。本次授权替代前文“未授权提交/推送/PR”的执行范围限制；允许提交、推送、创建 PR 和在仓库既有合并条件满足后合并。Gateway 仓库不在此次提交范围内；不发布 npm/tag，不修改分支保护或代替其他人批准。
