---
type: Task
title: Issue 71：CLI 与 Electron 严格原生构造统一 SDK 服务
description: 删除 SDK 顶层进程启动特例，以同一套原生服务合同统一 CLI、Electron、Gateway 和 Playboard。
tags: [architecture, runtime, extra, lifecycle, ipc, invoke]
status: locally-validated
---

# 目标

依据 [Issue #71](https://github.com/Mininglamp-OSS/octo-runtime/issues/71)，让 CLI 服务进程和 Electron 主进程通过相同公共 SDK API，在调用进程内直接构造、初始化和关闭 Kernel 或 Extra 服务。服务 socket 必须属于该调用进程。SDK 不得启动外部 Node、Runtime CLI 或另一顶层服务进程来代替原生服务启动。

当前基线为 2026-10-21 拉取的 `origin/main@70f0247ac7dc00cc9729b366eba64ea8288b5b78`；独立 worktree 为 `octo-runtime-71-unified-sdk`，分支为 `refactor/71-unified-sdk-services`。旧分支改动仅作参考，最新 main 是协议与行为基准；#73 的共享 invoke、交互和调用登记以及 #72 的 Gateway 排空、失败确认、单调截止和 Node-only 约束均须保留，不重复实现。`134b98b`、`afeea70` 和 `8430836` 已推送至 [PR #74](https://github.com/Mininglamp-OSS/octo-runtime/pull/74)，尚未合并；当前类实例依赖整改和异步拒绝核验目标见[第四轮方案](remediation.md#pr-74-第四轮依赖容器与异步拒绝核验)，实际验证见[实施记录](implementation.md)。PR #70 已关闭，不作为实现或交付依赖。

## 解决的点

| 当前问题 | 目标行为 |
| --- | --- |
| `startOwnedKernel` 把 SDK 接入变成再启动一个顶层 Kernel | 调用进程直接构造 Kernel 服务，服务直接监听指定 endpoint |
| `startExtra` 必须经子进程 runner 装配插件 | 通用原生 Extra 服务承载初始化、状态和清理，Gateway 是其业务模块 |
| CLI 和桌面可能走不同装配及退出路径 | 两者使用相同工厂、配置和依赖形状、initialize/status/client/close 合同 |
| main 已通过 #73 统一 invoke 并删除 extra-port | 完整保留 main 的 KernelClient RPC 合同；原生服务内部复用已有调用登记，不再新增执行视图或组合 |
| 旧规则把进程所有权等同于服务对象所有权 | 明确宿主部署、服务生命周期、客户端连接、已接纳 Run 四种责任 |
| 以“功能能跑”代替架构验收 | 对实际 PID、socket 所有者、公开声明、行为一致性和真实 Electron 分别取证 |

## 关键合同

1. **严格原生构造。** `executor-kernel run` 的进程就是 Kernel 服务进程；`channel-gateway run` 的进程就是 Gateway 服务进程。Electron 主进程直接创建所需服务，不 spawn 服务替身。不得提供 `nodePath`、外部 Node 搜索/安装、外部 Kernel launcher、兼容包装或换名后的等价分支。
2. **服务与部署分开。** CLI 的 start/stop/restart/install/uninstall 管理独立系统服务；各自 run 入口调用同一 SDK。Gateway 只连接明确选择的 Kernel endpoint，不创建或关闭 Kernel。不把 CLI 合并成一个永久容纳所有服务的宿主进程。
3. **内部执行隔离单独定义。** Kernel 控制与 socket 在调用进程内，唯一 AgentExecutor 在内部 worker 中执行。worker 不监听 Kernel 服务 socket，不成为第二个 Kernel。沿既有内部执行隔离实现复用，不因外部宿主假设重新设计 worker。严禁外部 Node 代启服务；Provider CLI 子进程仍归 Adapter 的既有合同。
4. **普通调用共用 KernelClient.invoke。** 业务把 KernelClient 当作普通 RPC 工具，传入输入并消费结果，按需取消或响应交互；不需要服务构造、手动登记或 drain。保留最新 main 经 #73 合入的实现，不建立 Extra 专用执行层，不复制 submit/subscribe、ACK 查回、续流和取消组合；低层 IPC primitives 保留。服务托管和关闭归 CLI/App 装配入口。
5. **业务依赖显式注入。** Extra 保留 `extra(context, jsonConfig)(dependencies)`，函数与资源句柄直接留在对应服务进程中；配置来源和数据库归宿主。通用服务不增加 Bot、数据库驱动或 Gateway 专用字段。
6. **清理返回事实。** 失败启动必须回滚本次资源，close 可重复，未结束的依赖、未知接纳、未确认终态及未释放资源必须报告 incomplete。Extra 只取消和排空自己的 Run；SQLite 完全由宿主管理，SDK/Extra 不接管其创建、迁移或关闭。连接已有 Kernel 不取得该服务的关闭权限。
7. **保存现有状态。** 不改变 Home、machine/profile/runtime identity、凭据、配置和应用 SQLite 数据；不重置、不重新登记，不借入口迁移改业务默认值。Run 7、Context v3 与 IPC v1 继续分别版本化。

## 需求与责任检查

真实业务动作是宿主启动执行服务、接入 Gateway、调用 Agent 和退出自身服务。Runtime 团队负责共享 SDK 服务及执行合同；CLI 和 App 团队负责部署、配置来源及产品策略。显式输入包括 endpoint、worker 入口、已解析执行配置、Extra 模块/JSON 配置/函数依赖。本次修复首先发生在 SDK 服务装配层，CLI、Playboard 和示例随之迁移；不得要求消费方修补 Runtime 源码来适配错误启动模型。

不新增模型、模式、会话或历史默认策略。不新增业务重试或未知状态降级；既有 ACK 查回、原 Run 续流、worker 监督和容量约束按原合同保留。对其他宿主的公共 API 删除是有意的破坏性变更，发行说明必须列出迁移要求，不能隐藏在兼容 alias 中。

## 范围外

- 不实现 LoopDaemon、Go client、业务可靠投递或持久 Run 恢复。
- 不迁移消费者的业务数据库，不更改产品登录、账号或 Space 策略。
- 不删除合法 Provider 子进程，不把 direct Core 变成新的 CLI/Electron 服务接入分支。
- 提交、推送及 PR 合并已获用户后续授权，须满足仓库检查和评审要求；发布与部署仍不属于本次范围。
- 不进入外部 Electron 工程，不将其版本、打包、fuse 或真机联调作为本次库内开发前置条件；CLI 直接加载公共 SDK 是主要验证路径。

## 交付和验收

- [评审整改方案与证据](remediation.md)：基于 main@70f0247，已实施依赖有界收尾、WebUI/WeCom 公开入口及规则统一；本轮 C01-C12 验证见[实施记录](implementation.md#评审整改验证)，不沿用旧 tgz 结论。
- [库内合理性与可执行性](assessment.md)：当前方案 92/100；现有核心分层合理，SDK 装配需收敛。仅评估库内改造，分数不是实施完成率。
- [接口与服务/进程边界](design.md)：公共签名、两类宿主示例、内部 worker、状态及失败合同。
- [迁移清单与实施顺序](migration.md)：删除路径、所有调用方和 runner 装配迁移。
- [验收矩阵](acceptance.md)：每项的观察证据、命令和通过标准；未实施项保持未验收。
- [读取上下文](context.yaml)：实际规则、源码、issue 与证据来源。

规划阶段检查 OKF、索引、本地链接和 diff；实施完成后按验收矩阵执行跨包、真实进程和 Electron 验证。架构原则以 [统一原生服务原则](../../rules/architecture.md#统一原生服务构造与部署边界) 为唯一规范正文；本任务记录其具体设计与迁移。
