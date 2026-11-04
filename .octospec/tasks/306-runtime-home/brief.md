---
type: Task
title: "Issue 306：宿主提供并准备 Runtime Home"
description: "统一 SDK 启动前的 Home 校验，CLI 独立选择根目录，保留结构化启动失败。"
tags: [architecture, runtime, lifecycle, ipc, testing]
timestamp: 2026-11-04T06:00:00Z
slug: 306-runtime-home
source: self
upstream: "https://github.com/Mininglamp-OSS/octo-runtime/issues/306"
---

# Issue 306：Runtime Home

## Goal

Home 选择和根目录准备属于宿主。SDK 原生服务要求显式、已存在、可用的绝对目录，在任何日志、身份、所有权或监听副作用前校验；不提供平台目录策略或替代根。

## Background / 产品意图归属

基线 main e7958065a250e8ed0986715e4a3fb07a70d885e9。Issue 306 正文是当前决定，无评论及开放关联 PR。旧 helper 的 resolve 可将空/相对路径变为 cwd，homePaths 未检查目录，ensureHostHome 创建根；未发现父目录回退。目录产品策略最先越界于 SDK helper，启动验证在服务边界缺失，应在这两处修复。

宿主显式输入 home、endpoint 与 Adapter/Extra；SDK 只做合同内路径、资源和 IPC 校验。CLI 是独立宿主：--home 优先，否则统一用户 ~/.octo-runtime，负责准备根。移除 SDK appId/平台目录选择，不改变宿主自己的产品目录选择。此决定来自 #306，不从某个产品默认推广到其他宿主。

## Load-bearing list / 拓扑与所有权

- runtime/lifecycle：createKernelService 和 createExtraService 在调用进程原生构造；initialize 校验 Home 后进入同一生命周期，ServiceInitializationError 保留具体 cause 与 cleanup。
- ipc：业务仍通过 KernelClient/RPC；保持当前 sockets/octo-runtime-<component>.sock 与 Windows hash pipe。底层 endpoint-only API 无权推断 Home，单独校验地址并说明责任。
- storage：SDK 不创建 Home 根，不重置身份、配置、凭据或 profile；仅创建已验证根内所属资源。CLI 显式准备根。
- public API：服务增加必填 home，公开示例、调用方和包外类型同步迁移；不保留 SDK 选择 Home 的 helper。
- length：按文件系统路径及附加文件名、实际传输地址、UTF-8 / UTF-16 编码预算验证；模拟平台计算与真实 bind 证据分开。

## Out of scope

- #303 的 endpoint 布局/旧端点迁移，#304 完整诊断目录，#14 总验收。
- CI workflow/job/matrix/trigger/gate/default selector 扩展。专项放 test/manual 显式执行。
- merge、发布、其他 issue 的状态变更；真实 Bot 或 Provider 账号。本次交付包含提交、推送及关联 #306 的 PR。

## Acceptance

- 公共启动入口缺失/空/相对/~、不存在、普通文件、权限、长度失败先于资源副作用；无替代根。
- 有效中文空格目录直接使用；Windows Node 24/26 真 Kernel initialize/close 与 CLI 准备验证。
- IPC 与附加文件名预算有边界专项，诊断包含 code、path、resource、operation、host action、测量和限值，wrapper 保留 cleanup。
- 构建/typecheck、lint/format/names、相关回归、包外 SDK 类型/运行、知识 lint；真实未覆盖平台明确列出。

## PR 310 CI 复核

首轮 Actions run 41795217323 在 Ubuntu/macOS 暴露跨平台边界：CLI 数据路径对象和配置/Playboard 命令提前计算不使用的常驻 IPC；可选日志的 ENOTDIR 被文件系统预算查询升级成致命 Home 失败；OS getconf 受 Provider 专用 PATH 影响。修复要求只在真正消费常驻 IPC 时校验端点、保持 F31 best-effort 日志合同、固定 OS 查询工具来源，并让合法端点测试使用满足预算的目录。保留 Home 根和实际服务绑定前的严格验证，不修改 CI 或默认 selector。
