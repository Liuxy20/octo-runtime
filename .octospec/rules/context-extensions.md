---
type: Rule
title: Context 可选扩展
description: 业务扩展保序转发、固定渲染及未知可选字段边界。
tags: ["context","extension"]
timestamp: 2026-10-15T00:00:00Z
implementation_baseline: df63c8f
id: runtime-context-extensions
tier: repo
priority: 90
load_bearing: true
inject_when:
  paths: ["packages/octo-runtime-protocol/**","packages/octo-runtime-executor-kernel/**", "packages/octo-runtime-executor-core/**","test/context-extension*"]
  touches: ["context","extension"]
source: self
supersedes: []
---

# 执行信封与业务格式

执行信封保持 octo.context-envelope/v3 的 schema/items 与 namespace/name/payload，不改变 Run 事件信封。通用 ContextEnvelope 的可选项、JSON 校验和 hash 能力保留；AgentEnv 使用同一结构。

Runtime 无业务渲染器、extra.* 模型白名单、业务 schema 或注册框架。history、extra.im、文档材料及其格式全部属于 Gateway/应用，转为 inputs 后交给执行底座；不要求调用方遵循 namespace 标签。AgentEnv 允许业务与 Adapter 约定的私有条目；Core 不解释其 payload，无关 Adapter 忽略，消费方负责校验。私有字段不登记公共 schema、类型或版本，也不自动进入 inputs。

已识别执行设置由 Adapter 按其消费合同校验；defaults/mandatory 与权限不能从模型文本推断。应用配置和注入逻辑不能进入 Core、Host 或公共客户端。详见[输入边界](context-input.md)。
