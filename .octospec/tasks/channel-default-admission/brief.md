---
type: Task
title: Issue 110 Gateway 默认发送者准入
description: 省略发送者名单时沿用平台权限，保留显式名单与原任务卡片归属。
tags: [channel, mention, authorization]
timestamp: 2026-10-22T00:00:00+08:00
---

# Issue 110：Gateway 默认发送者准入

问题追踪：[P1 Bug #110](https://github.com/Mininglamp-OSS/octo-runtime/issues/110)。

按核心群 mention 修复范围，[方案可执行性为 100/100](assessment.md)；评分不代表已部署或远端验收完成。独立 worktree 与分支已建立，具体剩余交付和证据边界见该评估。

本地已实施并通过构建、类型、lint、文档、定向 81 项、全量 Node 1630 项（35 跳过）与 UI 35 项。五 Bot 群/子区触发及 stop/reset 隔离四项回归通过。用户已授权提交 PR 并在门禁满足后合并 main，未部署运行中服务，见[验证记录](../../journal/shared/2026-10-22-channel-default-admission.md)；用户要求的类似问题检查见[相邻入口审计](audit.md)。

## PR 112 Windows CI 修复

用户反馈 Windows Node 24 的身份登记测试再次失败。原日志在约 10.56 秒报告 `cannot identify worker process`，与 PowerShell 的 10 秒期限吻合，但底层 cause 已丢失，不能据此确认系统层的具体耗时原因。Node 26 同轮通过。前次取消模块加载优化仍未消除完整 PowerShell 冷启动成本。

此问题属于 Kernel 资源所有权实现与 CI 交付，不改变 Channel 产品准入：Windows 身份查询期限调整为 30 秒并保留登记错误 cause；身份格式、不缓存 PID、未知身份拒绝及关闭预算保持原合同。同步调整 Windows 回滚测试登记等待与总期限，保留真实查询、三轮串行运行、回滚及替代实例断言。新增跨平台可运行的 Windows 查询边界回归，覆盖 PID 不缓存、非法响应及失败不登记并保留 cause。

## 目标与责任

核心事故是群聊里非 owner 的用户或其他 Bot 即使携带真实 mention，也无法触发接收 Bot 的 AgentRun。DM 与卡片回调属于同源默认值检查的补充，不替代此主要验收目标。

用户于 2026-10-22 明确：`allowed_sender_ids` 省略时，DM 沿用平台好友准入；群聊和子区不增加发送者限制，owner、其他用户和 Bot 均可通过真实 mention 触发 AgentRun。此前省略时仅允许 owner 的默认值不再适用。

平台负责好友关系和消息投递权限，Channel 负责配置解释、真实消息准入、任务归属及投递；Kernel、Adapter、Context 和宿主不补充发送者策略。本次不增加好友查询 API 或重复权限中心，不改变 Provider 执行权限。CLI 与 SDK 共用 Gateway 实现，其他 Extra 不变。

## 明确合同

- `allowed_sender_ids` 省略：Gateway 不额外限制发送者；DM 沿用平台好友准入，群/话题接受任何真实发送者的有效 mention。
- 显式非空名单：仅允许名单内发送者；`[]` 拒绝所有发送者；`null` 仍非法。owner 不隐式补入。
- 自消息始终拒绝；Space、消息结构、群启停、父群范围及真实 mention 仍须通过。
- 卡片回调采用相同的可选名单默认值，且必须匹配原任务发起者、Space、原卡片消息和频道地址，不能控制其他人的 Run。
- 不扫描入站正文补造 mention，不重复发送 REST 消息，不引入跨 Bot 循环治理。

## 范围与验收

从最新 `origin/main@5c1921d` 新建独立 worktree，修改 Gateway 入站和卡片入口，更新架构、Channel 规则、Schema 及接入文档。保留历史任务记录，但现行合同明确取代 owner 默认。

自动化覆盖 DM/群/话题的 owner、其他用户、其他 Bot、自身与空发送者，显式名单及空名单，群范围/Space/mention 边界，以及非 owner 的真实加密 WS 执行和卡片控制。运行构建、类型、lint、文档检查、相关及全量回归。测试使用 fake Provider；不发送真实聊天消息，不验证模型 compaction。

## 已有证据

本机四个 Bot 配置均省略 `allowed_sender_ids`；旧入口会将其收窄为 owner。现有日志不含逐消息拒绝原因，不能据此确认截图消息的具体拒绝链。服务端源码含 DM 好友校验，部署中好友校验的端到端生效属于平台合同，本次不宣称完成真实好友准入验收。
