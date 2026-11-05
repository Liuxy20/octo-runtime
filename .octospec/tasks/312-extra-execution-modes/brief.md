---
type: Task
title: Issue 312：Extra 显式选择 direct 或 IPC 执行
description: 为宿主借用 Core 和连接已有 Kernel 定义相同的 Extra 执行合同、独立所有权及可验证交付步骤。
tags: [architecture, extra, lifecycle, ipc, invoke, stream, testing]
---

# Issue 312 需求简报

状态：**实现、验证及两轴审查完成，准备提交 PR**。来源为 [Issue #312](https://github.com/Mininglamp-OSS/octo-runtime/issues/312)。实现基线同步为 main `6fe5b5fc72084a0c2de91844a3606a9bc81e17d3`；用户明确暂缓 #313，先完成本专项验证，并授权使用 code-review 后提交目标为 main 的 PR。实际证据以[验证记录](validation.md)为准。

以下背景、目标和原计划保留决策依据；原规划 95 分已撤回，不作为实现或上线保证。#313 的 app-server 常驻和自动恢复仍未修复，不是当前 #312 交付的前置条件，也不宣称 direct 已解决该问题。

## 背景

嵌入式 Agent 平台可能已经拥有 Channel、WS、业务配置和进程生命周期。Core 已支持 `new AgentExecutor()`、`register(adapter)` 和直接 invoke，但 ExtraService 仍强制 `home + endpoint`、内部 attach Kernel，并只向插件提供 `context.kernel`。因此，想复用 Runtime Extra 的宿主仍必须引入 Kernel 服务及本地 socket，即使宿主已持有执行器。

这不是 Core 缺少执行功能，也不是放开端点独占的问题。真正缺口在 Extra 执行边界：裸 Core 与 KernelClient 的控制接口不同，iterator 关闭语义不同，Extra 必须独立拥有自己的调用并证明清理结果，不能关闭借用的执行器。

本基线刚合入 #306 的 Home 强校验；#294 的规则还要求同进程统一 RPC。#312 明确要求新增 direct 装配方式。本方案将这两处差异列为有范围的合同修订，不将 direct 描述为已经存在的能力，也不将 RPC 的恢复保证移植成 direct 承诺。详见[设计与规则影响](design.md)。

## 目标

1. 导出并严格校验精确 API：`execution: { kind: "direct", executor }` 与 `execution: { kind: "ipc", endpoint }`。
2. direct 使用宿主传入的同一 executor；不创建 Kernel、执行 socket、执行端点租约、Runtime Home、worker 或额外服务进程。
3. IPC 只连接指定的既有 Kernel，复用当前客户端；保留顶层 `endpoint` 兼容调用，并拒绝与 `execution` 混用。
4. Gateway、WeCom、WebUI 使用 `context.execution`，保留现有输入、输出、交互和业务策略。
5. 每个 Extra 独立管理准入、取消、交互、观察和关闭；关闭 A 不影响 B、宿主自有调用或借用的执行资源。
6. 在发布产物的包外消费者中证明接入可用，明确区分离线、真实 Provider、操作系统及外部 HostApp 的证据。

## 收益与代价

| 使用方 | 收益 | 可观察的交付依据 |
| --- | --- | --- |
| 已有 Channel 的嵌入宿主 | 保留自己的连接和配置，按需复用 Extra，省去仅为 Extra 新建 Kernel 的装配工作 | 不传 Home/endpoint 的 direct 示例初始化、执行及关闭成功；无执行监听与租约 |
| 多 Extra 宿主 | 显式共享或独立选择 Core；停止单个 Extra 时保留其他业务 | 同 Core 的 A/B/宿主调用并发隔离；不同 Core 同名 Extra 可共存 |
| 跨进程宿主 | 继续共享已有 Kernel 及现有 IPC 恢复逻辑 | 新 IPC 和旧 endpoint 调用行为一致；Kernel 不可达不拉起服务 |
| Extra 维护者 | 一份插件业务代码通过统一接口接入两种拓扑 | 三个内置 Extra 不再依赖 Kernel 专属执行接口 |
| SDK 消费者 | 用发行包公共路径接入，理解资源由谁关闭 | 隔离安装 tgz、严格类型检查及双语接入说明 |

direct 去掉一段本地序列化和 socket 调用路径，但本任务不承诺未经测量的时延、内存或吞吐提升。direct 与宿主共享故障域，不隔离同步阻塞、OOM 或宿主退出；Provider 可在远端运行。IPC 也不等于持久执行或自动故障转移。

## 产品意图与决定权

| 检查项 | 本任务边界 |
| --- | --- |
| 真实业务动作 | 宿主借用已拥有的 Core 组合 Extra，或让 Extra 连接独立托管的 Kernel |
| 拓扑、实例数量和关闭顺序 | 由宿主决定，不建立 Pod/Home 级 executor 单例 |
| 显式输入 | execution、module、config、dependencies；IPC 还保留当前 Home 合同 |
| Runtime 合同内动作 | 校验互斥配置、建立所属调用 scope、转发执行与控制、有限清理和真实状态 |
| Extra 自有动作 | 渠道准入、会话、WS 重连、任务过期、Context 准备及结果投递 |
| 越界动作 | 自动安装/启动 Kernel 或 Provider、复制 Channel、创建数据库、补造会话/产品默认、自动重跑未知调用 |
| 对其他产品的影响 | CLI 保持现有 IPC 装配；裸 Core API 与 Kernel endpoint 独占保留；第三方 Kernel 专属 Extra 走明确的 IPC 兼容路径 |

## 关键合同

- direct 以 executor 对象身份 + Extra name 去重；IPC 沿当前规范化 endpoint + name 去重。Home 不加入或替代执行身份键。可选 controlEndpoint 独占与执行身份是不同资源。
- direct scope 独立驱动已接纳 Core 流，插件 iterator 只观察。结束观察或 Channel WS 断开不得隐式取消执行；显式 signal/cancel、Extra close、既有任务过期仍可请求取消。
- 取消 ACK、执行终态、观察耗尽、业务投递和 Adapter 清理分别确认。direct 需要 Core 提供单次调用的清理凭据；不得用全局 `executor.shutdown()` 实现 Extra drain。
- 保留初始化回滚、close-before-initialize、并发/重复 close、依赖尾写及迟到资源回收。Extra 继续使用从首次关闭起算的 4 秒单调共享期限；不为新阶段重置预算。
- direct 状态报告执行种类与真实可接纳状态，不伪造 Kernel endpoint/instance/PID。Extra 自身的 `pid=process.pid` 继续有效。
- 只在 IPC 中暴露真实兼容 `context.kernel`。低层 submit/get/subscribe 不进入通用执行合同；第三方插件的类型迁移和能力限制必须明确。
- 本次不新增或变相扩大 GitHub CI。新增专项放 `test/manual/`，不加入默认测试选择器、已有 job、打包 gate 或必需状态。

## 范围与交付

本次规划交付：[设计](design.md)、[实施计划](plan.md)、[验收矩阵](acceptance.md)、[执行性评估](assessment.md)、[实际阅读记录](context.yaml)。实现阶段再更新当前规则、双语 SDK/Extra 文档、示例和验证记录。

范围外：Kernel launcher、Provider 安装器、executor 工厂、worker/thread、Pod 单例、持久回放、跨宿主迁移/容灾、文件/会话隔离、SQLite 实现、远程 Channel 协议适配、CLI 切换 direct、完整 #296 导出审计和完整 #309 客户端拆包。

## 依赖与完成定义

- [#296](https://github.com/Mininglamp-OSS/octo-runtime/issues/296) 尚未完成，当前主包只有 `/adapters/dsh`，没有 `/adapters/codex`。实现可先用内部导出验证，但不得据此宣布 npm 示例可运行。面向 #312 的 Codex 公共入口及产物验证必须在最终验收前就绪。
- [#309](https://github.com/Mininglamp-OSS/octo-runtime/issues/309) 尚未完成。当前复用 `executor-kernel/src/client.ts`；若实施期间客户端抽取先合入，则改用其共享实现，禁止复制第二份客户端。该 issue 中残留 worker 叙述不覆盖已合入的 #294。
- #293、#66 的文档和 Extra 边界工作需要协调，不以关联 issue 的状态代替本任务验收。
- 所有 [A01-A16](acceptance.md) 有结果及实现 revision 后才能宣布实现完成；目前全部实现验收为 **not run**。

方案可执行性自评 **95/100**，不是测试通过率或成功概率。剩余 5 分及可关闭条件见[评分](assessment.md)。
