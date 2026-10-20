---
type: Task
title: GROUP.md 通知分流与单处会话状态实施计划
description: 从误执行和规则重复注入的直接原因出发，在现有 binding 中保存规则状态并固定成功更新边界。
tags: [channel, session, reset, context, testing]
timestamp: 2026-10-20T00:00:00Z
---

# 实施计划

状态：**本地实现及自动化验证通过。** 用户已授权实现、提交、PR 和合并 main；实际结果及未验证项见[交付记录](../../journal/shared/2026-10-20-group-md-refresh-cursor.md)。目标、源码事实和验收以[简报](brief.md)为准。

## M0：固定事实与责任

已完成：读取 #54/#55、最新 Runtime main，以及本地 `octo-server` 用户/Bot 编辑、删除和通知代码。确认文本载体、结构化事件、全部 Bot 点名、Gateway 缺少事件分流、每轮规则注入及缺少规则游标。

来源索引：

- [服务端用户规则更新与通知](https://github.com/Mininglamp-OSS/octo-server/blob/5cf83f5725a6ce71f4944a9ce1a17038268375cf/modules/group/api.go#L4368)。
- [服务端 Bot 规则更新与通知](https://github.com/Mininglamp-OSS/octo-server/blob/5cf83f5725a6ce71f4944a9ce1a17038268375cf/modules/bot_api/groups.go#L211)。
- [服务端规则版本递增](https://github.com/Mininglamp-OSS/octo-server/blob/5cf83f5725a6ce71f4944a9ce1a17038268375cf/modules/group/db.go#L932)。

## 方案：一个 binding 字段决定是否携带规则

需要保存的事实是“当前会话是否已经成功携带过这个版本的规则”。字段属于现有 `ImSessionBinding`，不放入聊天 gap，不另建全局群游标表。

已实现的数据形状：

```ts
rulesContext?: {
  revision: number;
  supplied?: {
    providerSessionId: string;
    group: { version: number | null; status: "present" | "empty" | "not_found" };
    topic?: { version: number | null; status: "present" | "empty" | "not_found" };
  };
};
```

`supplied` 不存在等价于“需要携带”。已有 `supplied` 时，再比较本次 API 返回的 group/topic 版本及状态、Provider sessionId；任一不同都要携带。群和话题规则作为一组确认，任一变化时都携带本轮完整的一组，避免再增加两套刷新流程。`revision` 仅防止旧执行清除新通知，并非另一份服务端版本。

| 触发 | 同一个字段如何变化 | 是否发起执行 |
| --- | --- | --- |
| 首次会话、重启或 binding 淘汰 | 字段不存在，下一条合法请求携带规则 | 仅由该合法请求触发 |
| `/reset` 或 `/new` | 同一 reset 分支清除字段并增加现有 generation | 命令本身不执行模型 |
| 结构化规则更新/删除通知 | 当前 Bot 已有的相关 binding：revision 加一、清除 supplied；无 binding 则不创建 | 不执行、不排队、不回复 |
| 普通请求 | 捕获 revision，读取现有 API，根据上述条件决定是否加入规则 Context | 按原准入规则执行 |
| `run.completed` 且有可续接的 Provider binding | sessionId、generation、revision 均未变时，确认本轮完整规则的版本及 Provider sessionId | 不额外执行 |
| 准备失败、run.failed、取消、结果未知 | 不推进 supplied；若本轮省略规则后执行失败，也清除旧 supplied，使下次重带 | 不新增重跑 |

对失败路径的清除同样检查 sessionId/generation，保留当前 revision。父群通知对已有群/话题 binding 做一次有界失效更新；话题通知只更新原话题。更新不续 TTL、不调整淘汰顺序；最多扫描现有 1024 条 binding，无独立 Map 或文件。默认 store 增加可选的规则失效/条件 patch 方法，计入原 4 MiB/24 小时约束；自定义 store 缺少能力时每轮携带完整规则。

通知版本不作为规则真值，也不作为执行授权，重复或乱序通知最多造成一次额外规则重带。保留每轮现有 GET 核验后，不需要依赖广播恰好送达；漏通知、自身消息过滤、尚无会话的 Bot，都由下一条请求的版本比较覆盖。现有 WS 身份和作用域校验继续使用，不增加事件认证协议。

## 成功更新与新 Provider 会话

成功更新点固定在 `im-channel.ts` 当前任务的成功终态处理处，使用 store 中刚读取的 binding 做条件 patch。`#saveBinding` 每次保存都保留当前 store 的 `rulesContext`，不能从旧调度 session 还原它。例：本轮读取 N 后，事件将 revision 从 1 改为 2；本轮 N 执行成功仍不能以 revision=1 写入 supplied，因此下轮必带新规则。

Provider 同轮恢复失败的背景通过现有恢复输入合同解决：Channel 已从 API 得到本轮完整规则，在正常 Context 省略规则时，将规则 guidance/payload 与**同一轮原 inputs**构造成 `freshFallbackModelInput`/`freshFallbackModelInputParts`。正常续聊不使用这份备用输入；Adapter 已有的恢复路径只在 fresh fallback 时使用它。普通 Context 已带规则时不在备用输入重复添加，Core 现有 `withModelContexts` 会渲染本轮 Context 到恢复输入。图片等原 inputs 必须完整保留，不能只设置备用文本而遗漏 parts。

本轮规则只活到现有任务/重试快照结束，不存入 binding 正文。fresh fallback 后成功执行，supplied 绑定实际返回的新 Provider sessionId；恢复输入未生效、没有可续接 binding 或失败时不确认该游标。冻结重试继续使用原普通/恢复快照，不重新读取规则、不另起补背景任务。

源码依据：`execution/task.ts` 已有成功/失败终态；`im-channel.ts` 已消费 `session.update` 并保存 Provider binding；公开 InvokeInput 已包含两种 `freshFallbackModelInput` 字段，Core 及 Codex/ACP 已有对应恢复输入路径。本修复只由 Channel 显式提供材料，不增加协议字段，不让 Host 或 Adapter 判断业务规则。

## M2：Runtime 实现与规则文档对齐

| 模块 | 计划改动 |
| --- | --- |
| `src/transport/normalize.ts` | 按当前频道及结构化 event 分类规则通知，普通任务保持真实 mention 和发送者授权 |
| `src/transport/channel.ts`、`src/contracts.ts` | 增加规则失效回调，先分流再普通准入；将准备版本与交接结果传回应用层 |
| `src/application/session-store.ts` | 仅新增 rulesContext 字段及已有 binding 的失效/条件 patch；不复用聊天水位 |
| `src/application/im-channel.ts` | 在准备前读取状态、成功后条件确认、失败后置为需重带，保存时保留最新字段；/new 复用 /reset |
| `src/transport/contexts.ts`、`src/execution/dispatcher.ts` | 继续读现有规则 API，比较版本选择普通 Context，完整规则组织进本轮备用恢复输入 |
| `.octospec/rules/channel-integration.md` 及相关规则/指南 | 实现后将每轮固定注入更新为版本感知，说明核验频率和快照边界；不改变通用 Context renderer 合同 |

源码路径均相对于 `packages/octo-runtime-extra-channel-gateway/`。不预先新建抽象层；状态复杂度确有需要时再拆内部 helper。

准备流程目标：

1. 规则事件在普通准入前分流，只使已有 binding 失效并返回；普通消息继续原准入与队列。
2. 普通任务开始准备时读取 rulesContext，取得本轮 API 完整规则，计算是否携带。
3. 构造普通 Context 和备用恢复输入，冻结本轮版本与 sessionId/generation/revision；403/网络失败沿既有准备失败处理。
4. 按原链路执行；成功且三项仍匹配时确认 supplied，失败则保留或恢复需重带状态，不覆盖后来的失效。

不把广播当作唯一变化来源。当前没有只读 revision 的独立接口，默认继续用现有 GET 核验；若另行提出 ETag/元数据接口，须有实际服务端合同和单独依据，不在此假设已支持。

## M3：有针对性的自动化回归

使用 fake Host/Provider 计数实际调用。除单元分类外，必须覆盖真实 Gateway transport 回调到调度入口，避免只证明 helper 正确。

- 通知包含正常文本类型、全部 Bot mention、合法/白名单外编辑者、无 mention、自身 Bot 更新、同文案普通消息，以及缺失/无效/伪造事件。
- 初始 N、未变化 N、通知 N+1、无通知但 API N+1、连续 N+1/N+2、重复及乱序事件、空/删除/重建。
- 群和两个话题、两个发送者、两个 Bot、不同 Space/连接身份：共享父群失效，隔离会话交接进度。
- 执行中及排队时更新、旧快照重试、API 失败、预算/准备失败、停止、reset 和旧结果迟到；旧轮不能把 N+2 覆盖为 N 或 N+1。
- /new 与 /reset 同分支、新会话、重启、binding TTL/容量淘汰时重新携带；版本未变但 Provider 同轮 fresh fallback 时，第一条恢复输入已经含规则及原 inputs；不会将通知占用工作或排队名额。
- #32 历史游标、未见讨论、冷历史资格及同代次重试保持原行为；有界元数据字节、TTL 和关闭清理有覆盖。

实施后先运行新增专项及相邻测试，再运行 `pnpm typecheck`、`pnpm lint`、`pnpm lint:names` 和受影响全仓测试。相邻入口包括 `test/im-runtime.test.js`、`test/im-session-store.test.js`、`test/im-new-session-history.test.js`、`test/im-context-gap*.test.js` 与 transport 的现有测试。不把本计划中的检查命令列为已通过。

## M4：真实链路验收与交接

仅连接 `https://im-test.deepminer.com.cn/`，使用已有合法测试身份和隔离群/话题。实施时先列出实际 Bot、Runtime/Provider 版本及可用群；至少两个 Bot，其中包含不同 Runtime 实例。先用确定性执行器统计调用和最终输入，再以已有可用的 Codex/ACP Provider 验证续聊与恢复；凭据不足只影响真实验收，不阻塞本地修复和自动化。

先在确定性执行器下核对广播导致零 invoke/排队/执行卡/回复，再用实际 Provider 验证：旧会话完成 N 后编辑为 N+1，下一条合法请求在同一 Provider session 获得 N+1，之后未变化时不重复注入。补测父群与话题、断线漏通知、运行中更新、清空/删除以及 /reset、/new；同轮 fresh fallback 要检查第一条恢复输入，不能以之后一轮补带代替。

记录服务端和 Runtime 的实际 commit、事件作用域/版本、会话代次、准备及交接版本和调用计数；不保存凭据或规则正文。测试中“模型回答正确”与“实际输入含正确规则”分别取证，不能互相替代。

当前合同已回写规则，结果写入 journal。按用户授权提交、推送、创建英文 PR 并合并 main，PR 关联两个 issue。#55 的线上多 Bot/真实 Provider 验收尚未完成，保留跟踪。

## 可执行性复评

补充后评为 **96/100**，是方案成熟度判断，不代表实现或验收完成。相比首次 84 分，已固定单处存储、成功更新点、失败处理、旧结果保护、/new 语义和同轮恢复载体。剩余 4 分在于：备用恢复输入与现有预算/图片组合尚须专项测试（2 分）；实际测试身份、部署和 Provider 联验尚须落实（2 分）。这两项随实现验证，不再作为开始编码前的额外方案阶段。
