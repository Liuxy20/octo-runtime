---
type: Rule
title: 本轮模型输入与工作目录
description: Context v3 的业务归属、固定 renderer、控制通道和工作目录边界。
tags: ["context","model-input","workspace"]
timestamp: 2026-10-22T00:00:00Z
implementation_baseline: df63c8f
id: runtime-context-input
tier: repo
priority: 90
load_bearing: true
inject_when:
  paths: ["packages/octo-runtime-protocol/**","packages/octo-runtime-executor-core/**","packages/octo-runtime-adapter-*/**","test/model-context*"]
  touches: ["context","model-input","workspace"]
source: self
supersedes: []
---

# 模型输入和执行环境分离

公开入口为 KernelClient.invoke(inputs, sessionId, providerSession, agentEnv)。inputs 是业务方已经准备好的有序文本/图片；Runtime 不读取、拼装、渲染业务历史、extra.* 或资源引用，不规定业务标签格式。Gateway/应用可选 namespace/XML/Markdown，均只是输入内容。

agentEnv 复用 Context v3 schema/items 执行信封，允许 octo.execution/*、octo.security/approval_policy、octo.control/instructions。信封不能含业务材料。cwd、Adapter、model/effort、envs、MCP、limits、审批和受信指令属于 agentEnv；Core 每轮解析并冻结，不改变原配置，不从其他调用补齐业务材料。

执行设置不得自动拼入模型正文。受信指令使用 Provider 独立指令通道，来源授权归应用；普通业务材料不得升级为指令或执行权限。模型输入与显式 fresh fallback 由调用方一次准备，历史图片不可用必须显式失败，不静默退化。

Core 内部 InvokeRequest 和 Adapter signal 保留为执行接口，不等同于公开 KernelClient 签名。详见[输入合同](invoke-input.md)、[调用与取消](local-execution.md)、[标识说明](../../docs/zh-CN/concepts/identifiers.md)。
