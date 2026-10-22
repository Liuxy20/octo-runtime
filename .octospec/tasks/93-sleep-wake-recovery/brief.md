---
type: Task
title: Issue 93：CLI 与原生 SDK 睡眠和网络恢复
description: 分离 Gateway 连接与 Kernel 执行故障，形成可执行修复计划及双模式验收合同。
tags: [architecture, lifecycle, channel, ipc, stream, adapter, testing]
timestamp: 2026-10-22T00:00:00Z
---

# 目标与当前状态

针对 [Issue #93](https://github.com/Mininglamp-OSS/octo-runtime/issues/93)，使有效配置的 CLI 与原生 SDK 在普通睡眠、断网、网络切换及离线启动后恢复新请求的完整执行链。恢复覆盖 IM 接收、Kernel 接纳、worker/Provider 执行和回复投递。

用户已授权实施、分阶段英文提交、push和PR；当前交付为 [PR #96](https://github.com/Mininglamp-OSS/octo-runtime/pull/96)。最新要求由用户手动merge，Agent只跟进评审、修复和CI，不得合并或发布。规划可执行性自评 **95/100**，口径及扣分见 [assessment.md](assessment.md)。它不表示根因已全部确认，也不表示实机验收通过；当前进度与证据见 [implementation.md](implementation.md)。

初始基线：`origin/main@3b34415ca2a2297d48a1cec0458b15d52df9ab55`；现已rebase到 `d076474673b1aac542b08940d987c5598e5a4968`。分支：`plan/93-sleep-wake-recovery`。任务目录中的方案保留规划合同，逐项实施、实际证据和未完成边界以实施记录为准；其他任务的历史通过记录不作为本任务证据。

## 产品意图与决定权

| 项目 | 本任务约束 |
| --- | --- |
| 业务目标 | 笔记本恢复联网后，用户继续使用同一 Bot 和 Runtime，无需手动重启 |
| 显式输入 | 宿主选定的 endpoint、模块、配置、凭据、Provider 和生命周期；不猜测其他 owner |
| Runtime 负责 | 各层传输、观察、worker 监督和资源生命周期在共同实现内恢复 |
| Gateway 负责 | IM 建联、重连、渠道准入、会话映射、错误展示及投递 |
| 宿主负责 | OS 用户服务、自启、宿主进程启动/退出、配置来源及业务数据库 |
| 越界动作 | Gateway 重启 Kernel、SDK 代启顶层 CLI/Node、自动重跑未知 Run、重建身份或数据库 |
| 其他产品影响 | SDK 获得相同恢复行为；不将 CLI 文件、自启或安装约定推广给 SDK；WeCom 不自动继承 Octo 投递策略 |

## 关键合同

1. CLI 两个独立服务进程与原生 SDK 直接导入同一 `createKernelService` / `createExtraService` 实现。内部 worker 仍是唯一 AgentExecutor 的隔离层。
2. 恢复暂态 IM 故障包括首次离线启动；用户要求退避为 **5/10/15/15…秒**。终态认证、身份和所有权拒绝保持诚实、无接管循环。reason 12 按部署证据分型，不能只改一个 `retryable` 布尔值。
3. 新请求可用性与旧 Run 观察分开。只在原实例、身份、窗口和连续游标合同内恢复观察；未知接纳不重新提交，lost/unknown 不伪造成功。
4. 暂态恢复不关闭宿主服务对象、不更换 Runtime Home/身份、不要求 SDK 宿主再次 initialize、relaunch 或编写另一套重连逻辑。
5. 保持 Run=7、Context=v3、IPC v1 的既有合同。若新增 wire 状态字段，M4 同步 schema、生成类型、校验器及消费方，不手改生成文件。
6. 暂定实测门槛为依赖恢复后 180 秒内恢复新请求链路，精确定义见 [design.md](design.md)。该值是本修复的建议验收目标，不能当作当前产品 SLA。
7. 用户追加要求 `octo-runtime channel-gateway logs` 查看 **Extra 工作状态**；状态事件同时输出 stdout 并有界留存。排除聊天内容、模型/工具输出及具体会话信息，见设计 D2。

## 范围与交付

交付 [源码分析](analysis.md)、[修复设计](design.md)、[里程碑](plan.md)、[验收矩阵](acceptance.md)、[准备度评估](assessment.md) 和 [读取上下文](context.yaml)。CLI、SDK、macOS、Windows、Linux 的证据分开记录。

范围外：持久化聊天/模型历史、完整离线消息补偿体系（#78）、新建业务重试引擎、统一云端设备寻址、引入原生 supervisor、外部 Electron 打包改造。断网期间消息的现有 ACK/replay/dedup 合同必须调查和验证，不能因 #78 在范围外而忽略重复执行或丢失事实。

## 验收与实施入口

按 [plan.md](plan.md) 的 M0 开始；M0 先取得单 owner 的 reason-12 部署依据和故障现场直接 IPC 结果。M1 可先建设受控故障工具，M2 可先修复已确认的首次离线启动缺口；reason-12 自动恢复分支及 M3 的根因修复须满足各自证据门槛。

共享层修复、受控CLI/SDK试验和状态日志已实施验证；Windows新增测试选择正在按P3补充。原事故两层故障边界、部署reason12语义和S01-S14真实矩阵仍未完成，不关闭P0。具体结果见 [implementation.md](implementation.md)；基线仓库知识lint的既有失败见 [assessment.md](assessment.md)。
