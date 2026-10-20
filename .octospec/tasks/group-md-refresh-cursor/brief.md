---
type: Task
title: GROUP.md 更新事件与本地规则游标修复计划
description: 联合处理 Issue 54 和 55，将规则更新通知与执行触发分离，由 Channel Gateway 按会话代次和规则版本决定注入。
tags: [channel, session, reset, context, storage, testing]
timestamp: 2026-10-20T00:00:00Z
---

# GROUP.md 更新事件与本地规则游标

状态：**本地实现及自动化验证通过。** 实现与实际验证范围见[交付记录](../../journal/shared/2026-10-20-group-md-refresh-cursor.md)。线上多 Bot 和真实 Provider 联验尚未执行。

- 统一跟踪 [Issue #55](https://github.com/Mininglamp-OSS/octo-runtime/issues/55)，关联同一问题链的 [Issue #54](https://github.com/Mininglamp-OSS/octo-runtime/issues/54)。#54 记录误触发，#55 补充延迟刷新及游标要求；本次不关闭或修改远端 issue。
- Runtime 基线：2026-10-20 执行 `git fetch origin main` 后的 `origin/main@6f5f25f97ec4b2ca879ac78ca2990ee2019f9eeb`。
- 分支：`fix/group-md-refresh-cursor`；独立 worktree：`/Users/lvsijia/github.com/Mininglamp-OSS/octo-runtime-group-md-refresh-cursor`。
- 后续入口：[实施计划](plan.md)；实际阅读与外部源码基准：[context.yaml](context.yaml)。

## 目标

用户编辑群规则只是更新后续对话的背景，不是在要求所有 Bot 执行任务。将两个 issue 作为一个修复任务：更新事件只使规则状态失效，下一条独立满足准入条件的请求才执行；Channel Gateway 用本地规则游标决定本轮是否需要提交规则 Context。

目标注入时机为：首次会话、`/reset` 或 `/new` 后的首次普通请求，以及已有会话发现规则版本变化时。普通续聊版本未变时不重复注入。本修复已将 `/new` 作为 `/reset` 同一控制分支的别名，复用现有代次和回复，不改变工作目录。

## 从问题到实现

1. 误执行的原因是更新通知走进了普通任务入口。因此在该入口前识别结构化规则事件并返回，不能靠模型理解通知后自行停止。
2. 是否带规则只取决于当前 Provider 会话是否已经获得当前版本。因此在现有 session binding 中增加一个 `rulesContext` 字段，统一保存失效计数和已提供的规则版本；不另建群资源表或独立状态服务。
3. 正常请求本来就会读取规则 API。保留读取，在 Gateway 比较返回版本与该字段，决定是否加入规则 Context；漏通知也能在下一次请求发现变化。
4. 只有成功执行后才确认本轮版本。失败时允许下次再带一次；事件使失效计数递增，旧任务不能用完成回调覆盖较新的失效。

这就是本修复的主体：**通知分流、一个 binding 字段、一次版本比较、成功后条件更新。** 下面的边界处理只服务于这条路径。

## 修复前源码事实

以下结论来自源码，不代表部署版本已验证。

| 环节 | 已确认行为 | 含义 |
| --- | --- | --- |
| 服务端用户编辑 | `modules/group/api.go:4368` 更新内容并取得递增版本，再异步调用 `sendGroupMdNotification` | 保存成功与通知送达是不同结果 |
| 服务端通知 | `modules/group/api.go:4586` 使用 `type: common.Text`、`content: GROUP.md updated`，附带 `event.type/version/updated_by`，并设置 `mention.uids` 为群内全部 Bot | 是文本消息载体，但包含结构化事件和真实点名；不能只按显示文案分类 |
| 服务端 Bot 编辑 | `modules/bot_api/groups.go:211`、`:822` 使用同类保存和广播路径 | 修复不能只覆盖用户端编辑 |
| 删除与版本 | `modules/group/api.go:4429`、`modules/group/db.go:932`、`:956` 删除时递增版本，广播 `group_md_deleted`；清空正文也属于一次更新 | 空内容或删除必须撤销旧规则 |
| 话题通知 | `modules/thread/api.go:867`、`modules/bot_api/threads.go:375` 产生 `thread_md_updated/deleted`，使用同类文本及点名载体 | 同一事件分类需要覆盖话题规则 |
| Gateway 接收 | [wukong.ts](../../../packages/octo-runtime-extra-channel-gateway/src/transport/wukong.ts) 保留完整 payload，非自身消息进入普通 `onMessage` | `event` 未在 WS 解码时丢失；自身发出的更新通知存在不同接收路径 |
| Gateway 准入 | [normalize.ts](../../../packages/octo-runtime-extra-channel-gateway/src/transport/normalize.ts) 按文本类型、发送者、群范围和真实 mention 判断，未识别规则事件；[channel.ts](../../../packages/octo-runtime-extra-channel-gateway/src/transport/channel.ts) 随即调用任务入口 | 更新者满足发送者白名单时，广播具备普通任务准入条件；并非无条件触发所有 Bot |
| 当前规则准备 | [contexts.ts](../../../packages/octo-runtime-extra-channel-gateway/src/transport/contexts.ts) 每轮读取并加入 `extra.im/group-rules`，话题还加入 `topic-rules`，携带 version | 不能把问题描述成“当前只在首轮读取规则”；目标是增加版本意识及选择性注入 |
| 当前会话状态 | [session-store.ts](../../../packages/octo-runtime-extra-channel-gateway/src/application/session-store.ts) 有 binding、generation、初始化标记和聊天 gap，无规则版本游标 | 现有聊天位置不能代替规则刷新进度 |

服务端来源为本地干净 checkout `Mininglamp-OSS/octo-server@5cf83f5725a6ce71f4944a9ce1a17038268375cf`，未在本次更新其分支。`common.Text = 1` 在本地 `octo-lib/common/msg.go:19` 核对。服务端版本、事件可信来源、实际广播覆盖及 Provider 续聊应用效果仍须后续联验。

## 关键合同

1. **事件与执行分离。** 合法规则事件在普通发送者/mention 任务准入前进入专用失效路径；仍校验当前连接、Space、群范围及资源作用域。普通请求的白名单不能阻止 Bot 感知管理员更新，但通知不得授予任何执行资格。
2. **通知不执行。** 即使通知携带全部 Bot 的 mention，也不得创建或排队 AgentRun、调用 Provider、产生执行/进度卡或发送确认回复。该约束同时适用于空闲、执行中和有排队任务的 Bot。
3. **识别依据为协议。** 使用当前群/话题地址和 `event.type` 的已知结构，禁止按 `GROUP.md updated` 文案匹配。沿用现有连接、Space 和群范围校验；事件只提示重新核验，不授予执行或修改规则的权限，不为此新建可信事件体系。正文及当前状态以授权规则 API 为准。
4. **一个状态存放位置。** `ImSessionBinding.rulesContext` 保存本会话的失效计数和已提供版本，key/generation 沿用原 binding。父群事件使当前 Bot 已有群及该群话题 binding 的这个字段失效；话题事件只影响对应话题。没有 binding 时不创建状态，首次请求自然携带规则。
5. **选择性注入。** 新会话及 reset 后无有效规则基线；已有会话按权威版本与本地游标比较，变化时提交完整新规则，版本未变时省略自动规则 item。空正文、删除和首次不存在分别有明确状态，不静默保留旧规则，也不将 403/网络失败伪装为未变化。
6. **核验与注入分开。** 没收到广播不代表规则未变。下一次合法请求仍须向权威 API 核验版本；现有接口只提供完整文档时可继续读取文档，再按游标决定是否注入。本计划不承诺消除每轮 HTTP 请求。
7. **明确的更新时机。** 准备时捕获 binding 的 sessionId、generation、失效计数和本轮规则版本；执行以 `run.completed` 结束且 Provider binding 有效时，重新读取该 binding，三项仍匹配才写入已提供版本。准备失败、失败、取消或结果未知都不推进。正常 binding 保存必须保留当前 store 中的 `rulesContext`，不能写回旧调度对象的副本。不把成功执行宣称为模型已读或已遵守。
8. **已有会话生效。** 更新不要求 reset、不更换固定 workdir；原 Provider session 继续使用时，下一个新准备轮次取得新规则。已冻结执行及其重试使用原快照，尚未准备的排队任务使用准备时可见的最新版本。
9. **历史隔离。** 规则事件最多影响规则元数据。不得把普通 history/gap 游标推进到频道最新位置、清除待补讨论或恢复冷历史资格；继续满足 [Issue #32](../channel-context-gap/brief.md) 的既定历史合同。
10. **本地有界状态。** 游标直接计入现有 binding 的 1024 条/4 MiB/24 小时边界，事件更新不续 TTL、不改变淘汰顺序。淘汰或重启后字段丢失，首次请求重新携带规则。没有原子更新能力的自定义 store 每轮携带规则，不能错误省略。
11. **同轮恢复背景。** 每轮 API 取得的完整规则只保留在本轮准备快照。正常续聊可省略规则 Context；同时通过已有 `freshFallbackModelInput`/`freshFallbackModelInputParts` 明确提供完整规则和原 inputs，供 Provider 恢复失败后的首次新会话输入使用。不得等到下一轮才补规则，不另发 invoke，也不让 Host/Adapter 自行读取 GROUP.md。

本修复已将“规则每轮固定注入”调整为每轮核验、按需注入，并同步更新 [Channel 规则](../../rules/channel-integration.md)。Host、Kernel、Core 和 Adapter 不承担业务规则去重、读取或失效。

## 范围与决定权

业务目标、规则注入时机及新建/reset 语义归 IM Channel Gateway。服务端负责已提交更新的事件生成、来源可信度和对群内 Bot 的投递；Gateway 负责事件分流、规则游标和下一轮 Context。显式输入来自真实通知、现有规则 API 和合法用户请求，不从普通正文猜测更新或任务意图。

现有服务端已经发送结构化事件，Runtime 可以直接实现事件分流和游标选择。通知漏收不阻塞本修复，下一次请求的 API 核验保证发现当前版本；真实联验若发现服务端投递问题，再在该仓单独记录和修复，不以完成广播机制重构作为本修复的前置条件。

范围外：通用执行协议升级、Provider 规则文件管理、自动让 Agent 调工具读取规则、隐式 reset、变更目录、关闭 mention 门槛、长期历史库、WeCom 及其他普通 SDK 调用方行为。用户已授权实现、提交、PR 和合并 main；GitHub PR 和 commit message 使用英文，Codex 实现的提交保留归属 trailer。

## 验收

- [ ] 用户端及 Bot API 更新/清空/删除规则：两个以上 Bot（可分属不同 Runtime 实例）都感知变更，广播单独引发的 AgentRun、Provider 调用、执行卡及回复数量均为零。
- [ ] 初次合法请求提供完整规则；同代次同版本续聊省略自动规则正文；版本变化后的下一次合法请求在原 Provider 会话获得完整新规则。
- [ ] `/reset` 和 `/new` 走同一会话控制分支，下一条合法普通请求重新提供规则；重启及 TTL 淘汰后同样如此。版本未变但 Provider 当轮恢复为新会话时，首条恢复输入包含完整规则。
- [ ] 管理员不在任务发送者白名单、未 mention、自身 Bot 写入、重复/乱序通知、无效/伪造事件及普通同名文本均按各自合同处理；更新事件不放宽普通任务准入。
- [ ] 父群更新影响已有群及话题 session；话题自身规则保持独立，其他群/Bot/Space 不受影响。
- [ ] 运行中更新、连续更新、排队、取消、准备/API 失败、旧完成迟到、reset 竞态与冻结重试不丢新标记；只在成功且身份/失效计数匹配时确认版本，普通 binding 保存不覆盖新状态。
- [ ] 漏通知或重连后，下一次合法请求通过权威核验发现变化；空/删除状态撤销旧规则，403/网络错误不当作空或未变化。
- [ ] 规则更新前后，未见聊天仍按 #32 补取且不会因规则刷新重复注入；新增状态遵守数量、字节、TTL 及关闭清理约束。
- [ ] 实现后运行针对性测试、类型/lint 和受影响的全仓检查，在 `https://im-test.deepminer.com.cn/` 记录编辑至真实续聊的端到端证据；自动化和真实 Provider 结果分别记录。

以上为完整验收目标，不将自动化结果等同于线上验收。已执行的检查及未完成项逐项见[交付记录](../../journal/shared/2026-10-20-group-md-refresh-cursor.md)；方案细节见[实施计划](plan.md)。
