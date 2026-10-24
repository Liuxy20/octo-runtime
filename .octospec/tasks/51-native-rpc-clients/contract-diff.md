---
type: Design
title: Issue 51 实施合同对照
description: 记录八方法和 InvokeInput 字段的 Schema 落点、生成边界及尚未完成的差异核对。
tags: [protocol, schema, native, ipc]
timestamp: 2026-10-24T00:00:00Z
---

# 数据与方法

`protocol.schema.json` 补 `ModelInputParts`、`InvokeInputWire`、`KernelInvokeEnvironmentWire`、`InteractionResponseWire`、`HostedAdapterMetadataWire`。`kernel-ipc.schema.json` 补具体 params/result、成功/错误/通知 envelope 和 `x-octo-methods`；`BusinessErrorCode` 保持开放字符串，已知列表单列。Run 7、Context v3、IPC 1 未升级，未修改 TS 执行/服务所有权行为。

| 方法 | 生成 wrapper 与业务入口 | 真实 IPC 证据 |
| --- | --- | --- |
| status | RPCStatus/status | Go/Python demo status、invoke admission |
| adapter.list | RPCList/list | demo list、包外消费 |
| agent_run.invoke | RPCInvoke/submit/invoke | native/canonical、丢 ACK 后原身份 get |
| agent_run.get | RPCGet/get | 独立终态、原 ref/instance 核验 |
| agent_run.subscribe | subscribe 拉取流 | 连续游标、两次断流恢复、原生与 canonical |
| agent_run.cancel | RPCCancel/cancel/cancel_invocation | deadline、显式取消、ACK 丢失 |
| agent_run.respond | RPCRespond/respond/respond_interaction | canonical 交互、ACK 丢失、第二 CLI 回答 |
| agent_run.native.respond | RPCNativeRespond/respond_native | 原生交互、Codex request/pending 去重、ACK 丢失 |

命名大小写遵循各语言；实际生成名称见 `octo_runtime_generated.go` / `octo_runtime_generated.py`。subscribe 的 ACK 之后没有默认 idle deadline；副作用 ACK 不确定不能自动重发。

# InvokeInput 字段

| 字段组 | Schema 落点与约束 |
| --- | --- |
| inputs、freshFallbackModelInputParts | ModelInputParts → ModelInputPart；非空、有序，沿用图像/文本公开形状 |
| contexts | ContextEnvelope；Context v3、扩展、深度/体积和固定 payload refinement |
| sessionId、invocationId、runId | 可选非空字符串；缺省身份由客户端明确生成并贯穿原查询/回执 |
| protocol_mode | ProtocolMode；native/canonical，缺省 native |
| sessionGeneration、providerEpoch | 非负 safe integer；上限 9007199254740991 |
| agentSource、approvalMode | 既有枚举；SDK 不扩大权限 |
| prompt、modelInput、freshFallbackModelInput | 可选非空字符串 |
| workdir、controlInstructions | 可选字符串；不从宿主目录猜测业务意图 |
| agentConfig | 既有 AgentConfig；wire 补 timeoutSeconds > 0；禁止旧权限/思考字段的既有 Schema 约束保留 |
| runtimeLimits | RuntimeLimits；完整 runtime settings |
| runMetadata | 开放 JSON object，不作为权限/模型历史依据 |
| providerSession | ProviderSession 保留扩展；wire 补 sessionId 的 JS trim 非空语义，保留完整会话对象 |
| continuityMode | fresh/continue；不自动恢复历史 |
| freshFallbackImagesUnavailable | 可选 boolean，false 与缺省分开 |
| environment.executionEnvOverrides | ContextEnvsPayload；位于 IPC params，不放进 InvokeInput |
| signal、executionEnvOverrides 等旧入口字段 | InvokeInput wire 禁止；signal 是各语言本地取消对象，不序列化 |
| environment.streamLimits | advanced submit 拒绝 KERNEL_STREAM_LIMITS_UNSUPPORTED；不假装已透传 Kernel |

新增 `native-invoke-fixtures.json` 的 6 个正反样例由 TS `InvokeInput.check` 和Go/Python规则共同执行，覆盖正/零/负 timeout，以及空/空白/非空 providerSession ID。连同原 Context、runtime-selection、Run 和 IPC 样例合计 354 个（含后续 URL 和 Context 字节边界回归）。

# 生成与手写边界

生成器读取完整 Schema，先编译并拒绝未知关键字，再写产物。模型、规则表/函数、8 方法声明、行为常量来自 Schema/behavior；高层客户端与生命周期在各语言包内单份维护。平台 socket/pipe、JSON 原语、命令行 UI 和测试驱动手写；安装包不读取 Schema，不运行生成器。

`kernel-client.behavior.json` 固定请求/接收字节、连接/登记/控制/查询额度、恢复次数与 deadline。TS 目前仍使用自身既有常量；未完成自动比较 TS 常量和行为文件的全量断言。Python Windows 使用 overlapped event 有限轮询替代规划中的 executor 等待，减少阻塞线程；仍需 Windows 实机验证 completion、重复取消和 handle 清理。

# 未闭合的合同审计

这份表不是“全部字段与 TS checker 已逐分支等价”的结论。尚需审计完整 ModelInputPart 的跨字段/编码校验、非法 envelope 的逐字节变体以及 typed binding 与 JSON 数学整数（如 `1.0`）的兼容性。共享 fixture 的通过不替代这些边界。

Go 的部分已知 union 和 allOf-only 形状仍以 RawMessage 表达；Python 使用 TypedDict 而非原计划 dataclass。已生成规则仍检查 wire，但“全部已知分支均有强类型构造器”的规划门槛尚未满足。这些项目与三平台资源压力测试继续列在实施记录，不能把 demo 成功扩大成全部 SDK 验收完成。
