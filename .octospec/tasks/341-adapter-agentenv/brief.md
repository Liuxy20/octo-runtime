---
type: Task
title: AgentEnv 直接交给 Adapter
description: 删除重复执行配置模型，由 Adapter 消费执行条目并提供 Harness 默认配置。
tags: [architecture, adapter, context, protocol, invoke]
---

# 目标

实现 Issue #341 和本次用户追加决定：业务方只构造 inputs 与 AgentEnv.items，Core 保序透传；Adapter 读取、校验、默认化并执行。代码和现行文档删除旧配置模型，不增加兼容层。模型、思考强度等共性 bean 可在公共协议定义；Hermes 等私有配置由业务与 Adapter 约定，不改公共协议或版本。

## 产品意图与责任

业务目标是新增定制 Harness 配置不改框架。业务决定本轮输入、配置与会话；Core 仅负责路由、身份、传输、执行及清理生命周期。Adapter 决定配置支持、Provider 原生映射和默认值。禁止 Core 按 Harness 名称组装执行设置、补配置或修改条目；禁止为旧脚本恢复旧字段。现有首轮/续接/fallback 输入、权限失败、调用方准备目录及取消/清理语义继续有效。

## 关键合同

1. AgentEnv 只有 schema/items；内部 InvokeRequest 直接携带 agentEnv，删除 context 及重复执行设置。Core 只读取 adapter 路由条目，不构造执行计划或配置副本。
2. 公共信封校验只处理 JSON、数量、大小、键唯一及结构。共性 bean 保留公共类型；其执行语义由 adapter-sdk 帮助函数校验。私有条目允许透传，无关 Adapter 忽略，消费方对已识别但非法的值明确失败。
3. adapter-sdk 提供直接读 item 的模型、effort、审批、目录、环境、MCP、预算和私有 options 帮助函数，不再生成通用配置对象。各内置 Harness 暴露独立可复制的默认 AgentEnv，由调用方显式选择或组合；调用时不向信封追加默认条目，Adapter 读取缺省值时不修改调用方对象。
4. 宿主可信连接配置通过本地调用环境/Adapter 上下文传递，不混进调用方信封或由 Kernel 覆盖私有配置。Adapter 对自己的连接选项进行合并；跨 RPC 的原有宿主配置所有权保留。
5. Core watchdog 只执行生命周期计时。Adapter 从条目读取预算并通过本地上下文配置 watchdog；Core 不把 item 转换成执行计划。目录校验和审批支持检查迁入 Adapter 层，原原因码保留。
6. 删除旧公开/内部配置入口，不兼容转换；静态调用端、fixtures、示例同步迁移。初始破坏性改造同步 schema，后续私有 item 不改公共 schema/类型/版本。

## 实施步骤

1. 协议：开放不透明 item，精简 AgentEnv/InvokeRequest，删除执行计划和旧配置模型。
2. SDK：直接读取配置、Adapter 默认信封、已识别配置校验、目录验证、可信选项上下文和预算回调。
3. Core/Kernel：移除中间配置对象，Adapter 直接消费 AgentEnv；保留执行生命周期。
4. 全部 Harness、CLI、示例和验证脚本迁移；不重建旧 IM 或 Extra。
5. 迁移既有离线测试；额外扩展/保序/默认值/权限/目录专项显式手动运行，不加入默认测试或 CI。构建、类型、lint、既有全量回归与文档检查，记录实际失败和真实 Provider 覆盖限制。

## 验收

- A01：源码、schema、现行 docs 无旧配置模型；Core 无执行计划解析/Provider 配置读取。
- A02：自定义 bean 经 direct Core 与 Kernel/client 传至自定义 Adapter，值和顺序不变，不修改公共协议或其他 Adapter。
- A03：内置 Harness 有默认 AgentEnv，调用方显式选择；Adapter 读取缺省值但不补信封，并发调用不修改共享或调用方对象。
- A04：模型/effort/审批/MCP/envs/目录仍在 Adapter 正确映射；无关私有条目忽略，非法已识别配置明确失败。
- A05：watchdog、取消、终态、资源回收、RPC 冻结与输入恢复既有合同回归通过。
- A06：schema 生成、build/typecheck/lint/names、既有全量测试、docs 和 OKF lint 记录真实结果；专项本地手动，workflow、默认测试开关及 CI Gate 无变更。

## 范围外与授权

不修改独立 Gateway，不增加兼容层。用户追加授权：审查与验证通过后英文提交、推送并创建目标为 main 的 PR；明确禁止自动合并，不启用 auto-merge，不执行合并或发行。历史 journal/task 是版本绑定证据，不改写其历史结论；被删除源码的历史链接固定到删除前提交，现行规则/docs 同步本设计。缺真实 Harness 环境明确记录，不冒充 live 验证。

实施初始基线为 d5aeae707fcda0b138b360136f164c085c9a5e87；提交前整合 main 的 4d7e272d1bb30957c815410f68758a9d2445d708，保留 #339 的宿主 Engine 所有权与显式 CODEX_HOME 合同。最终验证以整合后的工作树为准。
