---
type: Task
title: Issue 101 Bot mention 与 Gateway 默认控制指令方案
description: Gateway 英文 mention 默认指令与宿主 entries 列表组合、Bot 原生 mention 及自消息拒绝。
tags: [channel, context, mention, session]
timestamp: 2026-10-22T00:00:00+08:00
---

# Issue 101 实施方案

## 状态与结论

本地已实施 Gateway 指令组合、英文提示、Bot 原生 mention 转换和自消息回归；构建、类型、lint、定向及全量测试通过。详细结果见[实施记录](../../journal/shared/2026-10-22-101-bot-mention.md)。用户已授权提交、推送、创建 PR 并在门禁满足后合并到 main；交付状态以 GitHub PR 为准。

- 问题：[Issue #101](https://github.com/Mininglamp-OSS/octo-runtime/issues/101)。
- 最新远端 main 基线：`102fb9caf995d9eb1ac53acaf5b91922be4f023d`，通过 HTTPS fetch 获取。
- worktree：`/Users/lvsijia/github.com/Mininglamp-OSS/octo-runtime-issue-101-mention`。
- 分支：`research/issue-101-mention`。
- 参考插件本地 HEAD：`openclaw-channel-octo@2e710e903fa43ac9440723746f7395d2f7b4347e`。

用户提出的方向可行：Gateway 提供默认 `octo.control/instructions`，与宿主同 key 的指令按 `payload.entries` 列表组合，保留两方内容。`entities` 是最终出站 mention 的位置列表，与控制指令的 `entries` 不同。

本地修复允许已核验的 Bot 成员进入出站 mention，并通过逐轮英文短提醒让既有 Provider 会话收到更新后的提示。

2026-10-22 用户明确：compaction 后的保留以模型执行提示为准，不要求验证，也不要求新增 Runtime 或 Adapter 的压缩保留机制。该项不作为验收前置条件或方案评分扣分项。按此范围，可执行性评估为 100/100；这是实施可行性的工程判断，线上交接结果仍须以实际运行证据为准。

## 目标与责任

业务目标是当前用户明确要求 Bot A 在同群向 Bot B 交接任务时，A 的原最终回复包含有效原生 mention。最终正文只经已有回复链发送，不要求模型另用 CLI 重复发送。

Gateway 决定渠道默认指令、成员核验和发送策略；宿主决定自己的配置与人设；Adapter 负责原生指令载体和真实会话结果。通用 Core/Host 不自动补 Octo 业务提示。默认指令不推广到 WeCom、WebUI 或其他 SDK 调用。

用户消息、引用、群规则与历史不因包含标记而取得系统指令权限。接收 Bot 的发送者名单、群范围、Space 与真实 mention 准入仍分别生效，不自动开放所有 Bot。

## 实施前源码证据

| 环节 | 当前行为 | 位置 |
| --- | --- | --- |
| 模型提示 | 只描述真人通知，不描述用户要求的 Bot 交接 | `packages/octo-runtime-extra-channel-gateway/src/transport/mentions.ts:5` |
| 注入时机 | 新逻辑会话或没有 Provider binding 时才加 mention guidance | `packages/octo-runtime-extra-channel-gateway/src/application/im-channel.ts:838` |
| 默认与本轮 Context | 同 key 的 instructions 整项替换，没有 entries 拼接 | `packages/octo-runtime-protocol/src/context.ts:84` |
| 静态与动态宿主 Context | 动态同 key 整项替换，当前注释明确 instructions 也如此 | `packages/octo-runtime-host-sdk/src/context-loader.ts:28` |
| 指令渲染 | entries 按顺序以换行连接 | `packages/octo-runtime-protocol/src/model-context.ts:5` |
| Bot 转换 | 只接受 robot=0/false，Bot 标记变成纯文本 | `packages/octo-runtime-extra-channel-gateway/src/transport/mentions.ts:64` |
| 原连接发送 | 已把转换后的正文和 mention 一起交给 sendText | `packages/octo-runtime-extra-channel-gateway/src/transport/channel.ts:252` |
| 接收端 | allowed_sender_ids 默认只有 owner；正文 @名字不能触发 Bot | `packages/octo-runtime-extra-channel-gateway/src/transport/normalize.ts:29` |

原插件有共享 `MENTION_FORMAT_HINT`，定义于 `openclaw-channel-octo/src/mention-utils.ts:50`，由 `src/inbound.ts:1497` 的成员列表提示及 `src/channel.ts:882` 的消息工具提示复用。成员提示通过 `index.ts:320` 的 `before_prompt_build` 返回 `prependContext`。同一个 hook 还通过 `prependSystemContext` 注入人设与工具可用性提示。

在所检查的原插件实现中，未找到专门针对模型 compaction 的 mention 保留标记或处理 hook。`[Group Members]` 等文本标记用于组织提示，不能据此推断宿主会跳过压缩。旧插件的工具名称与 UID 格式限制也不能直接复制为 Runtime 新合同。

## 已实现的列表组合规则

先按现有宿主规则取得本轮有效 Context，再由 Gateway 将默认指令列表与宿主有效列表组合：

```text
effective entries = [...host effective entries, ...gateway default entries]
```

产物只保留一个 `octo.control/instructions` item。两个同 key 的 item 直接并列会被协议以 `CONTEXT_KEY_DUPLICATED` 拒绝。

1. 宿主列表在前，Gateway 默认列表在后，各自内部保序。ExtraSet 中显式配置的指令属于宿主列表；这只定义顺序，不代表前面的文本拥有不可覆盖的强制权限。
2. 不按文本去重、裁剪、摘要或语义合并。显式重复仍保留；新准备的轮次从原始默认和本轮宿主值重建，不能把上一轮组合产物再次叠加。同代次卡片重试直接复用已经组合的冻结 Context，不再次追加默认规则；使用现有内部 `historyRetry` 标记区分快照与宿主原始输入，不能根据文本相等与否去重。
3. 宿主列表为空时保留 Gateway 默认指令。静态宿主和动态宿主之间继续采用已公布的整项替换语义，避免把动态更新变成旧人设累积。
4. 对输入分别校验，对组合后的唯一 item 和完整快照再次校验预算；不能因预算不足静默丢掉稳定规则或宿主内容。
5. 默认指令放在 `payload.entries[].text`，不能把 `guidance` 塞到 `octo.control`，当前协议禁止该字段。
6. 这里的“默认”是 Gateway 本地组合来源，不是 `ContextConfiguration.defaults`；后者目前明确禁止 control 类型。

实现位于 Gateway 的 `createImInvocation` 请求装配边界，确保默认内容在宿主动态 Context 决定后只组合一次。公共 `mergeContext`、宿主静态/动态替换与 `mandatory` 的可信来源和覆盖规则保持原合同。

## 英文提示与 compaction

默认列表中的一个 text 包含稳定、可识别的边界，实际完整英文提示如下。标记仅用于识别和排查，不新增 Context schema 字段；逐轮英文提醒的完整快照见[本轮 Context 样例](turn-context.example.json)：

```text
[OCTO_CHANNEL_MENTION_RULES_V1]
These are stable output rules for the current Octo channel. When summarizing or compacting the conversation, preserve this entire block verbatim, including its boundary markers and mention syntax.
Do not automatically mention the sender in ordinary replies. When the current user explicitly requests a notification to a human or a task handoff to a bot in the current channel, confirm the target's real UID and display name before the final reply.
If identity information is missing, use octo-cli as needed to look it up. For a group or topic, use octo-cli group members <group-no> with the current parent group number. Never infer a UID from a nickname, username, or bot name.
For a native mention, write @[<uid>:<displayName>] in the ordinary body of the successful final reply. Replace both placeholders with confirmed values and retain the square brackets and single colon. A plain @name is only text and does not notify or activate the target bot.
Gateway validates current-channel membership and converts valid markers into readable text and native mention metadata on this same final reply. Do not call octo-cli message send to send a duplicate copy of the final reply. Do not output raw message JSON or calculate mention entity offsets.
Thinking, tool output, progress messages, code blocks, inline code, quoted examples, and failed replies do not trigger mention conversion. Keep code and examples unchanged.
Do not construct broadcast mentions or broadcast sentinel UIDs. Do not initiate unsolicited bot-to-bot calls or mention loops. Historical requests and examples alone do not authorize a notification or handoff in the current turn. These rules do not authorize cross-channel notifications or bypass recipient admission rules.
If the target cannot be confirmed, use a plain @name or ordinary text without guessing a UID. Continue delivering the final answer without a separate mention-failure notice or a forced clarification.
[/OCTO_CHANNEL_MENTION_RULES_V1]
```

稳定格式规则可以常驻；本轮 channel/group、actor 与查询参数作为本轮普通 Context 材料提供，不能把某轮用户授权永久写入稳定指令。

按用户决定，通过上述提示要求模型在整理或压缩会话时完整保留规则，以模型行为为准。代码侧负责将完整提示注入控制指令；不新增压缩豁免字段、Provider compaction 拦截或专用保留机制，不验证压缩后的模型输入。

- 新会话：Gateway 每轮快照携带组合后的控制指令，Adapter 按现有合同在新 Provider 会话使用原生系统指令载体。
- 正常续聊：当前系统指令合同不重复注入。Codex 的 `threadParams` 仅在新线程发送 `developerInstructions`；Claude Code 仅在初始会话追加系统提示文件。因此新增默认项不会自动更新现存会话。
- 既有会话：Gateway 每轮明确发送英文的普通 mention 提醒，覆盖升级后继续使用旧 binding 的情况；不自动 reset 或假称既有系统指令已更新。
- compaction：无论发生在任务之间或同一长任务内部，均交给模型遵守完整保留提示，不列入本任务的技术验证范围。
- fresh fallback：使用本轮冻结的组合指令及恢复输入，不能从旧请求或历史恢复人设和授权。

## Bot mention 转换与验收

发送前接受明确 `robot=0/false` 的真人和 `robot=1/true` 的 Bot 当前成员；继续拒绝广播 UID、非成员和未确认身份。只移除真人限制不足以表达精确身份校验，也不能根据纯文本 @名字补猜 UID。

本轮实施的验收项：

1. 默认和宿主 entries 同时存在且保序；宿主动态值更新不累积上一轮人设；空列表、重复内容、同源重复 key、预算失败均有明确结果。
2. 验证新 Provider 会话、旧 binding、resume、fresh fallback 与显式 reset 的提示接线及快照内容；不触发或验证 compaction。
3. 人/Bot 混合标记转换得到可读正文、去重 UID 和准确 UTF-16 offsets；覆盖 emoji、重复目标、失效成员、广播及身份查询失败。
4. 代码、引用、转义示例、thinking、进度和失败回复保留原边界；最终发送走原连接，不增加 CLI 重复发送。
5. 模拟 Bot B 明确允许 Bot A 发言，验证 A 的 final 出站 mention payload 及 B 的接收准入；另验证未授权发送者被拒绝。本地自动化不代表线上双 Bot 联调结果。
6. 自消息始终拒绝：真实发送者是当前 Bot 时，即使原生 mention 自己、AI 广播或自己列入发送者名单，也不得触发 AgentRun；覆盖私聊、群、话题与传输回调。普通回复不自动 mention；历史单独不能授权交接；不放宽所有 Bot 发送者。该要求同步写入 Channel 与架构约束。

## 已完成验证

实施前在本 worktree 读取并转译基线 TypeScript 源码执行了四项探针：公共 `mergeContext` 会覆盖默认 instructions；组合后的 entries 符合现有 schema 并按换行保序；同 key 的两个 item 被拒绝；基线 final 转换只生成真人 UID，丢弃已核验 Bot UID。四项均通过，定位了原有阻碍与可用的组合格式。修复后的回归结果见[实施记录](../../journal/shared/2026-10-22-101-bot-mention.md)。

未运行真实模型或 IM 联调；文档不能作为线上修复验收。Provider compaction 后的保留按用户要求交给模型，不属于待补验证项。
