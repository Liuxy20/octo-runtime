---
type: Guide
title: IM Agent 与通用 invoke 的责任边界
description: 区分 IM 业务提示词准备与 Runtime 执行配置的责任边界。
tags: [architecture, channel, agent, invoke, workspace, session]
timestamp: 2026-10-16T00:00:00Z
---

# 独立渠道接入

本文对应的渠道功能已迁至[独立 Gateway](https://github.com/Mininglamp-OSS/octo-channel-gateway)，使用 `ChannelRegistry.register(endpoint, definition)`。配置、逐轮 Context、会话历史和投递由 Gateway/应用负责。Runtime 不提供插件配置和业务 schema；旧任务中的 Extra 设计已由 Issue 328 替代。

Issue 334 后，应用启动提示词与渠道材料均由调用方在调用前编译成普通 inputs.parts；agentEnv 只承载 MCP、环境变量、目录、模型/effort、limits 和审批等执行配置。Runtime 删除 octo.control/instructions 与 controlInstructions，不提供 system/developer/受信角色，也不按首轮/续接/fallback 注入。Gateway 可保留业务级 instructions 配置，但必须在自己的边界校验和编译，不能把旧项交给 Runtime。

独立 Gateway 当前仍消费旧合同；本仓仅审计，尚未迁移或验收其端到端行为。具体路径、输入次序、冻结重试与发行顺序见[消费者审计](../tasks/334-caller-owned-prompts/gateway-audit.md)。

Issue 335 同样要求调用方先准备应用目录，再传入 path-only workspace 或 agentEnv.workdir；CLI 与 SDK 不隐式取 cwd，Runtime 不分配随机目录或补建。Gateway 当前在自己的边界选择并创建默认目录，这属于业务方责任，但仍发送已删除的 fixed mode，须另行迁移；Gateway 的后续实施已取消，本次仅记录[工作目录消费者审计](../tasks/335-caller-owned-workspace/gateway-audit.md)。不因此改变 Gateway 配置、部署或发行状态。
