---
type: Review
title: 执行信封清理双轴评审与自动修复
description: 记录 Standards 与 Spec 独立审查、三项发现的修复复核及后续清理边界。
tags: [review, context, protocol, adapter]
---

# 自查范围

基线 7892ebdf2ed9b1fa859bd51f15da6d7f03c247e2，当前未提交工作树。首轮为实现者自查；2026-11-10 用户明确要求 code-review 与 autofix 后，按 `/Users/lvsijia/.agents/skills/code-review/SKILL.md` 启动 Standards 与 Spec 两个独立审查 Agent，再由主 Agent 修复并交回原审查者复核。

`HEAD` 等于基线，无新增提交；实际审查命令为 `git diff 7892ebdf2ed9b1fa859bd51f15da6d7f03c247e2`，补读 `git ls-files --others --exclude-standard` 的新增源码、手动测试与任务文件。仓库无 docs/agents/issue-tracker.md；已告知技能 setup 入口，本次直接使用已明确的 #348–351 和任务 spec，不阻塞工作。

## Standards

原发现 1 项 P3 判断项：三个新 options interface 没有消费者，实际 reader 另写联合类型和校验，属于无需求的重复声明。已删除 CodexModeOptions、ClaudePlanOptions、GrokModeOptions，保留各包私有 reader，未为去重引入统一模式抽象。独立复核关闭此项，未发现硬违规或新增架构越界。**未关闭 0 项。**

## Spec

原发现 2 项 P2，均在修复前用手动回归复现失败：

1. ACP 私有模式读取使用 definition.type，工厂 metadata.type 覆盖后显式配置被忽略，仍返回 run.completed。现固定构造时最终 metadata，并以最终注册 type 读取 modeId；注册类型覆盖、缺省、原始/无关命名空间的手动回归通过。
2. PublicObjectMaterial 仍在公共 Schema 定义 task/discussion/mention/history 业务分类，经 RunContextProjection.object_materials 与发行导出暴露，无生产消费者，#349 删除未闭合。现移除类型、投影属性、生成类型、发行导出和只服务该旧定义的测试；删除闭包专项通过。

独立复核确认两项关闭，另运行两项定向测试，2 通过、0 失败。未发现修复新增问题。**未关闭 0 项。**

## 首轮自查覆盖

- #348：Schema、生成类型、SDK、全部内置 metadata、CLI loader 及测试/样例均移除来源声明。defineAdapter 不再读取 agentSources；工作目录豁免只由 workspace:false 决定，旧 preset item 不能绕过路径校验。
- #349：ContextItem 只含 namespace/name/payload；移除内容类型、catalog、references 身份合并及失去用途的 ContextMcpLocator/发行导出。双轴 review 进一步删除 PublicObjectMaterial 和 object_materials。未知 payload 仍为 opaque，顶层旧字段拒绝；未添加业务渲染、历史拼接或 registry。
- #350：selection.id、reasoning.effort 存在时必填，旧 sentinel 和空 setting 在 Adapter 消费时拒绝。通用信封不承担 payload 语义。显式 defaults 组合仍可补值，调用方先移除覆盖的责任已在文档和测试体现。
- #351：删除公共 actmode、ExecutionEvidence、execution.update 和 native execution evidence；session evidence、plan.updated 保留。私有名称/字段只由消费包及其 README 定义，不进入公共 Schema、catalog 或生成类型。通用 SDK 原有 item reader 不注册私有约定。
- 模式失败不改选其他模式；Claude plan 不扩大审批权限；OpenCode JSON 路径显式拒绝 modeId。Codex fresh fallback 的模式 settings 重新取新线程模型，已用不同新旧模型的 RPC fixture 验证。
- OpenClaw 保留原有 options、目标检查及 workspace:false；其 nullish agentId 默认行为未改动，包文档已按实际代码注明。未改变远端认证或 Agent 配置。
- Schema 从生成器生成类型；两份发行物均验证包外导出与消费。旧 invoke.agentSource 仍出现在旧字段拒绝清单中，这是拒绝旧 API，不是保留来源分类。

## 验证过程中修正

删除 execution.update 后，watchdog bookkeeping 用例的时间推进少了 10ms；改为根据剩余记录数推进到原 100ms 截止点，没有更改 watchdog 实现或预算。真实脚本原先给 OpenCode 统一 default 值，新合同正确拒绝；脚本改为包级模式场景，未恢复 default→build 映射。实际 OpenCode plan/省略复验通过。

## CI 与交付边界

相对目标 origin/main，`.github/`、package.json、pnpm-lock.yaml 无 diff。既有 CI 的 check、verify-windows-release、gate 及触发条件/矩阵/依赖保持原样。默认测试只迁移受影响断言并删除已无对应业务合同的测试；当前八项专项放 test/manual，真实脚本和包外 client 检查显式本地运行。发行验证脚本只删除不再成立的 DSH 公共 actmode 断言，未加入专项门禁。

没有未关闭的本次双轴 review 发现。仍保留的旧协议候选及边界见 [后续清单](followups.md)，真实 Grok、Windows/Electron、仓外 Gateway 的限制见 [验证记录](validation.md)；不能据此宣称全部生态已兼容。未提交、推送、创建 PR、合并或发布。

## 临时 lint 的追加发现

用户担心删除不彻底后，独立临时 AST/Schema/导出/发行物扫描另发现四个验证脚本的旧 agent item，以及公共 failure 中两处 Codex 私有配置路径提示。六处均已清理，路径提示归 Codex 包 README，错误分类与重试语义保持。复扫 0 项，回归通过；这批发现不冒充前述两个独立 Agent 的审查结果，详见 [临时 lint 记录](validation.md#用户追加的临时删除闭包-lint)。

## 旧准备回执与投影整组删除

用户进一步明确要求删除 ContextPreparationReceipt、RunContextProjection。已删除两份完整 Schema 定义、重新生成的类型和 src/index.ts 导出；移除 caller-workspace-protocol-335 中的专属 Schema 正向用例，以及类型 fixture 对旧回执 workspace_mode 的断言。共用测试文件仍有现行 workspace/错误分类等用途，保留其余用例。现有手动删除断言和临时 lint 已覆盖两类及其默认值投影字段；没有兼容别名，后续清单不再将其列为候选。此轮为实现者自查，未重启独立评审 Agent。

## runtime selection 删除自查

用户明确调用方寻址边界后，整组删除设备选择类型、校验器、catalog、routing_schema 和专用合并。专属测试/夹具移除，通用版本合同断言迁到既有测试文件，现行 IPC/身份/连接恢复不受影响。临时 lint 还验证旧文件与夹具不存在、未知同名 item 不继承路由策略，并以四类内存注入残留验证规则有效。源码、构建、双包均 0 项发现；全量及手动回归通过，详见 validation。此轮为实现者自查，不标记为独立 Agent 复审。

## 静默通知阶段的独立删除闭包复核

用户追加 verify/quality 与专项子 Agent要求后，由协议子 Agent重新检查先前已删除的旧回执、投影、runtime selection及公共业务字段。源码/构建/公开入口未见残留，重新打包后归档亦通过。独立临时110项协议断言和201项定向回归通过，详细证据见[新任务审查](../runtime-model-output-idle/review.md)与[验证](../runtime-model-output-idle/validation.md)。本段是后续独立复核，不改写上文“当时仅自查”的历史事实。
