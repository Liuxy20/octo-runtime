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
  paths: ["packages/octo-runtime-protocol/**", "packages/octo-runtime-executor-core/**", "packages/octo-runtime-executor-kernel/**", "packages/octo-runtime-adapter-*/**", "packages/octo-runtime-host-sdk/**", "apps/**"]
  touches: [protocol, invocation, interaction, adapter, architecture]
source: self
supersedes: []
---

# Runtime 调用关系与协议


按 [#294 原生装配合同](architecture.md#sdk-原生装配与统一-rpc)，执行链为 HostApp/独立消费者 → KernelClient → 本地 RPC → ExecutorKernel → 本进程唯一 AgentExecutor → 宿主注入的 Provider Adapter。Electron 同进程业务也走 RPC，Kernel 不读取模块 manifest、不启动执行 worker。CLI 服务进程与 Electron 主进程使用相同服务工厂；`createKernelService` 的目标签名见[架构声明](architecture.md#sdk-原生装配与统一-rpc)。当前工作树使用原生对象装配，实际验证范围见 #294 任务。Kernel 不加载业务插件。

## 合同与版本

- 主输入是 InvokeInput；Core 准备身份与输入，AgentEnv 保序透传至 Adapter；Adapter 直接读取、校验并映射到 Provider。
- Run schema_version=7；Context 为 octo.context-envelope/v3；Kernel IPC 为 ipc_version=2，分别版本化。
- /executor-core 保留显式低层执行能力，不能代替普通宿主的 Kernel RPC；/executor-kernel 提供统一原生服务与客户端，#294 不再要求 worker authoring；/host 提供 Kernel 服务与宿主辅助。旧 owned launch 已删除，不得恢复。
- 源帧和 canonical 事件保持原协议，native/canonical 模式在接纳时冻结，续流不得切换。
- 业务 Context、Agent 定义、会话绑定、历史和可靠投递由业务方拥有；内核不补齐、摘要或重放业务请求。
- 应用提示词由调用方准备为普通输入 parts，并与业务文字/图片保序；Runtime 不赋予 system/developer/受信角色，不按新建、续接或 fallback 注入。旧 octo.control/instructions、controlInstructions 及其类型/helper 已删除，即使为空也拒绝。MCP、envs 和执行策略保留在 agentEnv。
- 本地工作目录由调用方先准备为现有绝对路径；CLI/SDK 均显式传入，不默认取 cwd。workspace 仅含 path，不包含 mode；Runtime 不分配或恢复目录，续接/fallback 路径失效返回具体 WORKDIR_* 及 OH-ADP-3004 分类。声明 metadata.workspace:false 的 Adapter 的无本地覆盖场景不制造目录。运维 Home/log/IPC 与应用路径各自管理。

普通消费者调用 KernelClient.invoke(inputs, sessionId, providerSession, agentEnv)，独立 Gateway 使用公开 Client。submit/get/subscribe 是刻意选择的高级原语；身份控制与 owner 排空使用同一 client 的登记，不实现第二套 invoke。具体取消与未知语义见[本地执行](local-execution.md)。

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

Provider 的 native requestId 是 opaque；canonical interactionId 与原 invocation/Run 绑定。响应经过同一 Kernel RPC / Core / Adapter 路由，不猜测身份，不将回答转成新输入或重新 invoke。错误在最先违反合同的责任模块修复，不在下游猜正文补意图。

Codex 异步 ask 是可选的会话旁路补充，使用 `delivery: async` 与版本化 question request/response。Adapter 仅向原活动轮次一次 steer，匹配 RPC 确认才表示 provider_accepted。正常完成不使未答旁路失效；公共 `AsyncQuestionReply` 在确认完成后用现有 invoke 创建新 AgentRun，宿主显式提供同会话 continuation input 并保存问题/提交状态。新 Run 强制恢复原 Provider 会话，恢复失败拒绝，不能 fresh fallback。未知 steer 投递不得转新 Run。仅有消息快照不授权回答，恢复 running/unknown 也不能猜完成。异步默认无到期、不产生 waiting_input、不触发最终回答收尾 timer，也不豁免真实 watchdog；同步问答与审批保持。完整合同见 [旁路规格](../tasks/265-codex-async-questions/brief.md)。

Core shutdown 的完整/未确认清理语义保持 [Core 合同](../../packages/octo-runtime-executor-core/README.md)。Kernel/Host SDK 的所有权、退避、限额和清理详见 [本地执行](local-execution.md)、[生命周期](runtime-lifecycle.md)。

### 异步续跑配置与身份边界

`AsyncQuestionReply` 不持有业务配置源。宿主传入 `continuation()`，明确授权正常完成后的下一次执行，并负责同会话串行管理。只读取“当前配置”而不确认它是否仍适用于原题，不构成 SDK 提供的安全保证。

- 原 Run 活动时，只按原 RunRef 和 interactionId steer；continuation 的 agentEnv 不修改或重定向该 Run。
- `respond()` 校验 continuation 的 sessionId、sessionGeneration（省略按 0）、providerSession.sessionId/resumable 与 providerEpoch；新 Run 必须恢复原 Provider 会话，不能 fresh fallback。
- `respond()` 捕获下一次输入和 agentEnv 的副本。消费 events 前再次读取 continuation 核对 sessionId/generation、Provider sessionId 和 epoch；后来的配置修改不会替换已经捕获的 agentEnv。需要采用另一份配置时，业务必须在发起 respond 前完成选择。
- agentEnv 不是身份凭据，也不参与跨轮全量签名。业务可以明确授权新 Run 调整 effort、环境变量、MCP、权限或工作目录，仍须满足执行校验和 Provider 恢复能力；允许提交不等于 Provider 一定支持。
- providerEpoch 继续可选，只表示业务 Provider 绑定的版本。使用时必须将产生问题时的值保存到 snapshot，并在绑定替换后提供新值；两边均省略仅表示没有版本比较保护，不证明绑定未变。未使用 epoch 的宿主须主动使旧控制者/表单失效，避免同 ID 背后的 Adapter、账号或服务端身份域替换。
- reset、绑定替换的判定与旧表单销毁归 Gateway/宿主；Runtime 不按任意配置差异猜测。业务无法确认原题仍获授权续跑时，continuation 应抛错，禁止投递。宿主须在提交/消费前重新核对自身业务授权；SDK 的身份复核不能代替这一步。

因此“旧绑定拒绝”特指已提供的身份/代次不匹配及宿主管理的绑定失效，不承诺自动检测所有 agentEnv 或外部配置变化。该边界是当前用户确认的合同，取代历史任务中未区分配置与身份的概括表述。

## 核对位置

[client](../../packages/octo-runtime-client/src/client.ts)、[server](../../packages/octo-runtime-executor-kernel/src/server.ts)、[原生执行源](../../packages/octo-runtime-executor-kernel/src/execution-source.ts)、[源窗口](../../packages/octo-runtime-executor-kernel/src/host-run-service.ts)、[调用登记](../../packages/octo-runtime-client/src/invocation-lifecycle.ts)。仓库外类型和运行验证使用 [发行验收脚本](../../scripts/verify-release.mjs)。其他语言的生产 client、外部 Go Loop 和真实线上业务不由本地 fixture 证明。
