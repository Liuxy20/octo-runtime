---
type: Task
title: Issue 294：宿主原生装配 Adapter，统一 RPC 调用 Kernel
description: 以 Electron SDK 为核心模式，明确 CLI 装配责任、Kernel 调用边界及原生函数签名与实施验收。
tags: [architecture, adapter, runtime, ipc, lifecycle, documentation]
status: implemented
---

# 目标与状态

跟踪 [Issue #294](https://github.com/Mininglamp-OSS/octo-runtime/issues/294)。Electron 主进程原生 import 并构造 Adapter，再交给同进程 Kernel；CLI 是特殊宿主，自己读取模块 manifest、动态 import 后交付相同对象输入。所有普通业务调用通过 `KernelClient → RPC → ExecutorKernel → AgentExecutor → Adapter`，同进程也不旁路。Kernel 不负责模块 manifest，不启动执行 worker；Adapter 内部按 Provider 协议启动程序仍允许。

2026-11-02 用户已授权实施并修复错误架构文档，随后明确要求同步修复 CLI，将 SDK 接入页改为用途/签名表与具体例子，源码引入只简述 pnpm workspace + Git submodule。工作树基于 origin/main@58332b3bcf5651f58e674fa236184dc6a0d927ca，分支 codex/294-native-kernel-sdk-spec。当前实现已改为原生对象装配；用户后续已授权提交 PR 并在检查通过后合并 main，实际验证见[验证记录](validation.md)。

规则正文只维护于[基础架构](../../rules/architecture.md#sdk-原生装配与统一-rpc)。`createKernelService` 的[目标签名](../../rules/architecture.md#createkernelservice-目标签名)仅声明已确认的 `endpoint`、`adapters` 和服务返回类型；不是完整选项列表，也不是当前已发布 API。本轮不规定其他与装配边界无关的现有选项增删，不维护签名迁移表。

## 为什么需要这项改造

基线 `createKernelService` 在调用进程建立服务，但强制要求 `workerEntrypoint`；`startKernelServer` 创建 `WorkerSupervisor`，后者通过 `spawn(process.execPath, [entrypoint, ...])` 在子进程装配和执行 Adapter。模块清单 loader 也位于 Kernel 包中。宿主因而需要另外交付可执行入口，实际对象及其依赖不能作为原生对象注入 Kernel。

需求针对这个装配边界，不是删除 Kernel 或降低其稳定性职责。此前“同进程可以绕过 RPC、endpoint 因此可选”的解释不成立；当前目标继续使用本地 RPC 和现有 KernelClient。

## 决定权与职责

- 宿主决定所选 Adapter、版本、工厂参数、配置来源、依赖、Home/endpoint 和服务启停。CLI 的模块 manifest 是宿主数据，不是 Kernel 输入；已解析的模块路径也不是 Adapter 对象。
- Runtime 团队维护统一服务工厂、RPC、Run 接纳与观察、事件缓存、控制和清理。AgentExecutor 仍是唯一执行实现。
- Adapter 负责 Provider 原生协议、每轮执行、交互、取消和所属资源清理；宿主依赖对象的注入不把宿主数据库的所有权转给 Runtime。
- Extra 负责自己的业务输入、连接、投递与存储，通过独立 client 的 RPC 使用 Kernel，不持有另一套执行器、不关闭共享 Kernel。
- 本次不改变模型、权限、会话、历史或业务重试的产品策略。模块装配从 worker 移到宿主不授权自动安装、隐式选择 Provider 或重放已接纳 Run。

## 拓扑与所有权

Electron 的 composition root 是主进程；CLI 的 composition root 是对应组件服务的 run 入口。各自进程内包含 Kernel 服务、唯一 Core 实例和注入的 Adapter，Kernel 监听宿主选择的 endpoint。业务持有 KernelClient，通过本地 RPC 访问服务；服务 close 与 client.close 的含义分别保留。

CLI 可继续通过原生服务管理器部署独立 Kernel/Extra 宿主进程；SDK 工厂自身不再创建执行 worker。Extra 的宿主函数留在对应服务进程。允许存在的 Provider 子进程归 Adapter 的本轮资源，不是 Kernel 的另一份执行服务。

Kernel 的职责、允许/禁止案例和共享故障域见[架构案例](../../rules/architecture.md#装配职责与典型案例)。内部状态和遗留未确认清理记录不能因其旧实现名称含 manifest 而与 CLI 模块目录一起清空；模块配置读取和执行资源记录是不同职责，资源记录只接受 schemaVersion 1 且 nativeOwner/cleanupIncomplete 为 true 的原生格式；旧 worker 或损坏记录明确拒绝并保留原文件，不升级、不清理。旧 WorkerRpc、心跳、进程身份探测和 worker 恢复实现全部删除，不提供兼容层。

## 本轮范围

1. Kernel 原生接收 Adapter，保留 RPC、HostRunService 和唯一 Core；删除 worker launcher/supervisor/runner 和模块 loader。
2. CLI 自己解析/import/构造 Adapter，完成 OpenClaw 产品准备；常驻服务和 Playboard 使用相同工厂。配置文件读取也归 CLI。
3. 调整状态 Schema/生成产物、CLI 状态与日志、公开示例及现行架构；SDK 文档仅 API 表和使用例子，不规定唯一源码引入方式。
4. 将 worker 专属测试替换为原生对象、进程归属、初始化/关闭测试；迁移仍适用的 RPC、Provider、CLI 与原生客户端回归。旧监督/心跳/自动替换不再属于当前合同。
5. 本地验证并归档；按最新授权提交 PR 并合并 main，不扩大 CI。

## 实施与验证

PR 复审补齐交付：同步 packages/README.md 与 README.zh.md 的接入入口、拓扑、宿主加载责任和共享故障域；普通原生 SDK 接入仍推荐 KernelService/RPC。统一复核本 PR 迁移的验证脚本：SDK fixture 原生导入对象，重建 Kernel 沿用 fake Provider，每轮 Provider 环境显式传递，清理区分存活 SDK 宿主与 CLI 子进程。手动专项实际执行并记录，不加入 CI；修复后在 PR 新增英文评论并重新请求现有 reviewers 审查。

2026-11-02 用户追加决定：因该 GUI 接入基于逆向方案，彻底移除该 Adapter，不修补其 Electron 启动方式、不提供替代或兼容入口。范围包括包、默认 CLI 清单、workspace 依赖、UI 图标/名称、专属测试和当前使用文档；验收检查当前源码及发行包不再包含该实现，其他 Adapter 的原生装配和测试继续有效。用户随后授权 Playboard 人工停止直接强退本次进程树：它仅用于本地测试，无需引入通用 import 取消或启动状态机；执行入口负责强退，SDK 不退出宿主，正常完成仍回收。验收覆盖模块加载卡住、可识别后代终止、兄弟进程保留及现有执行/输出行为。

后续接入说明按用户补充拆章：原生 SDK 通过 kernel.client 使用服务，显式 attachKernel 用于跨进程独立应用连接已有 Kernel，CLI 客户端是其中一种；KernelService、ChannelGateway ExtraService、高级 dependencies 分章，AgentRun 调用/事件/控制另列可选使用页。高级示例覆盖 loadContexts、createSessionStore 和自定义 Extra。此次不统一新增所有 Provider 的专用工厂；当前内置 13 个 Adapter 中 8 个已有专用 create 工厂、5 个导出默认 ACP 实例。

具体顺序、Electron/CLI 流程及稳定性验收见[实施计划](plan.md)。与 [#293](https://github.com/Mininglamp-OSS/octo-runtime/issues/293) 的文档工作保持区分：#293 澄清已有 API，本任务改变目标装配合同；后续公开示例必须跟随真实实现，不提前宣称目标已可用。

规范阶段与实施阶段分别记录。代码实现、包外 SDK、真实 Electron、Provider 与平台验证分别登记；无真实执行的场景明确为 not run。禁止扩大 GitHub CI 范围。

本轮文档检查与交付边界见[规范阶段记录](../../journal/shared/2026-11-02-294-native-kernel-sdk-spec.md)。
