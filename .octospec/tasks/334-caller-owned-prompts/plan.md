---
type: Task
title: Issue 334 实施方案
description: 公共边界、原生适配、消费者升级和验证的可执行步骤。
tags: [protocol, adapter, planning]
---

# 实施步骤

## M1 规划与实施前审查

基于固定 main 基线盘点调用链，提交本方案；对 `baseline...HEAD` 的非空规划 diff 分别开展 Standards 和 Spec 审查，修复后方可实施。此时审查只能证明方案覆盖性，不能声称代码已满足需求。仓库缺少 code-review 技能提及的 docs/agents/issue-tracker.md；以用户明确提供的 GitHub Issue 和现有 CONTRIBUTING 流程为来源，不为本任务引入另一套模板。

## M2 合同与执行链

1. protocol.schema.json 删除 ContextInstructionEntry/ContextInstructionsPayload 及条件映射，移除 AgentEnv/InvokeRequestWire 字段；在可扩展对象上通过标准 `not/required` 拒绝旧字段，在 ContextItem 上明确拒绝已移除的 octo.control/instructions。通过生成器更新声明，禁止手工改生成类型。
2. context-catalog/context/context-configuration/invoke-input/index 删除指令注册、校验分支、层规则、派生和导出，删除仅提供指令拼装的 model-context.ts。新增明确删除错误，覆盖直接低层 InvokeRequest 及公开 AgentEnv；不将业务材料搬到执行设置。
3. Core invoke-input 删除指令解析。client/Host/Kernel 使用同一边界，无兼容别名或隐藏转换。核查持久配置/序列化/export 后不能再接受旧项。
4. Adapter SDK 删除 helper 导出。ACP、Grok、CodeBuddy 仅提交 providerInputText/providerInputParts，避免空指令仍留下分隔符。Codex 删除 thread/start 的 request-derived developerInstructions，保留上游要求的 collaborationMode nullable 字段。Claude 删除系统提示文件及参数但保留 MCP 临时目录。OpenCode 删除 Runtime instructions 文件增强但保留用户原生 inline config。OpenClaw 删除 extraSystemPrompt；DSH 删除控制块；Antigravity 删除 Runtime control 标签。共享 ACP 派生 Adapter 随之覆盖。
5. 旧 fixture 中的空 controlInstructions 同步清理；原注入测试改成输入保序、无重复、首轮/续接/fallback 验证，不靠删除断言掩盖行为。真实脚本需要的业务提示词由脚本调用方显式构造普通输入。

## M3 文档、消费者与验证

同步当前架构、输入、上下文、Adapter 指南及双语 SDK/协议说明。旧任务和 journal 是历史证据，不全仓改写历史。记录 Channel Gateway dispatcher/kernel-input 的旧执行路径和迁移方式；需要 Gateway 升级的部署明确阻断组合升级，不假称兼容。

按验收表运行专项、完整离线检查和双包发行验证；只报告实际执行的原生 Provider/IM 结果。Adapter live 验收缺少可用前提时记录 blocked/not run，不用 fake 冒充。对最终实现再做独立 Standards/Spec 审查；修复 finding 并按影响复验。检查相对 main 的 .github/workflows diff 和实际 PR checks，英文正式 PR 关联并关闭 #334。

## M4 main 交付

刷新 origin/main，处理真实冲突并复验受影响范围。保留里程碑英文提交和 Codex trailer，正常推送主题分支；不直接推 main、不自批、不绕过保护、不调整仓库自动合并设置。远端检查通过且批准满足时合并，核实 origin/main 包含合并提交；缺少他人批准时具体报告并保持 PR 可审阅。
