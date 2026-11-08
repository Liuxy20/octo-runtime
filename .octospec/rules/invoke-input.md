---
type: Rule
title: 统一 InvokeInput 合同
description: 所有公共入口共用的输入、默认值和多模态字段。
tags: ["invoke","protocol","multimodal"]
timestamp: 2026-11-05T10:45:00Z
implementation_baseline: df63c8f
id: runtime-invoke-input
tier: repo
priority: 90
load_bearing: true
inject_when:
  paths: ["apps/cli/**","packages/octo-runtime-executor-core/**","packages/octo-runtime-protocol/**","packages/octo-runtime-executor-kernel/**","packages/octo-runtime-host-sdk/**"]
  touches: ["invoke","protocol","multimodal"]
source: self
supersedes: []
---

# 平铺 invoke 与 IPC v2

KernelClient.invoke(inputs, sessionId, providerSession, agentEnv) 返回 KernelInvocation。inputs 普通为 ModelInputPart[]；高级 InvocationContent 只包含 parts、输出视图、内容/恢复材料、追踪身份和代次，不包含执行设置、会话参数或 signal。

agentEnv 包含执行信封和高级执行字段 agentSource/workdir/controlInstructions/approvalMode/agentConfig/runtimeLimits；顶层旧执行字段与 contexts 拒绝。client 在调用时校验、复制并确定 ID，首次消费才提交。原配置和 inputs 可复用，不随本次执行改变。协议 schema、TypeScript 和语义校验须一致；生成文件由 schema 脚本生成。

IPC v2 的 InvokeInput 使用 inputs/agentEnv，sessionId/providerSession 及内容/追踪字段平铺。旧 IPC v1 明确拒绝，不通过兼容包装恢复旧业务 Context。内部 InvokeRequest 供 Core/Adapter 使用，不作为普通调用方 API。

中断为 client.interrupt(invocationId, reason?)；公开 invoke 不含 signal。身份立即可读。未提交时阻止写出并返回可验证未提交错误；已发送则确认/查询同一接纳身份，再控制原执行，不重放。return/throw 在提交前释放登记；已接纳后停止观察不能自动取消执行。详细所有权和并发上限见[本地执行](local-execution.md)。

文档必须区分 sessionId、invocationId、runId、providerSession、stream_id、seq、kernel_instance_id，以及各自生产者、保存者和用途。client 输入容量 32 MiB、登记 128；信封原有数量/JSON/大小限制不变。
