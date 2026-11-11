---
type: Review
title: Issue 334 双轴审查
description: 分别记录方案和最终实现的规范与需求审查及整改。
tags: [review, protocol, adapter]
---

## 实施前 Standards

固定基线 `3f83ecf4...7c55a2d4`，独立审查 AGENTS、CONTRIBUTING、现行规则及 Fowler baseline。硬性违规 0，设计异味 0。发现 plan.md 将 Schema 定义 AgentEnv 写成 AgentEnvWire，已修正。

## 实施前 Spec

同一规划 diff 对照 Issue 334，独立审查需求遗漏、扩大范围和解释错误。阻塞项 0；同样发现上述术语修正。准备度 96/100 可以进入实施。此结论仅代表规划覆盖性，不代表生产代码满足验收。

## 实施后审查

固定 diff `3f83ecf4...b645a474`，按 code-review 技能并行两轴审查；包括 #334/#335 最终实现，没有把方案评分当作代码结论。

### Standards

首轮 2 项：P2 Claude MCP 写入失败后清理再次失败会覆盖主错误；P3 stateless 现行规则仍宣称导出已删除工作区准备工具。对应生命周期规则的主根因保留、AGENTS 的现行规则回写要求。已按主错误 cause 的 AggregateError 和准确导出说明修正；需完成修复后验证及复审。完整 Fowler baseline 无其他可操作异味。

### Spec

首轮 1 项 P2：公开 prepareInvokeInput 总是填当前 parts，使仅显式 freshFallbackModelInput 的调用在 Codex/ACP/Grok 恢复时丢失恢复文本；显式 modelInput 有同类载体优先级问题。违反 #334 调用方完整输入与恢复材料所有权。修复明确文本/parts 选择：公开纯文本显式 modelInput、fallback parts 优先于 fallback 文本，有图片时保留完整 parts 与恢复守卫，不通过比较正文猜测意图。补公开入口到真实 Adapter 分支的手动回归，修复后复审状态单独记录。

首轮两轴分别为 Standards 2（最高 P2）、Spec 1（最高 P2）。

## 整改后复审

固定最终生产 diff `3f83ecf4...df754e94`，重点复查 `b645a474...df754e94`；由原两轴独立审查者复审，不包含随后补写的验收文档。

### Standards

硬性违规 0，完整 Fowler baseline 可操作异味 0。Claude P2 和规则 P3 均关闭；明确字段选择保留图片恢复守卫，未发现新的职责、生命周期或错误保留问题。相对基线 `.github` diff 为空，专项保持手动运行。

### Spec

剩余 finding 0，无新增范围。原内容选择 P2 关闭：纯文本显式主输入和恢复优先级明确，35 项公开入口到实际 Adapter 分支断言覆盖恢复缺会话、正文相等与混合顺序。工作目录所有权和错误原因保留未受影响。

最终两轴分别为 Standards 0、Spec 0。完整构建、静态、文档、1609 项全量（1548 通过/61 跳过）、55 手动专项与重打双包外部验证通过。模拟 Provider 不证明真实服务兼容；Windows 权限未实机验证，Gateway 未迁移。原真实验收与最终整改的来源差异见 validation.md。
