---
type: Task
title: Issue 110 相邻准入与控制入口检查
description: 区分同源 owner 默认缺陷、共享群控制语义和平台 DM 权限边界。
tags: [channel, authorization, testing]
timestamp: 2026-10-22T00:00:00+08:00
---

# 相邻入口检查

## 同源缺陷：卡片回调

旧 `transport/channel.ts` 的 `#pollActions` 与消息准入一样使用 `allowed_sender_ids ?? [owner]`。仅修消息入口会使非 owner 发起任务后无法点击自己的停止、重试或交互按钮。本次已同步移除 owner 默认，保留显式名单和原任务发起者、Space、原消息及地址匹配。加密 WS 集成回归将注册 owner 改为独立身份并省略名单，验证非 owner 执行、停止/重试卡片及拒绝伪造操作者。

`application/im-channel.ts` 的第二层消息准入本来就把省略视为无额外限制；本次使传输层与其一致。WeCom 也没有 owner 默认，本次不改。

## 现存语义差异：群命令控制被点名 Bot 的当前群会话

`application/im-channel.ts` 的会话 key 按 connector、Bot、Adapter、频道类型和频道 ID 生成，不包含发送者。每个 Bot 拥有独立的 ImRuntime、任务表及会话状态；群/话题命令仍须先满足针对当前 Bot 的真实 mention 准入。只点名 Bot B 时，`/stop`、`/cancel` 仅请求停止 B 在当前群/话题的执行，`/reset`、`/new` 仅重置 B 在该地址的会话，不影响同群其他 Bot，也不重置 B 在其他频道的会话。reset 不等于停止正在执行的 Run。显式点名多个 Bot 或使用有效的纯 AI 广播时，各被触发 Bot 才分别处理自己的命令。

上述命令没有原任务发起者检查。因此，同群另一位已准入成员（包括 Bot）可以通过真实 mention 控制被点名 Bot 的当前群会话；“共享”指该 Bot 在同一频道内由多位发送者共用会话，不是多个 Bot 共用一个任务或会话。

本机 fake Provider 探针模拟同群 user-A 发起长任务、user-B 发送 `/stop`，确认调用一次原 invocation 的取消。该探针注入传输回调，只证明应用层命令语义。后续新增 `test/im-group-bot-isolation.test.js`，使用真实 GatewayTransport → ImRuntime 路径，仅替换 WS/HTTP 网络边界和 Provider；四项覆盖非 owner 用户/Bot、群/子区，以及五 Bot 独立在途时只点名 B 的 reset、stop 和后续新会话。真实 IM 部署仍未验收。

此行为与卡片仅原发起者可操作、审批/问答仅原发起者可回答的边界不同。它不属于默认名单过度收窄问题，也不能在没有明确产品决策时直接认定为缺陷或自行增加限制。本次保留现状，交由用户决定是否采用共享群控制语义。

## 平台 DM 边界不能等同于严格仅好友

只读检查本地 octo-server 源码：`modules/robot/event.go` 的 Bot 事件路由存在 owner 例外及 `IsFriend` 检查；`modules/user/1module.go` 的 IM DM 白名单数据源则合并好友与 `space.GetCoMemberUIDs`，后者在 `modules/space/db.go` 查询共同有效空间成员。

Gateway 使用 WS 收消息；Bot 事件路由中的好友检查本身不能证明 WS 在所有路径都严格只投递好友。平台源码已存在独立权限策略，故不能把“沿用平台好友准入”宣称为本次实现了严格仅好友保证。若产品要统一为严格好友，需要在平台实际消息准入边界处理，不在 Gateway 再维护一套好友缓存。本次没有修改 octo-server，也没有实际发送非好友 DM 验证部署。

## 其他入口

- Space、群启停、父群范围、真实 mention、自消息与消息结构检查继续保留，属于已明确合同。
- 规则和历史读取使用当前 Bot 凭据，没有 owner-only 发送者名单；规则 403/网络错误保留真实失败，不冒充无规则继续。
- `/approve`、`/decline`、`/respond` 及卡片控制保留原交互/任务归属，不能通过表单伪造操作者。
- `mention_pref` API helper 尚无运行路径调用；现行入口不因该 helper 放开真实 mention 门槛。
- 现有运行日志没有逐消息拒绝原因，故本次只能确认源码及回归根因，不能复原截图消息的完整投递证据。
