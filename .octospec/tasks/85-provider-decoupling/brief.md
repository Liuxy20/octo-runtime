---
type: Task
title: Issue 85：CLI 与 SDK 的 Adapter/Extra 按需装配
description: 解除框架与具体模块耦合，SDK 原生导入，CLI 合并内置与 Home 扩展 manifest。
tags: [architecture, adapter, extra, installation, runtime]
status: locally-validated
timestamp: 2026-10-21T00:00:00Z
---

# 目标

依据 [Issue #85](https://github.com/Mininglamp-OSS/octo-runtime/issues/85)及用户后续明确要求，同时处理 Adapter 与 Extra。用户已授权在本 worktree 实施，产品代码与本地回归已落地；验证范围见[实施记录](implementation.md)。

| 接入方式 | 模块选择来源 | 责任 |
| --- | --- | --- |
| 默认发布 App / CLI | `apps/cli/src/manifest.json`，加上 `<Home>/manifest.json` 扩展 | 默认发行保持全量；CLI 负责合并、校验与按需加载 |
| SDK / Electron App | 宿主接入层原生 import 和显式装配 | 不读取、不复制、不生成临时或永久 manifest |
| FDE 交付 | 业务方自行复制所需代码并处理依赖 | Runtime 不制定复制目录、安装方式或交付工具 |

两份 CLI manifest 均有 adapters 与 extras 数组。默认 Home 为 ~/.octo-runtime，指定 --home 时使用该 Home 下的 manifest.json。现有 apps/cli/src/default_adapters.json 的内容迁入统一清单，不维护两份默认目录。

起始基线为 origin/main@d064cfe78f6818d3c451ecf803a280245f4b0496；实施后更新到 main@318b0f2，交付分支为 fix/85-provider-decoupling，独立 worktree 为 octo-runtime-issue-85。原规划分支名为 spec/85-provider-decoupling。

## 关键合同

1. Kernel、Core、Host SDK 不依赖具体 Provider 或业务 Extra；共享 Adapter SDK、Protocol 等依赖允许保留。完整默认依赖属于 App/CLI 装配层。
2. SDK Adapter 在宿主选择的 worker 代码中原生 import 并注册，App 原生创建 Kernel。Extra 在宿主服务进程原生 import 后传给 createExtraService。跨进程只传 worker 入口，不传实例或函数，不借 CLI 或外部 Node 代启顶层服务。
3. CLI 的内置 manifest 管默认模块目录，Home manifest 追加用户模块。合并规则为内置优先：Adapter 按 type、Extra 按 name 去重；同名扩展提示忽略，忽略项不 import、不调用工厂。同一份文件中的重复键报错。
4. 每个条目的相对路径和裸包名都以其原始 manifest 文件位置为锚点；合并不能丢失来源。裸包按默认 ESM node/import 条件与 exports 解析，不以 cwd 或 Kernel 位置兜底。
5. manifest 声明模块集合，不保存密钥或宿主函数，不代表所有 Extra 自动启用。Extra 业务配置与 enabled 仍由 CLI Home 配置管理；每个 Extra 独立生命周期，Kernel 不加载 Extra。
6. 未选模块不解析、不导入、不探测。已选 Adapter 保留现有 probe/握手行为；本任务不重构就绪协议。缺少实际需要加载的模块、坏导出、类型/名称不符及重复注册必须明确失败。
7. 用户扩展清单缺失表示无扩展，损坏明确报错。adapters=[] / extras=[] 表示该来源没有条目，不回退为全量；默认完整清单仍来自 CLI 内置来源。
8. 保留 Run=7、Context=v3、公共 IPC v1、invoke、取消、排空及资源所有权合同，不自动安装模块、不热加载、不重放业务调用。
9. 在 docs/en 与 docs/zh-CN 维护等价说明，并将装配责任写入整体架构约束；以实施记录说明实际验证结果与未覆盖范围。

## 现状与责任检查

基线 Kernel 直接依赖 12 个具体 Adapter，Host SDK 因而继承全目录；本次将具体模块依赖归还 CLI。SDK 复用 serveWorker、createKernelService、createExtraService 的原生 import 接入。CLI 的旧 Adapter JSON 已合并为 Adapter/Extra 统一 manifest；Home 配置保留业务参数，旧 module 字段按显式迁移规则处理。

业务方决定选择哪些 Adapter/Extra、如何复制和部署，以及如何取得配置。Runtime 应维护正确依赖方向并忠实执行显式选择，不能把默认 App 全量集合变成所有宿主的依赖或启动前提。CLI 自己的默认值不扩散到 SDK。

服务 socket 和 Kernel 对象归调用进程；内部 worker 拥有唯一 AgentExecutor 和 Adapter 实例；Extra 在宿主进程独立创建并管理自身业务资源，不关闭共享 Kernel。宿主数据库与业务依赖仍归宿主。

## 范围外

- FDE 业务工程的复制、打包、安装及依赖处理工具。
- 拆分 npm 产品、发布 private 包、自动下载、运行中热加载或重构 probe/就绪。
- 改变业务模型、会话策略，重置 Home、身份、凭据或数据库。
- npm 发布。本地审查、Git 提交、推送、PR 和合入 main 已由用户后续明确授权；遵守仓库 required checks 和审批保护。

## 交付入口

- [设计](design.md)：两种装配、双清单合并、解析与 Extra 配置迁移。
- [实施与验收](acceptance.md)：按变更范围验证两条加载路径及默认全量发行。
- [实施记录](implementation.md)：变更、A01–A17 证据与验证边界。
- [本地审查](review.md)：Standards/Spec 发现、修复与复审证据。
- [读取上下文](context.yaml)和[本轮记录](../../journal/shared/2026-10-21-provider-decoupling-plan.md)。
- 双语设计：[中文](../../../docs/zh-CN/concepts/module-loading.md) / [English](../../../docs/en/concepts/module-loading.md)。
