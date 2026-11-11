---
type: Journal
title: Issue 348–351 执行信封清理实施
description: 记录协议删减、Adapter 私有合同归属及本地和真实验证的实际范围。
tags: [architecture, context, protocol, adapter, validation]
---

# 实施结果

用户在规划后授权开始实施，并明确 adapter.xxx 不应形式化进入公共 protocol。基于 main@7892ebdf 的独立 worktree 完成四项联合清理：来源分类、公共业务材料及专用合并、Provider 默认值哨兵、公共 actmode 和其专属回执均移除。ContextItem 只保留 namespace/name/payload；失去用途的 ContextMcpLocator 及发行导出一并移除。

Codex、Claude、ACP、Grok 的原生模式读取归各包；OpenCode 按实际传输支持处理。OpenClaw 的既有选项、缺省、目标校验与示例写入包 README。公共文档只解释通用机制并链接各包，不登记 adapter.xxx、字段或统一模式。来源、输入、输出、Schema、架构规则与指南已同步；limits.enforcement 和 runtime selection 未扩展处理。

本地完整回归 1453 通过、61 条既有 opt-in/环境用例跳过、0 失败；最终协议及手动相关验证 269 通过。构建/类型、lint、命名、格式、双语文档、Runtime 发行包和独立 client 包外消费验证通过。详细命令、版本、修正过程及限制见 [validation](../../tasks/348-351-context-envelope/validation.md)，实现者自查见 [review](../../tasks/348-351-context-envelope/review.md)。

真实 Codex、Claude、OpenCode 执行与续接成功。Grok 原生模式请求被接受，但模型执行未完成；用户补充 Grok 需要翻墙，按网络环境限制记录，超时取消后的清理已确认。没有以 fixture 通过代替真实模型通过。Windows/Electron、真实 OpenClaw 和仓外 Gateway 迁移未验。

所有新增专项保持本地手动；CI 工作流、矩阵、必需状态、脚本入口及 Gate 未扩张。原 checkout 未动；未提交、推送、创建 PR、合并或发布。

## 用户要求 code-review 与 autofix 后的收尾

按 code-review 技能分别派发 Standards/Spec 独立评审，基线仍为 7892ebdf 的完整未提交改动，包含新增文件。Standards 的 1 项 P3 未使用 interface 建议已处理；Spec 的 2 项 P2（ACP 注册类型覆盖后私有模式被忽略、PublicObjectMaterial 业务定义残留）已复现、修复并经原审查者复核关闭。

修复后全量 1452 通过、61 跳过、0 失败；比初次少的一项是随业务定义移除的专属测试。八项专项通过，构建类型、lint、文档及最终双包消费复验通过。两轴均无未关闭发现，不扩大 CI，仍未提交。旧准备回执/执行投影、runtime selection 和 limits.enforcement 的后续判断见 [剩余清单](../../tasks/348-351-context-envelope/followups.md)。

## 临时删除闭包扫描

按用户追加要求在系统临时目录编写 AST/Schema/公开导出及双包 lint，未接入仓库或 CI。实际查出四个真实验证脚本仍构造旧 agent item，以及公共 failure 中两处 Codex 私有配置路径提示，均已清理。私有超时选项及现有默认行为仅由 Codex 包 README 解释。979 个源码/构建/发行文件条目、91 个文档代码块、4 份 Schema 复扫 0 项；全量 1452 通过、61 跳过，24 项手动回归通过。扫描边界、刻意保留的旧输入拒绝字符串及临时报告位置见 [验证](../../tasks/348-351-context-envelope/validation.md)。

## 用户确认整组删除旧准备回执和投影

ContextPreparationReceipt、RunContextProjection 已从 Schema、生成类型、公开导出删除，相关专属手动用例及类型断言一并移除。两个定义不再作为后续候选保留；执行配置继续通过现行 AgentEnv 条目，实际状态使用现行 Host 回执及事件。全量 1452 通过、61 跳过，相关手动 12 项通过，最终双包消费验证通过，扩展临时 lint 复扫 0 项。详细命令见任务 validation。未增加 CI 或提交。

## 调用方寻址边界与 runtime selection 删除

用户确认 octo-runtime-client 向已选定 Runtime invoke，设备寻址/候选/故障转移归业务调用方。原范围外 runtime selection 按该补充整体删除，连同 Schema、类型、校验器、catalog、routing_schema、专用合并和旧测试夹具。临时 lint 扩展静态/行为/双包检查并通过四类注入自检，最终 0 项；全量 1404 通过、61 既有跳过，相关手动 18 项和双包消费验证通过。默认套件减少的 48 项均对应删除合同，通用版本断言保留。未扩大 CI，未提交。
