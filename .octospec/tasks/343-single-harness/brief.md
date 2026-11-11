---
type: Task
title: Issue 343：CLI 默认同类型 Harness 单实例
description: 修复配置分池设计，CLI 默认每种受管 Harness 一个实例，多 Agent 经同一 Engine 并发执行。
tags: [architecture, adapter, lifecycle, envs, mcp, testing]
---

# 目标与归属

来源为 Issue #343 及用户明确要求。初始基线 origin/main@4d7e272d；按后续要求 rebase 到 origin/main@bf665881095690fdfe3d2aca5796ca9f18e53bd0，独立 worktree issue-343-single-harness，分支 fix/343-single-harness。CLI 默认纳管的通用 Harness 同类型只有一个 owner/实例；这属于运行时资源所有权，业务会话、账户选择和材料仍归调用方。SDK 自管依赖不强加 CLI 装配规则。

## 关键合同

- CLI 宿主拥有 Kernel 和默认 Harness；Kernel/Adapter 借用，不取得共享 Engine 关闭权。同进程 Kernel 不制造另一个 OS PID。
- 一个 Codex owner 只监督一个 app-server，故障恢复先回收旧代再替换；不按 cwd、环境、MCP、模型、容量或并发数量创建新实例。
- Codex 进程使用宿主固定环境、CODEX_HOME 和启动目录。每轮 cwd/model/effort、shell/MCP 环境、HTTP headers 和容量经原生 thread/turn 配置传递，不修改 process.env 或用户配置文件。
- 显式账户等强隔离由 SDK 宿主创建独立 owner，CLI 默认不引入多账户配置或自动分池。旧逐轮 codexServiceRevision 不再创建进程，明确拒绝。
- 并发接纳和资源配额由宿主决定。移除固定八路、启动等待人数、累计 thread 数和交互总数限制；不按 Agent 数量或估算 lease 内存设接纳门槛，不增加进程，不重放执行。取消、审批、恢复、关闭只影响其原有归属。

## 范围与越界

修改默认 CLI 装配约束、Codex owner/协议配置、诊断及当前文档。保留其他 Adapter 的原生构造签名和逐轮子进程模型，不新增统一 Engine 基类或平台注册框架。不改账户/认证文件，不重启用户现有运行时，不提交或发布；不扩大 GitHub CI。

## 验收

显式手动专项：100 路不同 cwd、环境/MCP/容量请求同时活动，单次 spawn、单 PID、独立线程与正确响应；交叉审批、取消与兄弟存活；2200 个并发 lease 与同进程累计 5000 个 thread 不受人为接纳门槛限制；借用 Core 关闭与 owner 最终回收；显式多 owner 隔离；CLI 重复类型拒绝及诊断。真实 Codex 验证逐轮配置及并发，实际场景与未验项分开记录。

运行 build/typecheck、lint、相关回归及全量既有离线测试；OKF lint、双语文档检查和目标分支 workflow/默认测试选择 diff 核对。100 路专项仅手动运行。

追加执行 code-review 双轴独立审查与 verified-review 的逐行、运行验证；发现问题直接修复并寻找同类问题。rebase 后按 main 的 AgentEnv 直传合同适配调用方，并重新运行受影响验收，不将旧基线结果当作本轮结果。

按用户后续要求补充双语 docs 的私有 bean 构造和 Adapter 消费示例；为 agentEnvItem、invocationModel 补齐中文 JSDoc、读取/校验责任及参考文档地址。本次追加仅涉及文档与注释，不改变 helper 行为，不新增公共私有配置模型。

用户再次明确删除完整包 `/adapters/codex`、`/adapters/dsh` 聚合导出，纯原生统一源码 workspace 接入，按需依赖和加载所选 Adapter；源码 private 包不单独 npm 发布。另一主场景为 octo-runtime CLI 启动服务，独立 App 只用 octo-runtime-client。同步迁移示例、包 README、编写规则、现有发行检查调用点，并在双语 docs 明确依赖、模块加载、进程启动和生命周期责任；不把当前 CLI 的全 manifest 装配说成按请求加载，不移除其内置发行依赖。检查旧架构说明并按同类问题直接修复。

PR #345 首轮 CI 暴露把 CODEX_HOME 绑定为 spawn cwd 的错误。用户再次明确：启动 server 不传业务 cwd，session 工作目录由 thread/turn RPC 提供；CODEX_HOME 默认 ~/.codex 与此无关。修复 managed spawn 省略 cwd，自然继承宿主目录；不补建数据目录、不改 Home 默认值、不改请求目录映射。提交修复后等待全部现有 CI，失败继续处理，禁止自动合并。
