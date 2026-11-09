---
type: Task
title: Issue 334 应用提示词归调用方
description: 删除 Runtime 的受信应用指令抽象，按调用方提供的普通输入执行。
tags: [protocol, architecture, adapter, model-input]
---

# 目标与授权

需求来源：[Issue 334](https://github.com/Mininglamp-OSS/octo-runtime/issues/334)。用户授权最新 main、独立 worktree、octospec、实施准备度至少 95 分、实施前 code review、实施、英文里程碑提交、正式 PR 和按保护规则合并 main。基线为 `3f83ecf4607c658fba7664caa6ccb2787ab92baa`，包含已合并的 #333；旧 #332 worktree 未提交修改保留。

## 产品意图与责任

应用决定启动提示词、业务材料、当前文字/图片及其顺序，在调用前构造 `inputs.parts`。Runtime 执行显式输入及 agentEnv；不决定哪些业务材料应进入模型，不将其升级为 system/developer/trusted 指令。公开普通数组 inputs 与高级 InvocationContent.parts 共享同一边界。

合同内动作是校验、冻结执行配置、原生协议映射和执行。越界动作包括解析 extra.im 构造提示词、从旧轮次补指令、按新建/续接隐式注入或换名保留注入能力。MCP、envs、workdir、model/effort、limits 和审批能力保留。Provider 原生私有配置的存在不等于 Runtime 提供公共 system prompt 能力。

## 范围与交付

- 删除公共 Context item、两个指令 payload 类型、controlInstructions 及派生/注入 helper；Schema、生成类型、运行时校验、Core、所有 Adapter 和 SDK 导出一致。
- 旧字段即使为空也明确拒绝；旧 item 在通用 Context、持久配置和 agentEnv 边界拒绝。未知可选扩展的其他合同保持。
- 输入保序、不增加分隔符或提示词；新建、续接和显式 fresh fallback 使用调用方本次提供的输入。恢复所需历史和图片仍由调用方提供。
- 更新双语接入/协议文档及现行规则；审计独立 Channel Gateway 的旧消费者并给出具体迁移缺口。此次不修改或验证 Gateway、Work App，不声称完成仓外端到端迁移。
- 源码包版本保留 0.0.0；Run=7、Context=v3、IPC=2、Adapter transport=2 不机械升级。作为明确删除的 API 变更记录升级要求，由既有发行流程选择并注入版本，本次不发布 npm。
- 严禁扩大 CI；专项在手动目录显式执行，不修改默认测试开关、workflow、job、矩阵、触发和 Gate 依赖。

实施路径见 [plan.md](plan.md)，验收见 [acceptance.md](acceptance.md)，准备度见 [assessment.md](assessment.md)。
