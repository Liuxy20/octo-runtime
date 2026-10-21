---
type: Rule
title: Runtime 总体协议与调用设计
description: 调用入口、分层协议、执行时序、审批追问往返及失败恢复的总体合同。
tags: [protocol, invocation, interaction, adapter, architecture]
timestamp: 2026-10-20T00:00:00Z
implementation_baseline: feat/69-kernel-client-invoke
id: runtime-protocol-design
tier: repo
priority: 95
load_bearing: true
inject_when:
  paths: ["packages/octo-runtime-protocol/**", "packages/octo-runtime-executor-core/**", "packages/octo-runtime-executor-kernel/**", "packages/octo-runtime-adapter-*/**", "packages/octo-runtime-host-sdk/**", "packages/octo-runtime-extra-*/**", "apps/**"]
  touches: [protocol, invocation, interaction, adapter, architecture]
source: self
supersedes: []
---

# Runtime 调用关系与协议

执行链为 HostApp/Extra → Kernel IPC → 内部 worker → 唯一 AgentExecutor → Provider Adapter。服务构造按[统一原生服务原则](architecture.md#统一原生服务构造与部署边界)：CLI 服务进程与 Electron 主进程直接创建同一服务，不能以外部 Node 代启。公共 API 为 createKernelService/createExtraService，见[合同](../tasks/unified-native-sdk-services/design.md)。Kernel 不加载业务插件。

## 合同与版本

- 主输入是 InvokeInput；Core 唯一解析执行配置、准备输入并映射到 Provider。
- Run schema_version=7；Context 为 octo.context-envelope/v3；Kernel IPC 为 ipc_version=1，分别版本化。
- /executor-core 是显式进程内方案；/executor-kernel 统一原生 Kernel 服务、客户端和 worker authoring；/host 提供原生 Extra 服务与宿主辅助。这是 #71 目标，基线 /host 的 owned launch 导出须删除。
- 源帧和 canonical 事件保持原协议，native/canonical 模式在接纳时冻结，续流不得切换。
- 业务 Context、Agent 定义、会话绑定、历史和可靠投递由业务方拥有；内核不补齐、摘要或重放业务请求。

普通消费者调用 KernelClient.invoke(input, environment?)，App 无需 Extra，插件使用实际 ctx.kernel。submit/get/subscribe 是刻意选择的高级原语；身份控制与 owner 排空使用同一 client 的登记，不实现第二套 invoke。具体取消与未知语义见[本地执行](local-execution.md)。

## RPC 与身份

[wire Schema](../../packages/octo-runtime-protocol/schema/kernel-ipc.schema.json) 定义 JSON-RPC 请求；[共享 Schema](../../packages/octo-runtime-protocol/schema/protocol.schema.json) 定义 LookupKey、RunRef、Snapshot、Status。不得在宿主或跨语言客户端维护另一套同名字段。

| 操作 | 参数和结果 |
| --- | --- |
| status / adapter.list | 空 params，返回当前实例及实际探测元数据 |
| agent_run.invoke | input 与可选 executionEnvOverrides，返回 Kernel instance 和原 receipt |
| agent_run.get | 完整五元组 key 和可选 expected instance，返回源快照 |
| agent_run.subscribe | 完整 ref、after_seq，ACK 后通知原源帧 |
| agent_run.cancel | 完整 ref、可选 reason，返回 accepted |
| agent_run.respond / native.respond | 完整 ref、原交互响应，不自动重试 |

RunRef 加入 kernel_instance_id 以区分重启前后，其他 run/invocation/session/generation/stream/protocol/mode 字段仍为原 receipt。身份不匹配、实例变化、窗口缺口和过期明确失败。命令 ACK 与执行终态是不同事实。

invoke ACK 丢失仅查询原输入身份，不重新 invoke。订阅断开使用原 ref/cursor 修复。连接关闭不取消已接纳执行；显式 cancel/abort 才发起取消。Provider 终态、资源清理完成、业务保存完成和消息投递成功分别报告。

## 交互与取消

Provider 的 native requestId 是 opaque；canonical interactionId 与原 invocation/Run 绑定。响应经过同一 Kernel/worker 路由，不猜测身份，不将回答转成新输入或重新 invoke。错误在最先违反合同的责任模块修复，不在下游猜正文补意图。

Core shutdown 的完整/未确认清理语义保持 [Core 合同](../../packages/octo-runtime-executor-core/README.md)。Kernel/Host SDK 的所有权、退避、限额和清理详见 [本地执行](local-execution.md)、[生命周期](runtime-lifecycle.md) 与 [Extra](extras.md)。

## 核对位置

[client](../../packages/octo-runtime-executor-kernel/src/client.ts)、[server](../../packages/octo-runtime-executor-kernel/src/server.ts)、[worker RPC](../../packages/octo-runtime-executor-kernel/src/rpc.ts)、[源窗口](../../packages/octo-runtime-executor-kernel/src/host-run-service.ts)、[调用登记](../../packages/octo-runtime-executor-kernel/src/invocation-lifecycle.ts)、[原生 Extra 服务](../../packages/octo-runtime-host-sdk/src/extra-service.ts)。仓库外类型和运行验证使用 [发行验收脚本](../../scripts/verify-release.mjs)。其他语言的生产 client、外部 Go Loop 和真实线上业务不由本地 fixture 证明。
