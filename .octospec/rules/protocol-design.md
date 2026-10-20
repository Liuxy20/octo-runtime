---
type: Rule
title: Runtime 总体协议与调用设计
description: 调用入口、分层协议、执行时序、审批追问往返及失败恢复的总体合同。
tags: [protocol, invocation, interaction, adapter, architecture]
timestamp: 2026-10-20T00:00:00Z
implementation_baseline: feat/executor-kernel-host-lifecycle
id: runtime-protocol-design
tier: repo
priority: 95
load_bearing: true
inject_when:
  paths: ["packages/octo-runtime-protocol/**", "packages/octo-runtime-executor-core/**", "packages/octo-runtime-adapter-*/**", "packages/octo-runtime-host-sdk/**", "packages/octo-runtime-extra-*/**", "apps/**"]
  touches: [protocol, invocation, interaction, adapter, architecture]
source: self
supersedes: []
---

# Runtime 调用关系与协议

当前执行链为 HostApp/独立 Extra → Kernel IPC → worker → 唯一 AgentExecutor → Provider Adapter。宿主通过 Host SDK 分别管理 Kernel 和 Extra，Kernel 不加载业务插件。

## 合同与版本

- 主输入是 InvokeInput；Core 唯一解析执行配置、准备输入并映射到 Provider。
- Run schema_version=7；Context 为 octo.context-envelope/v3；Kernel IPC 为 ipc_version=1，分别版本化。
- /executor-core 是显式进程内方案；/executor-kernel 是 attached 客户端和 worker 装配入口；/host 提供 owned 组件。
- 源帧和 canonical 事件保持原协议，native/canonical 模式在接纳时冻结，续流不得切换。
- 业务 Context、Agent 定义、会话绑定、历史和可靠投递由业务方拥有；内核不补齐、摘要或重放业务请求。

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

[client](../../packages/octo-runtime-executor-kernel/src/client.ts)、[server](../../packages/octo-runtime-executor-kernel/src/server.ts)、[worker RPC](../../packages/octo-runtime-executor-kernel/src/rpc.ts)、[源窗口](../../packages/octo-runtime-executor-kernel/src/host-run-service.ts)、[Extra 执行桥](../../packages/octo-runtime-host-sdk/src/extra-port.ts)。仓库外类型和运行验证使用 [发行验收脚本](../../scripts/verify-release.mjs)。其他语言的生产 client、外部 Go Loop 和真实线上业务不由本地 fixture 证明。
