---
type: Task
title: Issue 93 与 42 恢复缺口收敛规划
description: 基于已合并的恢复实现，补齐验收工具、部署合同、故障定位与 CLI 和 SDK 的真实恢复证据。
tags: [architecture, channel, ipc, lifecycle, testing]
timestamp: 2026-10-26T00:00:00Z
---

# 目标与当前交付

首轮交付为新增规划及其 verified-review 验证。基线为 `8af836068780ebb76581225254ad7bef18cc8170`，分支 `codex/93-42-recovery-plan`，独立 worktree 为 `octo-runtime-93-42-recovery-plan`。初始从当时最新的`a35aeae`创建，主线新增DSH集成后已快进同步并重新验证。随后用户提供受保护Bot账号文件与UK用户凭据，明确授权连接`https://im-test.deepminer.com.cn/`做端到端测试；据此新增恢复验证入口、使用真实Provider并执行测试消息。凭据及聊天正文不入库。前两轮没有提交授权；用户随后明确授权修复Low、提交、同步最新main及创建英文PR。交付当时纳入`main@78bb88a`，合并后验证基线为`0189eabb3d25fc07b3f9eb8b0e463d85a1c8a6d7`，该轮未修改产品逻辑。后续 token 修复及 `main@81284c9` 同步见下文和[审查整改](review-remediation.md)，PR 实际合并需另按用户指令执行。

[Issue 93](https://github.com/Mininglamp-OSS/octo-runtime/issues/93) 要求睡眠、断网和离线启动后，CLI 与原生 SDK 都能恢复新任务的完整执行链。[Issue 42](https://github.com/Mininglamp-OSS/octo-runtime/issues/42) 要求消除网络恢复后在线但无响应的状态，并验证消息接收、执行和回复。两者在本次读取时均为 OPEN。

[PR 96](https://github.com/Mininglamp-OSS/octo-runtime/pull/96) 已于 2026-10-22 合入 `a7eda0cd73f12313c88d65a05505ba4629b43290`。首次暂态离线重试、5/10/15/15 秒退避、挂起后的新心跳探针、worker 持续恢复和 Extra 状态日志已在主线。旧规划和自动化结果见[原任务](../93-sleep-wake-recovery/implementation.md)，不重新把这些能力列为待从零开发。

本规划补充原任务，保留原 A01-A27、S01-S14 编号及历史证据。新增合同见[设计](design.md)，逐阶段入口见[实施计划](plan.md)，可判定条件见[验收](acceptance.md)，准备度依据见[评估](assessment.md)，本轮实际结果见[验证记录](verification.md)。

# 产品意图与归属检查

2026-10-26 用户追加要求：review 意见须以产品架构核对，ACP、Codex、Claude Code 等逐轮执行以当前 Channel Bot 注入的 token 为准，优先于 CLI 默认身份。此次同步 `main@6bbbd91`，除测试工具隔离外，补齐普通执行覆盖的规范 `OCTO_TOKEN`，与兼容别名保持一致；不修改公共协议、服务拓扑、账号库或显式工具账号选择。OpenClaw 保留实例固定环境和人工重启的特殊合同，不扩展其 dotenv。CLI 最新 main 已实现环境优先，旧 v0.18.0 的文件优先缺陷只在验证工具内通过 trial 空目录兼容，不能冒充产品默认优先级修复。新增离线真实 CLI 回归分别验证两种路径，验证及版本依据见[审查整改](review-remediation.md)。

| 检查项 | 本任务决定 |
| --- | --- |
| 业务目标 | 普通睡眠及网络变化后，新消息恢复完成；连接状态与执行、投递状态分别可诊断 |
| 显式输入 | 宿主提供 endpoint、模块、Provider、配置与受保护凭据；专用测试环境提供部署 revision、测试 Bot 和频道 |
| 决定权 | Gateway 决定 IM 连接恢复；KernelClient 管理本地 RPC/观察修复；Kernel 监督内部 worker；Adapter 管理 Provider 传输；宿主/系统管理器管理顶层进程 |
| 合同内动作 | 修复最先违反合同的组件，保留原对象或原监听；新任务用新身份；旧任务只核对原身份和源窗口 |
| 越界动作 | Gateway 重启 Kernel、定时整服务重启、未知任务自动重提、静默 reset Provider session、抢回有效 owner、重建 Home/身份、增加聊天持久库 |
| 对其他接入影响 | CLI 和 SDK 共用修复；不要求原生宿主另写重连逻辑，不向 WeCom 或直接 Core 调用推广 IM 策略 |

CLI 拓扑为两个独立宿主进程，分别原生构造 Kernel 和 Extra；Kernel 内部 worker 执行唯一 AgentExecutor。SDK 宿主在调用进程直接构造同一公共服务，内部 worker 仍隔离执行。服务监听、WS 和内部计时器由各自服务拥有；应用数据库、Home、凭据和顶层进程由宿主拥有。关闭 attached client 只释放连接，不停止 Kernel。接口继续使用 `createKernelService`、`createExtraService`、`initialize/status/close`、`KernelClient.invoke`；不新增 launcher、业务 RPC 或逐 Bot 控制接口。

# 剩余工作与边界

1. 修复失效的 live 入口，并提供无外部连接的入口合同检查。
2. 取证部署 reason 12、在线过期和 ACK/replay 合同；对暂态与有效替换分别制定安全策略。
3. 复现原 Kernel 失败边界，按证据修复 listener、worker、Provider、观察或资源回收路径。
4. 执行两种模式各自的故障矩阵，记录真实 Provider、新 direct-Kernel 请求和新 IM 回复。

离线任务和长期 Context 连续性由 [#78](https://github.com/Mininglamp-OSS/octo-runtime/issues/78) 跟踪，本任务只验证实际 ACK/replay 边界及恢复后的新任务。[#30](https://github.com/Mininglamp-OSS/octo-runtime/issues/30) 的 graceful drain 是故障试验中的不退化约束，不宣称全部收尾需求已关闭。Windows 服务安装和树清理的既有问题分别由 #134、#131 跟踪，阻断对应试验时必须登记，不能用其他平台通过替代。

# 完成标准

规划完成：所有文件、依赖、分支决策、验证命令、通过条件和未知项可追溯，完成本轮文档审查。实现完成和 P0 关闭是后续门槛：必须满足 [G01-G12](acceptance.md)，尤其是部署合同、原事故定位和双模式真机证据。规划准备度达到用户要求的 95/100 不改变这些门槛。
