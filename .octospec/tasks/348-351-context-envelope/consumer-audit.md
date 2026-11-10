---
type: Review
title: 最新 Gateway 依赖与 actmode 回执删除边界审计
description: 固定远端核对版本，列明真实消费者、迁移步骤及必须保留的通用承载结构。
tags: [context, protocol, adapter, migration]
---

# 版本与证据

- Runtime：本 worktree `7892ebdf2ed9b1fa859bd51f15da6d7f03c247e2`。
- Gateway：2026-11-10 通过 `gh api repos/Mininglamp-OSS/octo-channel-gateway/commits/main --jq '.sha'` 核对远端最新为 `beb804933ff34e75225645a34b1a7fd038c52ad8`，与本地 origin/main 相同。以下检查全部使用 `git show/git grep origin/main`，未使用落后的 checkout 文件。
- Gateway 的 SSH fetch 无输出等待后已终止；没有把此次 fetch 写成成功。远端 API 与本地对象 SHA 相同提供了本次最新代码核对依据；未修改该仓库工作文件。

## Gateway 最新版本的迁移矩阵

| Issue | 最新代码中的实际依赖 | 迁移要求与验证点 |
| --- | --- | --- |
| #348 | execution/dispatcher.ts 由 Adapter 类型构造 agentSource，添加 agent item，并借 source 选择是否准备默认 cwd；test/fixtures 四个 Adapter 及两个验证脚本仍填 agentSources | 删除发出的 agent item 和 fixture metadata 字段；默认目录选择继续由 Gateway 的实际 Adapter/工作区策略决定，不复建 source 公共类型；验证 OpenClaw 与本地执行各自 cwd 行为 |
| #349 | contracts.ts、ports.ts、application 下 history/rules/stable/gap、delivery/artifact-policy、transport/contexts/message-trigger 仍用 Runtime ContextItem/ContextEnvelope 表达带 guidance/data_format 的业务数据 | 在 Gateway 自己定义业务材料类型、校验、预算和组合；历史、rules、引用及格式字段可以继续存在，但不能再依赖 Runtime 的执行 item 类型和校验器 |
| #349 | lifecycle/configuration.ts、support/context-loader.ts、execution/dispatcher.ts 和 transport/contexts.ts 在渲染前调用公共 assertContextEnvelope；dispatcher 还对混合业务/执行快照调用 mergeContext | 在业务层分离自有材料与最终执行配置；业务侧自行组合和校验，只有最终 agentEnv 使用 Runtime 校验；不能只改 TypeScript 类型而遗留旧运行时校验 |
| #349 | execution/model-input.ts 自己渲染 guidance/text/JSON；kernel-input.ts 把模型材料排除出 agentEnv，构造有序 primary/recovery inputs | 保留 Gateway 自己的渲染格式和重试/恢复保序策略；改其参数为业务自有类型；验证最终 agentEnv 不带顶层 guidance/data_format，inputs 含既有必要材料 |
| #350 | 最新生产 dispatcher 已以显式 model/effort 构造 item，均无覆盖时不添加；最新源码与测试搜索未发现 use_provider_default | 不恢复旧 checkout fixture 的哨兵设计；覆盖无 model、仅 model、仅 effort 的当前路径；应用配置中需要清除覆盖时在 Gateway 的最终快照构造前处理 |
| #351 | 最新 Gateway 源码、测试、脚本中未发现 actmode、execution.update 或 actmodeEvidence 消费 | 目前无已知模式回执依赖迁移；未来需要模式功能时按目标 Adapter README 构造私有 item，不新增 Gateway 对 Runtime 公共 actmode 的依赖 |

以上路径均相对 Gateway 的 `packages/gateway/src/`，fixtures/scripts 除外。该仓库 package.json 的正式 client 依赖与 dev runtime 依赖均为 `^1.1.13`；升级实际版本的发布顺序需检查破坏性合同，不能只改依赖范围后宣称兼容。

Gateway 实施是仓外工作，本任务只完成迁移识别和交付说明。可以交付 Runtime 代码及说明，但不得宣称最新 Gateway 可直接升级；在 Gateway 完成迁移和真实调用验证之前，业务联合升级状态为未验证。此判断不要求扩大 CI 或新增发行 Gate。

## Runtime actmode/evidence 删除闭包

当前 ExecutionEvidence Schema 只有必填 actmode，`additionalProperties:false`。生产搜索确认：产出方只有 adapter-sdk 的 actmodeEvidence 及调用它的 Codex、Claude、ACP、Grok；没有独立的其他 execution evidence payload。

| 层 | 删除或迁移位置 | 操作 |
| --- | --- | --- |
| Schema | ContextActmodePayload、ExecutionEvidence、HostControl 的 evidence/name=execution 分支、canonical type enum 的 execution.update | 删除并重新生成 protocol-types.ts；不得保留空占位类型 |
| protocol | src/actmode.ts、index.ts 的导出/CANONICAL_EVENT_TYPES/事件校验、run-protocol.ts 的 execution evidence 校验 | 整体删除专属 helper 和分支，更新正反样例 |
| adapter-sdk | src/actmode.ts 及导出、agent-env.ts 的公共 actmode 校验 | 删除，私有模式校验放到消费包 |
| 产出 Adapter | Codex app-server、Claude、ACP、Grok 的 actmodeEvidence 调用 | 迁移私有配置，去掉公共回执；必要诊断沿已有通道返回 |
| Core/Kernel/client/Host SDK/cross-service | 源码精确搜索 execution.update、ExecutionEvidence、payload.actmode、execution evidence | 未发现这些包拥有专属业务消费者；通用帧传递保持，不新增模式解释 |
| 直接测试 | test/actmode.test.js、test/grok-build-adapter.test.js、test/dsh-adapter.test.js、test-support/fake-actmode.mjs | 将既有受影响断言改为各包的原生请求、缺省和错误行为；不再等待统一 evidence |
| fixtures/样例 | protocol/test/fixtures/context-fixtures.json、docs/examples/contexts.json、protocol README 的事件表、双语 reference/contexts/providers | 删除旧合同描述，引用具体 Adapter README |
| 发行/真实脚本 | scripts/verify-release.mjs 的旧 actmode 输入，scripts/verify-actmode-live.mjs 的公共 item 和 evidence 收集 | 修正既有消费；真实脚本改为 Adapter 专属输入/证据，保持显式手动，不加入默认检查 |

必须保留：HostControl 的 session evidence 分支、session.update、plan.updated、原生消息、交互/取消/终态以及其他诊断。plan.updated 表达模型输出的计划内容，与“选择原生运行模式”不是同一合同。不能笼统删除名称含 evidence、plan 或 execution 的所有字段。

## 规划检查结果

已闭合此前“有无其他 execution evidence 消费者”的未知项，并识别最新 Gateway 的真实阻断点。以上为源码和合同审计，不是编译、Provider、IM 或双包验证结果。具体实施输入合同见 [Adapter item 设计](adapter-items.md)。
