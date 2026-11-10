---
type: Rule
title: 协议 Schema 与生成合同
description: Schema、生成类型、客户端默认值及运行时语义校验的职责和更新流程。
tags: ["protocol","schema"]
timestamp: 2026-11-09T00:00:00+08:00
implementation_baseline: 86b3379c
id: runtime-protocol-schema
tier: repo
priority: 90
load_bearing: true
inject_when:
  paths: ["packages/octo-runtime-protocol/**","test/*protocol*","test/context-*"]
  touches: ["protocol","schema"]
source: self
supersedes: []
---

# Protocol Schema 与类型生成

调用关系、协议分层、执行时序与审批／追问的回答路径见[总体协议与调用设计](protocol-design.md)。本文维护 Schema 和生成流程。

可序列化共享数据的结构来源为 [protocol.schema.json](../../packages/octo-runtime-protocol/schema/protocol.schema.json)，IPC 请求和结果由 [kernel-ipc.schema.json](../../packages/octo-runtime-protocol/schema/kernel-ipc.schema.json) 定义。`schema/` 只放这两个 Draft-07 Schema，不放默认配置或测试样本。[gen-types.mjs](../../packages/octo-runtime-protocol/scripts/gen-types.mjs) 使用 `json-schema-to-typescript` 生成 [protocol-types.ts](../../packages/octo-runtime-protocol/src/generated/protocol-types.ts)，并从 Schema 派生 `KERNEL_IPC_VERSION`、`RUN_PROTOCOL_ERRORS`，不要手工修改生成文件或在消费者中另存这些合同常量。

## 当前边界

自有 Adapter capabilities、旧 required_capabilities 以及 ExecutionTarget 预留设计已经删除。不得在 schema 或生成类型中保留 AbilityProvider、executor_id、provider_binding_ref 的占位定义。Provider 原生协议的同名 capabilities 不属于此次删除范围，见[Adapter 元数据](adapter-metadata.md)。

Schema 定义 ProviderSession、AgentEnv 信封、公共配置 bean、Host 帧和 InvokeRequest wire 等数据形状。公共层校验信封结构、JSON、唯一键和预算；Adapter 校验所消费配置的语义。私有 item 的字段、类型和校验仅属于宿主与对应 Adapter，不增加公共 schema、类型或协议版本；生成 TypeScript 类型本身不会在运行时校验输入。

泛型 CanonicalEvent、带 `AbortSignal` 的 InvokeRequest 组合及非生成的运行时辅助留在 [src/index.ts](../../packages/octo-runtime-protocol/src/index.ts)。函数、活对象及 AbortSignal 不通过 JSON wire 传输。

当前 Kernel、Core、Host SDK 和独立 client 是 TypeScript 实现；Issue 328 已删除 native 目录和 Go/Python 客户端生成入口，不将历史生成流程当作当前要求。

## 协议、默认值与测试资产

六份正反样本位于协议包 [test/fixtures](../../packages/octo-runtime-protocol/test/fixtures)，用于检查实现与合同的一致性。已有公开 IPC 样本入口 `@mininglamp-oss/octo-runtime/executor-kernel/ipc-fixtures.json` 和 `@mininglamp-oss/octo-runtime-client/protocol/ipc-fixtures.json` 保持，发行时仅复制这一份到专用 fixtures 路径。其他内部测试样本不发布；不能把一致性样本称为协议定义。

Issue 332 删除 `kernel-client.behavior.json` 及 client `/protocol/behavior.json` 导出，不提供兼容副本，也不搬成另一份无人读取的 config。各字段归属如下：

| 原字段 | 当前维护位置与职责 |
| --- | --- |
| connections/invocations/controlConcurrency/lookupConcurrency | client 实现拥有的资源默认值，不是所有客户端必须遵循的 wire 合同 |
| timeoutsMs/repairDelaysMs | client 实现拥有的超时、恢复节奏 |
| revision/readChunkBytes | 已删除 native 生成器的版本/读取元数据，当前 TS 无消费者，直接删除 |
| requestBytes/lineBytes | 使用实际共享 wire 容量常量，不另存重复数值 |
| ipcVersion | Schema 的 KernelStatus 定义派生 KERNEL_IPC_VERSION |
| terminalStates/retryableErrors/lookupFields/receiptFields/identityInputFields/defaults/lifecycle/ownership/closeCancelsRun/replayInvoke | 实际类型、校验及客户端状态逻辑各自维护，不保留脱离消费者的描述副本；取消和不重放语义见总体协议 |

IPC Schema 的 title/$id 对齐 v2，标识为 `urn:mininglamp-oss:octo-runtime:kernel-ipc:v2`，原 v1 注册或引用须更新；实际 IPC 版本不改变。删除没有当前生成消费者的 `x-octo-methods`，保留 RPC 方法及请求/结果定义。

遗留 ContextSelectionEntry、ContextResourceEntry、ContextContinuityPayload 和 Channel/history 同步类型、五个专属校验器已删除，不建立兼容层；ContextInlineEntry/ContextReferenceEntry 也已删除，调用方自行维护业务材料及同步合同。完整删除清单见[升级说明](../../packages/octo-runtime-protocol/README.zh.md)，实施范围见[Issue 332](../tasks/332-schema-ownership/brief.md)。

## 标准 Schema 与语义校验

标准 Draft-07 校验器检查 type、required、enum、范围等标准关键字。`x-octo-*` 是附加语义约定，并非标准关键字；普通校验器可能忽略它们，严格模式也可能拒绝未知关键字。通过标准结构校验不代表符合完整执行合同。

字节/JSON 深度预算、Unicode 标量字符串、按特定字段唯一、跨字段一致性、身份和生命周期规则由现有运行时校验器及测试语义关键字实现。生成类型只保证静态形状，不替代运行时校验；本次没有将全部校验器改成生成代码，不引入新的运行时校验框架。修改这些规则时须同时维护标准 Schema 能表达的约束、运行时语义及正反样本，明确哪些样本需要扩展支持。

## 修改流程

1. 修改 Schema 及相关运行时校验器。
2. 更新测试目录中的共享正反 fixtures 和受影响消费者。涉及公共输入字符串时，分别核对标准结构检查和 TS 运行时语义；类型生成成功不代表校验行为一致。`sessionName` 允许标点和 Unicode 文本，按码点计长，使用现有 `not`/`anyOf` 排除控制字符与全空白文本，空白集合与 TS trim 显式对齐，末尾换行由控制字符规则拒绝。仓外自有客户端的联调范围单独记录，不恢复已删除的 native 工具链。
3. 重新生成类型并构建：

```sh
pnpm --filter @mininglamp-oss/octo-runtime-protocol gen
pnpm --filter @mininglamp-oss/octo-runtime-protocol build
```

Protocol 包的 `build` 自动运行生成器。验证入口包括 `test/context-protocol.test.js` 和 `packages/octo-runtime-protocol/test/*.test.js`；具体测试范围随修改的合同决定。

Run 固定为 7、Context 固定为 `octo.context-envelope/v3`，IPC 和 Adapter transport 各使用自身的版本 2。新增可选字段不机械升级这些版本，不新增旧格式识别、转换或回退。影响实际 wire 或 Provider 行为时，须同步实际调用方，构建并重启受影响实例，真实接口在 im-test 验证；仅生成类型或全局链接不能代替实机验证。纯资产整理按受影响的合同、类型和双包发行检查验收，不把 fake Provider 结果当作真实模型/IM 证据。专项验证显式本地运行，不增加 CI 范围。

ContextPreparationReceipt 与 RunContextProjection 属于已移除准备链的残留，Schema、生成类型和公开导出均删除，不保留兼容别名。执行参数由 AgentEnv 的对应条目承载；HostRunReceipt、Host 帧及运行事件表达各自实际事实，不恢复一份无生产者的配置/准备状态投影。

runtime selection 不属于执行协议：ContextRuntimeSelectionPayload、ResolvedRuntimeSelection、选择校验器、catalog 和 RUNTIME_RUN_CONTRACT.routing_schema 已删除。通用信封仍允许 opaque 未知 item；结构接受不意味着 Runtime 执行设备选择或故障转移。
