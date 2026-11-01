---
type: Task
title: 每次 AgentRun 只读取一次宿主配置
description: 让同一次调用的 Provider 选项与流限制来自同一份配置，避免动态更新导致混用。
tags: [invocation, ipc, stream, testing]
timestamp: 2026-11-01T00:00:00Z
---

# 每次 AgentRun 只读取一次宿主配置

## 目标与已确认决定

用户已确认：一次 AgentRun 只读取一次配置，整次执行使用这一份；下一次 AgentRun 再读取最新配置。

对应 Loop ORT-40 与 [GitHub #136](https://github.com/Mininglamp-OSS/octo-runtime/issues/136)。用户已认可规格并授权实现；按用户要求先同步最新主线，实施基线为 `4a0f53b50723422d90f051944ae19eb28f60712a`（原规划基线为 `0bcd89c528018ffd508ca8099c8ac9c6b88de35d`）。分支为 `fix/136-configuration-snapshot`。实现及本地验证已完成，等待验证结果审查，见 [validation.md](validation.md)。

当前 `server.ts` 在 HostRunService 解析流限制时调用 configure，又在 transport.invokeFrames 中调用 configure 合并 Provider 选项。动态配置变化时，两次读取可能选中不同版本。已有流策略冻结不能解决两次取值不一致。

以上描述的是修复前基线。配置内容及更新时机由宿主决定，显式输入为 configurations/adapterConfigurations；Kernel 只负责同轮一致性、合法性及预算检查，不替宿主选择业务策略。执行拓扑仍为宿主进程中的 Kernel → 内部 worker → 唯一 AgentExecutor → Adapter；原有 socket、worker 与 Run 资源的所有者和公共 API 均不变。CLI、SDK 和 Extra 沿用相同 Kernel 路径，不增加单产品默认值。

## 关键合同

1. Kernel 接受合法 invoke 请求并确认 worker 可用后，在调用 HostRunService.submit 前读取本次配置。有 configurations 回调时，仅调用一次，传入本次 runMetadata.runtimeId；没有回调时不调用。该规则针对一次实际提交尝试，不保证被拒绝的请求完全不读配置。
2. 沿用现有配置选择：先取 configurations(runtimeId) 的结果，结果为 null/undefined 时回退 adapterConfigurations；再按 octo.execution/adapter.payload.type 选择，未提供字符串 type 时沿用 codex。动态结果存在但缺少目标 Adapter 时，不单独回退到静态同名项。
3. 快照包含本次选中 Adapter 的 providerOptions 与完整有效 streamLimits。先校验选项为字符串映射，并用中央 resolveStreamLimitPolicy 校验、补齐流策略；复制并冻结自有对象及其选项映射。不得修改或冻结宿主返回的原对象。未配置选项或流限制时沿用原有默认值。
4. 在自有输入副本中合并 Provider 选项：保留输入中未覆盖的项，宿主配置覆盖同名项。把快照流策略交给 HostRunService，并继续传给 worker；worker 队列、Adapter 接收、HostFrame 检查和重放窗口均使用这次策略。中央校验可在多层重复执行，但不得重新调用宿主 resolver。
5. 配置更新或原配置对象的后续修改，不影响已经取得快照的 AgentRun。连续及并发的不同 AgentRun 各自读取配置，不按 sessionId、runtimeId 或 Adapter 类型复用上一轮快照。订阅、重放、取消及交互响应沿用原调用，不重新取配置。
6. resolver 抛错、选项非法或流策略非法时，拒绝本次调用，不向 worker 提交 invoke，不启动 Provider，也不以旧配置兜底。错误沿现有 RPC 失败通道返回；本任务不新增公共错误码。
7. Provider 选项合并后，仍须通过整请求预算检查；实际 worker RPC 封装继续由发送端校验。超限沿用 INVOKE_REQUEST_TOO_LARGE，不能先按原输入通过检查后跳过合并产生的额外字节。
8. list/probe 保持原有独立取值行为，不消费或更改在途 AgentRun 的快照。公共 InvokeInput、Kernel IPC 版本、输出模式、默认容量及清理合同保持现状。

这里的“版本”是一次 resolver 返回的数据，不要求配置增加 revision 字段。测试可以使用自定义 Provider 元数据标识版本。

## 实施方案与范围

- 在 `packages/octo-runtime-executor-kernel/src/server.ts` 的 invoke 分支准备配置快照、合并输入，通过现有 submit(input, environment) 传递 streamLimits。移除该 server 装配中的二次 configure；transport 只转发准备后的输入和环境。
- 优先复用 HostRunService 已支持的 environment.streamLimits，不增加公共方法、wire 字段、按 Run 缓存或新的配置管理器。HostRunService 现有可选 resolver 兼容保留；如实现时发现必须改变公开合同，先更新规格说明。
- 核对 `rpc.ts` 现有选项校验，优先共享已有校验逻辑或沿用其语义；不重构无关 RPC。
- 就近补充中文注释，说明快照取值时机、对象所有权和传递顺序。
- 专项回归放在默认测试匹配范围外，例如 `test/manual/136-configuration-snapshot.mjs`，由显式命令运行；既有测试作为回归证据。

## 范围外

不调整动态配置的存储或更新机制，不增加配置版本协议，不改变真实 Provider 的认证流程，不实现 worker 重启后的旧 Run 恢复。不修改 GitHub workflow、job、矩阵、触发器、必需状态、既有 job 步骤或默认测试范围。不提交、推送或创建 PR；这些动作依后续授权执行。

## 验收

专项使用真实 Kernel/worker/client 与受控本地 Adapter，不调用真实模型或远程服务。通过结果必须同时包含配置观察、真实终态和资源回收事实，不能只统计 resolver 调用次数。

| 编号 | 场景 | 通过条件 |
| --- | --- | --- |
| A1 | resolver 每次返回不同版本；提交一个 AgentRun | 回调恰好调用一次；Adapter 观察到的 Provider revision 与有效流限制对应同一返回值 |
| A2 | 版本 1 限制 5120 字节，版本 2 限制 6144 字节；受控输出约 5 KB | 测试先测量完整 HostFrame 字节，保证其大于 5120 且不超过 6144；选中版本 1 时与固定版本 1 一样触发 HOST_FRAME_TOO_LARGE，选中版本 2 时与固定版本 2 一样完成；不能混用 |
| A3 | 第一轮开始后更新配置，再提交第二轮；另做并发交错 | 第一轮保持其快照，第二轮拿到新配置；每个实际提交尝试各调用一次 resolver，版本与限制始终配对 |
| A4 | 取快照后更改宿主原 providerOptions 与 streamLimits | 已开始调用不变；原对象没有被框架冻结，仍可由宿主修改；下一轮读取修改后的配置 |
| A5 | 静态配置、无配置、动态结果缺项、不同 runtimeId、选项重名 | 行为符合关键合同 2、3、4；宿主覆盖同名项，输入和宿主原对象均未被修改 |
| A6 | resolver 抛错、非法选项、非法流限制、合并后请求超限 | 该调用失败且 worker invoke/Provider 启动计数为零；后续合法调用仍能完成，兄弟调用不受影响 |
| A7 | 在途调用期间运行 list/probe，再订阅、取消或响应原调用 | 保持各操作现有合同；对原 AgentRun 的配置读取次数没有增加，不借取消 ACK 宣称执行或清理已完成 |

计划命令，均留待实现阶段执行：

```bash
pnpm typecheck
pnpm lint
pnpm lint:names
node --test test/host-stream-policy.test.js test/host-run-service.test.js test/stream-limits.test.js test/invoke-size-budget.test.js test/kernel-clients.test.js test/kernel-invoke.test.js
node test/manual/136-configuration-snapshot.mjs
git diff origin/main -- .github
```

专项脚本必须在 finally 中关闭所属 client、Kernel 和临时目录；按现有 cleanup 结果记录未完成的回收，不能吞掉回收失败。验证记录绑定实际 SHA、dirty 状态、平台与命令。Windows 原生运行和真实 Provider 未执行时分别标为未执行，本地 fixture 结果不能代替这些证据。

## 待决事项与可执行性

产品行为没有待决事项。实现阶段需核对现有配置校验函数的复用方式，并实测完整帧和请求封装的字节边界；这些由代码与测试确定，不改变“一次 AgentRun 读一次”的决定。

可执行性评分：97/100。剩余 3 分来自尚未完成的实现证据：配置校验复用核对 1 分，输出及请求字节边界实测 1 分，并发和关闭路径实测 1 分。评分表示实施准备度，不表示测试通过。
