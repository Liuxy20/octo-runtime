---
type: Review
title: Issue 334 Channel Gateway 旧消费者审计
description: 记录独立 Gateway 的指令消费者、输入次序、会话策略及尚未实施的迁移顺序。
tags: [review, channel, protocol, migration]
---

# 审计范围

只读检查独立仓库 `octo-channel-gateway` 的 main `9ce35ccbc3a8c55abe6890913c295dd622b49170`；审计时工作树干净。Gateway 的 Runtime client 依赖为 `^1.1.12`，开发依赖使用相同 Runtime 版本。本次未修改该仓库、运行其测试或验证线上部署；不检查 Work App，不声称覆盖其他仓外消费者。以下路径均相对于 [Gateway 仓库](https://github.com/Mininglamp-OSS/octo-channel-gateway)。

## 配置与旧指令入口

| 路径 | 当前行为与迁移要求 |
| --- | --- |
| `packages/gateway/src/contracts.ts:42` | `bot.context` 使用 Runtime ContextEnvelope。旧业务配置依赖已删除的公共 item，须先迁移 Gateway 配置边界。 |
| `packages/gateway/src/lifecycle/configuration.ts:80` | 使用 Runtime assertContextEnvelope 校验 bot.context；直接升级 Runtime 会在业务编译前拒绝旧指令项。 |
| `packages/gateway/src/support/context-loader.ts:34-55` | 静态和动态 Context 都先校验再合并。同 namespace/name 的 item 原位置替换，新项追加；instructions.entries 整体替换，不自动拼接。迁移须明确保留或调整这项业务语义。 |
| `packages/gateway/src/execution/dispatcher.ts:149-174` | 导入 ContextInstructionsPayload；仅在非 historyRetry 且 refreshStableContext 时，取宿主 instructions.entries 再追加 MENTION_GUIDANCE。须改为 Gateway 自己的业务数据类型与普通文本编译。 |
| `packages/gateway/src/execution/model-input.ts:3` | 只渲染 extra.* 与 octo.content/inline、references，不渲染 octo.control。仅删 agentEnv 过滤会静默丢提示词，必须同时调整编译入口。 |

## 普通输入次序与执行配置

`packages/gateway/src/execution/kernel-input.ts:17` 把业务 Context 渲染为前缀，经 Query Input 分隔符后接当前请求；生成一个前置 text part，再保留原始文字和图片 parts 的相对顺序。当前第 21-27 行将 execution/security 与 octo.control/instructions 提取进 agentEnv。新边界应由 Gateway 将需要的应用提示词、业务材料和当前请求编译为普通文本/图片输入，明确顺序；Runtime 不再额外前置、添加分隔符或赋予系统角色。

同文件第 49-51 行还处理 modelInput、freshFallbackModelInput 和 freshFallbackModelInputParts。因此主 inputs 与这三个显式载体都要各自形成完整内容，每份只编译一次，不能只迁移其中一种。凭据合并继续只进入 agentEnv/envs，保留 Windows 环境变量键大小写处理；不得把 token、MCP 或 env 配置渲染成正文。

`packages/gateway/src/execution/task.ts:307` 使用准备好的 inputs/agentEnv 调用 Runtime。重试复用冻结 Context，仅更新剩余执行 limits；迁移后也应复用已冻结的普通输入，防止刷新或二次前置导致内容变化。

## 新建、续接与恢复策略

`packages/gateway/src/application/stable-context.ts:8,17-27` 的默认刷新周期为 30 轮；首轮、周期点或 refreshPending 时刷新。`packages/gateway/src/application/im-channel.ts:1187,1206` 还结合 Provider 会话缺失或不可续接等状态选择刷新；historyRetry 使用冻结的原 occurrence。旧 Runtime 的 initialControlInstructions 会在续接时抑制指令。删除该机制后，Gateway 必须显式决定每轮普通输入是否携带提示词，不能假定 Runtime 仍按会话状态处理。

`packages/gateway/src/application/rules-context.ts:109-137` 生成显式 fresh 恢复输入，次序为恢复文本后接原始混合输入；kernel-input 随后再前置本次已渲染的 Context。`im-channel.ts:1320-1341` 补充被省略的恢复材料，冻结的 historyRetry 则恢复已保存 fallback 文本/parts。迁移应保留调用方选择的恢复次序和图片，不丢恢复材料，也不重复增加提示词；图片无法取得仍应显式失败。

## 后续 Gateway 迁移与发行顺序

1. 在 Gateway 建立自身业务提示词配置、校验和编译合同，先迁移静态/动态配置，使旧 item 不再进入 Runtime 的通用 Context 或 agentEnv 校验；准备期间保持旧消费者依赖与配置组合。
2. 同步 dispatcher、model-input、kernel-input 与恢复路径，让所有显式输入载体包含完整普通内容，保留业务选定次序、冻结快照和重试语义；不换名恢复 Runtime 的 system/developer/受信注入。
3. 更新 Gateway 的 `test/im-mention-instructions.test.js`、context-loader、kernel-input、model-context/run-context、im-context-gap 等相关测试，以及 `docs/{en,zh-CN}/concepts/inputs-and-agent-env.md`、`guides/contexts-and-credentials.md`、`migration.md`。使用匹配的新 Runtime/client 双包产物验证依赖安装与消费者行为。
4. 协调发布和部署。旧 `^1.1.12` 消费者不能在配置/编译入口尚未迁移时直接采用本次删除 API 的版本，也不能以本仓 Runtime 测试通过代替 Gateway 端到端验收。具体 npm 版本由既有发行流程决定；本次不发布 npm。

本记录是具体消费者差距与后续实施依据，不是 Gateway 已兼容或已完成迁移的证明。
