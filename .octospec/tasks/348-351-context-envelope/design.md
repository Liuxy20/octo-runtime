---
type: Design
title: 执行信封清理的模块归属与迁移方案
description: 说明四个 issue 的共同改动位置、私有配置边界和默认值迁移风险。
tags: [architecture, context, protocol, adapter]
---

# 基线事实

当前 `main@7892ebdf`：Core 的 `prepareInvokeInput()` 只读取 adapter 路由并复制输入；agentEnv payload 由 Adapter 消费。adapter-sdk 仍通过 `invocationAgentSource()` 校验来源，`defineAdapter()` 校验 metadata 支持范围，`assertAdapterWorkdir()` 以 preset 免除缺 cwd 检查。OpenClaw 已有 `workspace:false`，私有 options 的 `agentId` 不依赖来源分类。

`context.ts` 仍接受 guidance/data_format，并在 `mergeContext()` 中合并 resource references；catalog 仍登记 inline/references。`context-configuration.ts` 是显式导出的配置组合工具，不是 Core 的执行步骤。model helper 只读取 id/effort，默认值哨兵本身不传给 Provider。

actmode 的当前实现分布在 protocol、adapter-sdk、Codex、Claude、ACP、Grok 和 DSH。Codex 通过 collaborationMode/list 发现原生模式并写入 turn/start；Claude 通过 permission mode；ACP/Grok 通过 session mode；DSH 拒绝非 default。公共 execution.update 和 native execution evidence 当前与统一 actmode 类型耦合，删除输入时必须同时清理输出消费者。

## 模块改动表

| 模块 | 计划修改 | 必须维持的边界 |
| --- | --- | --- |
| protocol Schema 与生成器 | 删除来源、内容、默认值哨兵和公共 actmode 定义及引用；从 Schema 重新生成类型 | 不手工只改 generated 文件；保持信封预算、JSON 和公共执行设置 |
| protocol helper/catalog/exports | 删除 obsolete 导出、resource 专用 merge 和公共 actmode 读取/回执校验 | 不增加业务注册中心，不以内容名称驱动模型渲染 |
| adapter-sdk | 删除 source 默认项、source metadata 要求、source 目录豁免和公共 actmode helper；简化 model 校验 | 仍提供通用 item 读取、组合、工作目录和执行配置校验；不定义 Codex/OpenClaw 专用 payload |
| Core/Kernel/client | 清理已移除 evidence 分支、类型和消费引用，保持必要 RPC 接线 | 不添加 Provider 模式解释，不改变接纳/终态/清理的区别 |
| 各 Adapter | 删除 agentSources；把现有模式操作改由本包私有配置触发 | 省略模式不额外发现或设置模式；私有字段不决定其他 Adapter 行为 |
| CLI 与公共导出 | 删除 metadata 校验中的 agentSources 要求；更新公共样例和 fixture | CLI 不恢复来源分类、不替宿主设 Provider 模式 |
| 当前规则与双语文档 | 修正来源/actmode/旧内容类型说明；公共 SDK 文档链接包级 README | 不把尚未实施方案写成当前保证；历史 journal 不批量改写 |

## 私有 AgentEnv.Item 与包级文档

实现字段、校验、缺省、原生操作和审批优先关系已在 [各包私有 item 实施合同](adapter-items.md)确定：Codex options.collaborationMode、Claude options.permissionMode、ACP/Grok options.modeId；OpenClaw 沿用自己的 options.agentId。它们是各包的私有约定，本设计不创建中央注册表，实施后以各包 README 为权威说明。

| Adapter | 私有配置归属 | 要保留的原生操作及验证点 |
| --- | --- | --- |
| Codex | `packages/octo-runtime-adapter-codex`、`adapter.codex` 命名空间 | discovery/selection/turn/start 都由 Codex 包处理；省略时无 mode discovery/set；显式请求按原生广告和实际响应判断 |
| Claude Code | `packages/octo-runtime-adapter-claude-code` 的私有 item | 原生 permission/plan 行为由该包定义；必须核对与公共审批策略的优先关系，不因迁移扩大权限 |
| ACP 及派生 Adapter | 消费该设置的包、以实际 Adapter 类型为命名空间 | 传输层 session/set_mode 属于 ACP 原生机制；具体选项、名称映射、默认与失败语义不得放回公共 protocol/adapter-sdk |
| Grok Build | `packages/octo-runtime-adapter-grok-build` 的私有 item | 原生 set_mode 及当前特有选择逻辑归 Grok 包；不复用公共 default/plan 合同 |
| DSH | `packages/octo-runtime-adapter-dsh` | 删除公共 actmode 读取；没有现成可用功能时不为对齐其他包制造模式开关 |
| OpenClaw | `packages/octo-runtime-adapter-openclaw`、现有 `adapter.openclaw/options` | 保留已有 agentId 行为；包 README 维护其缺省、校验、目标存在检查、执行及示例；公共文档只链接 |

各包 README 必须写明 namespace/name、payload、必填/可选、缺省、校验、原生支持限制及组合示例。包内类型/helper 可以导出，但不得进入 protocol 公共生成类型或 adapter-sdk 的 Provider 专用模型。通用读取函数不等于私有字段定义。

## 默认值与配置组合

目标执行快照区分三种情况：仅 model ID、仅 effort、均省略。`selection:{}`、`reasoning:{}` 和空 model payload 不作为默认值表达；`use_provider_default` 即使值为 true 也按已删除字段处理。

显式配置组合 helper 仍可能将 defaults 中的 model/effort 带入结果。因此调用方要求 Provider 默认时，必须在构造执行快照之前去除对应覆盖，不能把省略 request 字段误认为自动清除 defaults。实现必须审查 `mergeContext`、`resolveContextConfiguration` 和 `withAgentEnvDefaults` 的真实调用点、样例及外部迁移，防止删除哨兵后悄悄恢复旧值。不增加 Runtime 内的隐式重置或第二种哨兵。

Provider 恢复会话可能沿用原生会话已有配置。省略仅保证 Runtime 不发送本轮覆盖，不保证恢复会话切回 Provider 的全局默认，也不因此重建会话。

## 删除与失败语义

顶层 guidance/data_format 和 model payload 中的旧哨兵，须在相应结构/消费校验中拒绝，不能静默丢弃。删除公共 item/catalog 后，信封仍允许未知 opaque item，不能为了捕获旧内容而新增业务 schema 注册或解析。实施时分别记录旧 source/actmode item 的迁移行为与遗留调用方风险，不把“通过结构校验”当作“设置已应用”。

已完成 [actmode/evidence 消费审计](consumer-audit.md)：ExecutionEvidence 只有 actmode，删除整个类型、execution.update 和 native evidence/name=execution 分支，以及仅服务它们的 helper/校验。HostControl 的 session evidence、session.update、plan.updated 和原生交互具有独立用途，继续保留。Core/Kernel/client/Host SDK/cross-service 未发现专属模式消费者。不得为保留原回执另建统一模式抽象；原生输出和必要诊断复用既有通道。

## 外部消费者与范围

已通过 GitHub API 核对最新 Gateway main 为 `beb804933ff34e75225645a34b1a7fd038c52ad8`，与本地 origin/main 相同；只读该 commit 的文件，无须切换或修改 Gateway checkout。最新版本仍借用 Runtime 类型/校验/merge 表达业务材料，必须将这部分移到业务自有合同；最新生产模型设置已采用省略语义，未发现 use_provider_default 或 actmode 回执消费。此前旧 checkout 中的哨兵观察不能作为最新结论。逐文件迁移要求见 [消费者审计](consumer-audit.md)，未宣称已完成仓外实施或业务联调。

用户后续明确调用方寻址边界，`octo.runtime/selection` 及其解析类型、校验器、catalog、routing_schema 和专用合并整组删除。该阶段曾保留 `limits.enforcement`；用户后续已另行授权[删除此开关及兼容分支](../remove-limits-enforcement/brief.md)，不再是当前待讨论项。
