---
type: Task
title: Issue 40：原因与证据
description: 区分已复现的创建参数错误、权限语义变化和待验证的生命周期差异。
tags: [openclaw, adapter, invocation, interaction, testing]
timestamp: 2026-10-22T00:00:00Z
---

# 结论

当前 Adapter 按新版 Gateway 的 `sessions.create` 合同组装请求，没有按服务端字段合同做适配。**7.x 至少会拒绝 `permissionMode`、`idempotencyKey` 和可选的 `thinkingLevel`；8.1 起这些创建字段出现在已核对的稳定标签中。所有这些标签仍使用协议 v4。** 因而握手通过、方法名存在，并不表示实际执行请求合法。

这解释了用户“7.1 不生效、9.1 生效”的反馈，但尚未取得 `diag_0444ffdbe4bc43fbb2580c97abcd4317` 的原始 trace 和故障 Gateway hello。此诊断具体由哪台、哪个 build 返回，仍待确认。

## 当前代码的直接原因

基线 [index.ts](../../../packages/octo-runtime-adapter-openclaw/src/index.ts) 的 `buildOpenClawGatewayInvocation` 无条件生成：

```ts
{
  key: sessionKey,
  agentId,
  permissionMode: req.approvalMode === "full_access" ? "full" : "guarded",
  idempotencyKey: `${requestId}-session`,
  ...(model ? { model } : {}),
  ...(thinking ? { thinkingLevel: thinking } : {})
}
```

`invokeOpenClawGateway` 将这个对象直接传给 `sessions.create`。`assertRuntimeGatewayContract` 只核对 `protocol === 4`、六个方法名及 `agent` 事件；`probeGateway` 再调用 `agents.list` 即报告可用，没有验证当前请求的字段合同。

[gateway.ts](../../../packages/octo-runtime-adapter-openclaw/src/gateway.ts) 的 hello 类型没有保留 `server.version` 的类型定义和消费逻辑；`errorFromFrame` 将原生错误压成普通 Error 字符串，丢失可结构化识别的 code/details。后续如要做安全的兼容诊断或有限重试，不能依赖字符串猜测。

现有 OpenClaw fake 测试主要按 method 返回自定义对象；审批测试还直接断言 `permissionMode === "guarded"`。这些测试没有加载版本专属的严格 Schema，因此不能发现 7.x 的未知字段问题。

## 原始 Schema 的本地复现

从上游 `v2026.7.1@2d2ddc43d0dcf71f31283d780f9fe9ff4cc04fe4` 读取 `packages/gateway-protocol/src/schema/sessions.ts` 中的 `SessionsCreateParamsSchema`，其对象为 `additionalProperties: false`。用 TypeScript AST 提取原始初始化表达式和原始字符串 primitive，再由本机已安装的 TypeBox Compile 校验结构等价的合成请求。

| 请求变体                                                   | 本地校验结果                        |
| ---------------------------------------------------------- | ----------------------------------- |
| 当前默认字段：key、agentId、permissionMode、idempotencyKey | 拒绝 permissionMode、idempotencyKey |
| 仅移除 permissionMode                                      | 仍拒绝 idempotencyKey               |
| 两者都移除，但传 thinkingLevel                             | 仍拒绝 thinkingLevel                |
| 仅 key、agentId                                            | Schema 通过                         |

原始结果见 [schema-reproduction.json](schema-reproduction.json)，可重复脚本见 [verify-legacy-schema.mjs](verify-legacy-schema.mjs)。这里证明的是请求校验差异，不是 Gateway、权限执行或模型调用通过。TypeBox 使用本机 9.4 安装附带的库，并未启动 7.1 服务端；错误文本可与 7.1 服务端 formatter 不同。

## 权限变化是第二个关键问题

7.1 的 `sessions.patch` 接受 `execSecurity`、`execAsk`；其实现分别接受 `deny/allowlist/full` 和 `off/on-miss/always`。该版本的官方权限说明描述的是主机 exec 策略、配置及本地审批文件的共同约束。

8.1 的创建 Schema 已有 `permissionMode`，并定义 `read-only/guarded/workspace/full`。官方说明同时约束 OpenClaw 管理的文件工具与 exec 审批，`full` 要求 `operator.admin`。旧的 `execSecurity`、`execAsk` 虽仍留在新版 patch Schema，却已被实现拒绝并提示改用 `permissionMode`。**因此 Schema 接受字段也不等于行为支持。**

旧版候选可在隔离会话上 patch exec 策略，但不能直接认定它等价于新版 guarded/full。用户最新明确权限按业务口径兼容，允许 ask 不可用时向更大权限的 full_access 回退，不要求旧版复制新版文件边界；因此新版权限的完整等价性不再是本任务前置条件。仍须检查审批文件下限、原生 harness 与 reviewer，确认实际采用方式并提示回退；人工 ask 不可用而 full 可用时继续执行，不修改 Agent 或 Gateway 全局配置。具体映射见[细化计划](implementation-plan.md)。

## 生命周期审计结果

| 环节 | 已核对事实                                                                                             | 剩余验证                                                                                     |
| ---- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| 握手 | 26 个标签协议号均为 4；7.1/8.1/9.1/10.5 hello Schema 均有 server.version                               | 真实 hello、认证角色与授予 scopes；当前 proof 与各边界实例互通                               |
| 创建 | 7.x/8.1 创建字段分界明确；7.x 无创建 idempotencyKey                                                    | 旧版按 key 创建/采用已有会话的副作用；不得套用新版幂等保证                                   |
| 执行 | 26 个标签的 AgentParamsSchema 都包含 model、thinking、extraSystemPrompt、idempotencyKey                | 模型覆盖、可信指令、思考强度的真实应用                                                       |
| 订阅 | 7.1 的订阅参数已有 key、agentId，与当前请求一致                                                        | 完整订阅回执、首帧时序、断线及终态前后尾流                                                   |
| 审批 | 7.1/8.1/9.1/10.5 的 exec.approval.list handler 都返回待办列表；resolve 通道存在                        | allowedDecisions、过期、外部决策、原生 harness 差异；不能把 exec 审批概括成全部工具审批      |
| 完成 | 7.1 的 agent.wait 返回 status、endedAt、stopReason 等；8.1 开始经独立 turn service 归一化              | accepted/in_flight/queued 等非终态、结果缺失和失败终态不能当 completed                       |
| 取消 | 7.1 agent handler 可将 rpc/stop 原因放入终态结果；当前 waitForConfirmedTerminal 仅识别 aborted/restart | 属于额外兼容风险，须按各合同核对取消与超时归类，不在本轮宣称已复现真实取消失败               |
| 输出 | 当前文本转换基于 data.text 的快照差异；新版本可能增加事件字段                                          | assistant/thinking/tool/usage、增量与 replacement 的版本 fixture；本轮没有完成逐版本输出审计 |

上表的源码核对不是全生命周期兼容验收。创建错误已经确定；事件及终态差异仍需后续实际样本和严格 fixture。

## 来源

- [7.1 创建与 patch Schema](https://github.com/openclaw/openclaw/blob/2d2ddc43d0dcf71f31283d780f9fe9ff4cc04fe4/packages/gateway-protocol/src/schema/sessions.ts)
- [7.1 patch 实现](https://github.com/openclaw/openclaw/blob/2d2ddc43d0dcf71f31283d780f9fe9ff4cc04fe4/src/gateway/sessions-patch.ts)
- [7.1 权限说明](https://github.com/openclaw/openclaw/blob/2d2ddc43d0dcf71f31283d780f9fe9ff4cc04fe4/docs/tools/permission-modes.md)
- [8.1 创建 Schema](https://github.com/openclaw/openclaw/blob/ea806575e6450e4d1efdfc72c19f04be982a1b9b/packages/gateway-protocol/src/schema/sessions-create.ts)
- [8.1 权限语义与旧字段退休](https://github.com/openclaw/openclaw/blob/ea806575e6450e4d1efdfc72c19f04be982a1b9b/docs/gateway/permission-modes.md)
- [10.5 权限语义](https://github.com/openclaw/openclaw/blob/1b58cb9a1b4f4353e1add63c8506db4d890962e8/docs/gateway/permission-modes.md)

完整标签、提交和已核对字段见 [版本矩阵](compatibility-matrix.md)；原始源文件的 SHA-256 见 [source-evidence.json](source-evidence.json)。
