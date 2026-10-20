---
type: Task
title: ExecutorKernel、HostApp SDK 与独立服务生命周期
description: 联合规划 Issue 47、48 及 CLI、Extra 独立管理所需的 43、49 范围。
tags: [architecture, runtime, lifecycle, extra, ipc, planning]
timestamp: 2026-10-20T00:00:00Z
---

# 目标与本轮交付

从最新 `main@6fb8ca5364cd885f5617878e5ea4901f903de3ff` 建立独立 worktree，
分支为 feat/executor-kernel-host-lifecycle。初始交付实施计划和验收矩阵，用户随后明确开始实施；当前代码和本地验证结果见[实施记录](implementation.md)，线上架构来源核对状态见[对齐记录](architecture-alignment.md)。
用户要求联合处理 [#47](https://github.com/Mininglamp-OSS/octo-runtime/issues/47)、
[#48](https://github.com/Mininglamp-OSS/octo-runtime/issues/48)，并让 CLI 独立管理服务，
Extra 不再由原 daemon 承载和维护生命周期。

用户进一步明确：旧 daemon 可直接改名拆分，或删除重写。最终删除 apps/daemon、daemon 包、
旧 API 和命令，不保留兼容入口或双轨，也不开发旧 daemon 服务迁移工具。删除旧架构代码不等于删除用户 Home/身份/配置。

旧版安装策略：1.0.1 列为 deprecated，不支持从旧 daemon 升级或迁移。已有安装先停止并移除旧服务，再执行 `npm uninstall -g @mininglamp-oss/octo-runtime`，重新安装新架构版本并重新配置。npm registry 弃用标记属于发行操作，须单独记录执行结果。

计划将上述目标作为一条实施链：#47 提供 Kernel/TS 客户端/worker 监督；#48 提供原生
HostApp SDK；[#43](https://github.com/Mininglamp-OSS/octo-runtime/issues/43) 提供独立
Extra 入口；[#49](https://github.com/Mininglamp-OSS/octo-runtime/issues/49) 提供 CLI 服务编排。
规划范围包含这四部分，逐项保留 issue 归属，不因一个 PR 关联它们就宣称全部需求完成。

## 为什么需要与谁决定

| 范围检查 | 本任务结论 |
| --- | --- |
| 真实动作 | 原生 App、CLI 和第三方 Extra 共用本地执行服务；可单独连接、关闭客户端、重启 Extra，避免连带停止其他入口。 |
| 决定权 | HostApp 决定安装集合、版本、配置值、端点、启停和自启；Kernel 管连接与 worker；Core 管执行；Extra 管业务连接、准入、Context 和投递。 |
| 显式输入 | endpoint、已安装入口、完整配置、生命周期策略和本轮 InvokeInput；宿主函数通过明确依赖桥提供。 |
| 合同内动作 | 协议校验、有界流、故障检测、受管资源回收和真实状态报告；订阅修复只查回原执行。 |
| 最先需要修改的位置 | 旧 server 同时装配 Extra/worker，SDK 将账号生命周期与执行启动绑定，CLI 只有一个 daemon 服务；在这些所有者处拆分。 |
| 对其他产品的影响 | 保留默认隔离执行；direct 必须显式选择。不增加会话、模型、思考强度或业务 Context 默认策略。 |
| 自动动作依据 | worker 有界重启来自 #47；Kernel 恢复/自启来自宿主显式策略；不新增 Run 自动重放或隐式依赖安装。 |

## 规划时基线事实与目标差异

以下描述 main@6fb8ca5 的旧实现，不代表本分支当前结构；相关旧包与 app 已删除。

- #46 的 Core 抽取已由 PR #52 合入本基线；无需重新抽取执行实现。
- `packages/octo-runtime-daemon/src/server.ts` 目前同时创建 worker、HostRunService、modules 和 ExtraPlugins；现有 worker 重启循环没有整个故障周期的次数上限。
- `packages/octo-runtime-adapter-host/src/process.ts` 已有独立 worker、NDJSON、15 秒 readiness 和进程组清理，可迁移复用；尚不能据此宣称新 Kernel 已交付。
- `packages/octo-runtime-daemon/src/runtime/local-extras.ts` 已有 socket 执行桥，但依赖旧 SDK 装配。函数式 Extra 目前可运行在 SDK 所在进程，JSON Extra 则在 daemon 内加载。
- `apps/cli/src/service-control.ts` 当前构造单一 daemon 服务；`extraset` 保存后返回 `reload_required`，现行指南要求整体重启。目标是只重载对应 Extra。

## 关键合同

1. Kernel 独立于客户端存活，支持多个客户端；attach 不启动、安装或拥有 Kernel。
2. 默认链路为 `Host/Extra -> Kernel IPC -> worker NDJSON -> Core -> Adapter`。Core direct 是显式可选模式。
3. Kernel 不装配、不管理、不重启 Extra 或 LoopDaemon。HostApp/CLI 分别管理它们，Kernel 只监督自己创建的 worker。
4. 断订阅不取消 Run；显式取消回执不等于已终止；worker 丢失须保留已接受终态并真实报告其他在途调用的 lost/unavailable。
5. 重启只恢复后续可用性。禁止自动再次 invoke、补造 Provider session 恢复或持久接纳保证。
6. Extra 保留函数式入口、完整配置、onDispose/onStatus 和所属 invocation 边界；动态函数留在宿主，通过依赖代理或明确的模块入口使用。
7. 保留 Run 7、Context v3、权限审批、中央容量策略、现有身份、Home、profile、凭据、配置和 Provider 状态。
8. 同系统账号 IPC 互信及 OS 权限保持有效；endpoint 不是凭据。不得未经核验删除旧端点或终止非本次拥有的进程。

## 范围外与依赖

- [#51](https://github.com/Mininglamp-OSS/octo-runtime/issues/51)：共同冻结 wire 合同并交接 fixture；Go 客户端实现不放入本任务，也不作为 Kernel 开工条件。
- [#50](https://github.com/Mininglamp-OSS/octo-runtime/issues/50)：具名维护中宿主、正式发行与最终消费者迁移由该任务跟踪；本任务仍须完成自己的公开入口、临时 tgz 和 CLI/SDK 集成验收。
- 外部 Loop Go 业务、Fleet 编排、Loop 构建发布不在本仓实现；仅验证配置的原生可执行文件启动接口。
- #13/#30/#14 的启动回滚、有界关闭和平台要求按本次路径落实，不声称关闭这些 issue 的其他要求。
- 本轮没有 commit、push、PR、合并或发布操作；后续 GitHub issue/PR 和 commit message 按用户要求使用英文，保留配置作者及 Codex trailer。

详细阶段见 [milestone 计划](plan.md)，接口见 [design](design.md)，源码去向见 [changes](changes.md)，
具体验收见 [功能矩阵](acceptance.md)与 [测试步骤](test-execution.md)，可执行性复评见 [assessment](assessment.md)。
规则与读取来源见 [context](context.yaml)。
