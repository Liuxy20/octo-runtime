---
type: Review
title: Issue 294 本地双轴审查与 SDK 接入章节修订
description: 按规范与需求分别审查原生 Kernel 迁移，记录两项生命周期修复及 SDK 文档分章结果。
tags: [review, architecture, lifecycle, sdk, documentation]
---

# 审查范围

2026-11-02，基线 `58332b3bcf5651f58e674fa236184dc6a0d927ca`，HEAD 等于基线，无新增提交。审查 `git diff 58332b3bcf5651f58e674fa236184dc6a0d927ca --` 及未跟踪的新源文件/任务文档，覆盖当前工作树。采用 code-review skill 的 Standards/Spec 双轴独立审查，再复核和修复；本地 brief、plan、架构规则及当前用户补充是需求来源。

## Standards

**1 项 P2，已修复：真实清理失败被活着的宿主掩盖。** 原生 Adapter finally 抛错后，`kernel.close()` 为 incomplete，但 `inspectOrphanCleanup()` 因 owner PID 仍活着报告 available。已实际复现 `cleanup:false, phase:failed, recovery:available`，违反“未完成的实际操作仍为 incomplete”的生命周期规则。

资源记录新增可选 `cleanupFailed` 区分运行中保守标记和已发生的关闭失败，保持 schemaVersion 1。Kernel 在共享关闭截止内登记失败；持久化错误不覆盖原错误。健康原生 owner 仍 available，真实失败显示 cleanup_incomplete；人工确认仍拒绝活 owner。最终按用户决定拒绝旧 worker 格式，不再保留旧恢复路径。回归覆盖正常、失败、旧格式拒绝和确认边界，见 [关闭测试](../../../test/host-process-close.test.js)。

未发现其他可确认的硬标准违反或值得单独阻塞的代码异味。RPC 分层和同进程对象注入属于明确架构要求，不按一般转发层异味删除。

## Spec

**1 项 P2 代码问题，已修复：关闭未等待实际在途的 probe。** 原生 `adapter.list` 经 Core 调用 `adapter.probe()`，原实现仅追踪 Run；`describe()` 超时后真实 Promise 仍可使用宿主依赖，而 close 已返回 complete。已用 gated probe 复现 `complete:true, probeFinished:false`，违反宿主依据清理结果关闭依赖的顺序。

Core 登记实际 Promise/thenable，describe 走同一 probe 入口；shutdown 在原预算内等待，仍在途则 incomplete，关闭后拒绝新 probe。保留 Adapter this、同步值/异常和 thenable 单次消费；正常拒绝会释放在途记录。probe 不属于 invocation，不伪造遗留 invocationId。回归见 [Kernel 测试](../../../test/kernel-invoke.test.js)和 [Core 测试](../../../test/executor-core.test.js)。

**1 项接入文档偏差，已修订。** 原 SDK 页并列 attachKernel 和原生接入，且把 AgentRun invoke 混进快速接入。原生宿主使用 kernel.client，Extra 内部管理自己的 RPC client。按用户最新澄清，显式 attach 用于跨进程独立应用连接已有 Kernel，CLI 是示例而非唯一宿主；不属于原生服务装配步骤。

文档现分为三个页面：

1. [SDK 服务接入](../../../docs/zh-CN/getting-started/sdk.md)：KernelService 与 ChannelGateway ExtraService 分章，只有服务装配、初始化、状态和关闭。
2. [高级依赖](../../../docs/zh-CN/guides/sdk-dependencies.md)：loadContexts 的内存/文件场景、createSessionStore 的宿主存储工厂、自定义 Extra 模型目录函数；明确 Gateway 仅声明两个公开依赖。
3. [可选 AgentRun 使用](../../../docs/zh-CN/guides/agent-runs.md)：invoke、事件、交互和取消，非接入条件。

Adapter 工厂盘点：13 个内置 Adapter 中 8 个已有专用 create 工厂；Hermes、Kimi Code、MCode、QoderCLI、QoderCLICN 导出默认 ACP 实例。本轮未把“是否全部已有工厂”的询问解释为新增工厂授权。

## 验证与边界

双语文档、示例类型检查、Core/Kernel 定向回归、构建、lint 和根类型检查已执行；最终全量结果见[验证记录](validation.md)。未执行真实 Electron、Provider、线上 IM 或原生 Windows/Linux 验证。首轮 review 时尚未提交；后续按用户授权提交并创建 PR #295，没有变更 CI 范围或发布。

## 删除旧架构后的复核

用户明确不提供兼容或升级后，再次交叉检查原生所有权记录、真实 RPC 测试、执行源接口和验证脚本。旧 WorkerRpc、心跳、进程身份回收及旧日志白名单全部删除；旧格式和损坏资源记录明确拒绝并保留原文件。原生异常退出的摘要确认、活 owner 拒绝、实际清理失败诊断继续有效。Spec 轴未发现新增可确认问题。

Standards 轴发现并修复 2 项 P2 验证脚本问题及 1 项 P3 文档偏差：IM 重试专项使用当前 KernelClient.invoke/cancelInvocation，保留取消跟踪；关闭失败仍执行 HTTP 清理并聚合原始失败和清理错误，未确认回收时保留工作目录；生命周期规则删除旧 worker 日志兼容声明。复核无新增发现。脚本仅做语法验证，不将这些修复标为线上 IM/真实 Codex 已通过。

Standards：1 项 P2 已修复；Spec：1 项 P2 代码问题及 1 项接入文档偏差已修订；当前没有未处理的已确认 finding。

## PR #295 的后续评审处置

yujiawei 对 `ba30c478` 提出 P1：该 Adapter JavaScript 启动依赖旧 worker 环境；P2：Playboard 动态模块装配等待不可取消。用户先要求只给建议，随后明确因该 GUI 接入基于逆向方案而彻底移除此特性及文档。本轮按产品删除处理 P1：删除完整包、CLI 清单与依赖、推理映射、WebUI 图标/别名、专属测试与双语使用文档，不补 Electron 启动模式、不保留兼容入口。当时 P2 按用户要求暂不实施；后续用户明确授权仅为本地 Playboard CLI 增加人工强退策略，详见验证记录。

交付检查覆盖共享测试仅删对应 Provider 分支、其余 Adapter 保留、workspace lock 无无关版本变化、当前源码和产品文档无残余引用；历史评审中的相关说明和链接也已删除。CI 只移除已删除测试的路径，不新增检查范围。实际验证见[验证记录](validation.md)。

## Playboard 人工强退复核

按用户追加授权，Playboard 作为一次性本地测试命令，在可执行入口定向强退本次进程树；不把动态 import 包装成可取消操作，不引入 worker，也不修改 Kernel/SDK 关闭合同。Standards 轴未发现新增可确认问题。

Spec 轴发现并修复 1 项 P1：初版在 runCli 返回后移除信号处理器，但清理失败时进程仍可能因 Provider 或其他句柄存活，此时 Ctrl+C 只退出 CLI、遗留 Provider。现将入口信号处理器保留到进程真正退出；监听本身不维持事件循环。使用真实 Adapter 的 finally 永不完成及独立进程组 Provider 复现后重验：先出现 cleanup incomplete，再次 Ctrl+C 输出强退诊断、退出码 130，Provider 已结束。

新增真实顶层 import 卡住并持有两层后代、清理失败返回后仍有子进程两项回归；确认无关兄弟进程继续存活。定向测试 28 项中 26 通过、2 平台跳过、0 失败。复核后无新增未处理 finding；Windows 原生控制台验证未在本机执行。

## 包级架构指南与验证脚本补漏

后续 verified-review 在 `dc561a64` 发现手动 SDK fixture 仍把无 sourceManifest 的模块声明交给 CLI loader；复现为初始化前失败。yujiawei 随后指出 `packages/README.md` 与中文页仍承诺独立 worker、替换恢复，并误导普通 SDK 使用裸 Core。此前审查没有覆盖完整交付清单，这两项均属于原需求遗漏，不能以生产主路径通过视为交付完成。

本轮同步两份包级指南的入口、拓扑、装配责任与故障域；普通原生接入使用 KernelService + kernel.client，CLI 自行读取 manifest，同进程 RPC 不提供宿主崩溃隔离或执行恢复。修复 5 个手动 SDK 装配入口及 2 个 Kernel 重建分支，保留原 fake Provider，补齐逐轮环境传递与 SDK/CLI 的 PID 所有权断言。

扩大本地审计到 scripts、test/manual、test-support 后，修正旧 attachKernel 文档断言、故意清理失败仍期待成功的断言、已入队响应被误判为审批过期的测试，以及将磁盘日志时间当作关闭预算起点的断言。关闭预算保持 7000 ms，改为记录实际单调时钟截止点；发送停滞仍验证失败、交互失效和 Provider 退出。实时脚本显式注入日志目录，并修正同 PID 的宿主报告。未改生产合同、CI 或默认测试范围。

完整本地手动专项 114 项通过、0 跳过；其余结果见[验证记录](validation.md)。线上脚本只完成静态检查，未宣称真实 Provider/IM 已通过。修复推送后以新增 PR 评论请求其他评审者重新审查，不能将本地复核当作批准评审。

用户进一步澄清 attachKernel 面向任何跨进程独立应用，不能限为 CLI。已同步架构规则、SDK/CLI/架构双语页、Kernel README 和 Gateway 接入指南；验证脚本不再要求原生 SDK 展示 attach 示例，跨进程示例保留在 CLI 章节。
