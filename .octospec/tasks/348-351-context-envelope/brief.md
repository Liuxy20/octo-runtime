---
type: Task
title: Issue 348–351：执行信封与 Adapter 私有配置边界清理
description: 联合实施删除来源分类、业务内容公共合同和默认值标记，并将原生模式归还对应 Adapter 包。
tags: [architecture, context, protocol, adapter, schema]
---

# 目标与状态

本任务联合处理 [#348](https://github.com/Mininglamp-OSS/octo-runtime/issues/348)、[#349](https://github.com/Mininglamp-OSS/octo-runtime/issues/349)、[#350](https://github.com/Mininglamp-OSS/octo-runtime/issues/350)、[#351](https://github.com/Mininglamp-OSS/octo-runtime/issues/351)，包括 [#351 包级配置文档要求](https://github.com/Mininglamp-OSS/octo-runtime/issues/351#issuecomment-6765106016)。

2026-11-10 创建独立 worktree，基线为拉取后最新 `origin/main@7892ebdf2ed9b1fa859bd51f15da6d7f03c247e2`。已按后续“开始实施”授权完成代码、包文档和本地验收；真实 Grok 模型调用受网络环境限制，详见 validation。工作目录为 `/Users/lvsijia/.codex/worktrees/context-envelope-cleanup/octo-runtime`。

## 产品意图归属检查

| 对象 | 决定权、显式输入与合同内动作 | 越界动作及影响 |
| --- | --- | --- |
| 业务材料与历史 | 调用方组织 guidance、inline、reference、history 和格式，准备有序 inputs | Runtime 不建立业务 catalog，不读取资源、不拼接或合并历史；不要求其他接入产品采用统一正文格式 |
| 执行配置 | 调用方提交最终 agentEnv；Core 复制并保序传递，Adapter 消费实际执行设置 | 不从来源分类推导目录或目标，不在执行时恢复调用方省略的模型覆盖 |
| Provider 原生模式 | 宿主选择对应 Adapter 的私有 item；该包校验并映射到原生操作 | 不把 Codex collaborationMode 或 Claude permission mode 推广为公共 actmode |
| 私有配置文档 | 对应 Adapter 包 README 定义字段、缺省、校验与示例 | 公共 SDK 不维护第二份 Provider 专用配置模型或字段表；其他 Adapter 不解释私有 payload |

## 四项改动合同

1. **#348**：删除 `octo.execution/agent.source`、`AgentSource`、`metadata.agentSources`、校验/helper/默认值及 CLI 对这些字段的依赖。目录要求改由 Adapter 的实际 workspace 合同决定；本地目录仍由调用方预建，OpenClaw 保持 Provider 工作区。
2. **#349**：删除公共 item 顶层 `guidance`、`data_format`；删除 inline/reference 的公共 schema、类型、catalog 和业务专用合并逻辑。history、业务 extra 和正文格式归应用。review 补齐删除闭包：PublicObjectMaterial 及 RunContextProjection.object_materials 的业务分类与投影一并删除。私有执行 payload 仍为 opaque JSON。
3. **#350**：删除 `use_provider_default`。不覆盖模型或 effort 时省略对应设置；两者均不覆盖时省略 model item。显式 model-only 和 effort-only 保留。配置重置由调用方在执行前处理，不能用新的默认值标记代替。
4. **#351**：删除公共 actmode bean、helper 和 actmode 专属统一回执。原生模式由对应 Adapter 包私有 item 控制，配置定义、校验和默认行为归该包，README 是权威说明；包括现有 `adapter.openclaw/options`。adapter.xxx 不作为公共命名空间规范，私有字段不进入 schema/catalog/生成类型。

## 保留合同与范围外

- 保留 `octo.context-envelope/v3`、schema/items、namespace/name/payload、JSON/容量/唯一键约束和快照保序；不机械升级 Run=7、IPC=2 或 Adapter transport=2。
- 保留公共 Adapter 路由、model/effort、workspace、envs、MCP、limits、审批设置及现有身份、会话、取消与资源清理合同。
- #349 删除业务内容专用合并，不扩展为删除 envs/MCP/limits 的全部显式组合 API。Core 不隐式调用业务配置合并器；导出配置 helper 的输入语义和 #350 迁移在设计中单独核对。
- `limits.enforcement`、其他 metadata 改造、Provider 安装、Home/账号迁移、外部 Gateway 实施、部署和发行均不在本任务内。
- 不提供旧字段别名、自动格式转换或默认值哨兵兼容层。未知私有 item 继续按 opaque 合同透传，不能宣称删除 catalog 就等于拒绝所有同名 opaque 内容。
- 不提交、推送、创建 PR、合并或发布；这些操作按后续授权执行。GitHub issue/PR/commit 使用英文，保留配置的 Git 作者；授权提交时添加规定的 Codex trailer。
- 不扩大 GitHub CI；不增加 workflow/job/matrix/触发条件/必需状态/Gate，不通过默认测试开关增加专项。

## 验收与交付

实施检查点和可观察条件见 [实施与验收计划](plan.md)，模块归属、迁移及风险见 [设计](design.md)。已补齐 [Adapter 私有 item 实施合同](adapter-items.md)和 [最新 Gateway/evidence 消费审计](consumer-audit.md)，规划自评为 [97/100](assessment.md)，达到 95 分要求。当前 [验证记录](validation.md)记录实现、离线回归、真实 Provider 和发行包结果；[自查](review.md)记录合同及 CI 范围核对。当前规则已同步，历史 journal 保留为历史证据。

## 追加删除范围（2026-11-10）

用户明确要求整组删除 ContextPreparationReceipt、RunContextProjection 的定义、导出和专属测试。两者没有本仓生产消费者，是已移除准备/配置投影链的残留；同步删除 Schema、重新生成类型、清除公开导出及旧正向测试，扩展已有手动删除断言和临时 lint 验证源码、声明及双包。现行 HostRunReceipt、运行事件、session evidence 不属于这两个旧类型，limits.enforcement 仍在范围外；runtime selection 按后续用户确认纳入删除范围。

## 调用方寻址边界补充（2026-11-10）

用户明确业务方使用 octo-runtime-client invoke，寻址由调用方负责，并要求临时 lint 确保 runtime selection 删完。将其定义、校验器、导出、catalog、routing_schema、专用合并、测试夹具和示例纳入删除范围。保留现行 IPC endpoint、Runtime 身份、执行状态、客户端连接/恢复；不修改传输或实现新的寻址策略。

## 后续 enforcement 删除范围

以上 `limits.enforcement` 范围说明记录本阶段决策。用户随后另行授权[删除全局 enforcement 开关及兼容分支](../remove-limits-enforcement/brief.md)；当前合同以该任务和现行规则为准，阶段验证结果不因此改写。
