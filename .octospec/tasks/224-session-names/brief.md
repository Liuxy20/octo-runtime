---
type: Task
title: Issue 224：调用方会话命名与 OpenClaw 原生续接
description: 统一可选名称载体与随机默认值，保持业务命名归调用方，修复逐 Run 新建 OpenClaw 会话。
tags: [session, reset, protocol, adapter, openclaw, channel, testing]
---

# 目标与产品意图归属

来源：https://github.com/Mininglamp-OSS/octo-runtime/issues/224 。用户授权独立 worktree、OctoSpec、可执行性超过 95 后实施、代码审查、提交与 PR；不授权合并。基线为最新 origin/main `0ca12a03a055ccb766e6126716c51bb6cc6efe1c`，分支 `feat/224-session-names`。

业务目标是在 Provider 中看懂聊天来源，并让未 reset 的连续消息使用同一原生会话。命名和业务生命周期由调用方决定；公共输入只承载、校验和生成无业务语义的 UUID 默认值。Host SDK/Kernel 只转发，不生成名称、不建业务 registry。Provider Adapter 负责原生请求、恢复、权限、事件关联、取消和真实结果。

## 关键合同与设计

- 新增可选 `sessionName`，与业务 sessionId、Run ID、Provider opaque sessionId 分开。按用户 2026-10-29 最新确认，长度 1–256 个 Unicode 码点，不能全为空白，不含 C0/DEL/C1 控制字符，允许 `:`、`-`、`_`、中文等；原样透传，不按分隔符解析身份。Run 7 / Context v3 / Adapter 2 不变。
- Core 的 `prepareInvokeInput` 唯一补 UUID；公开 InvokeInput 与内部 wire 同步。名称不进入模型正文、系统指令或普通日志。缺省或不同名称均不能改变既有 providerSession 的恢复选择。
- Gateway 在业务 session 首次分配时确定并保存名称；私聊 `octo-dm-{uid}-{uuid}`，群 `octo-group-{groupId}-{uuid}`，话题 `octo-group-{groupId}-topic-{topicId}-{uuid}`。展示地址片段各最多 80 个码点、替换控制字符，避免 opaque 地址使名称超限；不改业务地址及 scoped binding。同代次队列、重试、闲置调度回收保持名称；reset/new 延迟换新，旧 session 缺失或非法名称由调用方补正，不能换业务 session、代次或 Provider binding。其他调用方保留自定义输入，不引入 WeCom/WebUI 业务代码。
- OpenClaw fresh 构造可读 key，附独立随机后缀避免相同显示名称合并。续聊仅使用返回的原生 key，检查目标 Agent 与 key 归属。先只读 sessions.describe 验证存在，再按版本 patch 本轮权限并确认，订阅已有 key，然后发唯一 agent 请求。不复用 runId/idempotencyKey；保留事件、审批及取消对账过滤。
- 缺失会话或未知 RPC 故障明确失败，不新建/重发，不实现自动 fresh fallback。旧 `resumable:false` 的真实 key 仍可显式请求恢复；新回执诚实发布 resumed/new 和 resumable:true。系统指令仅在实际 fresh 时发送。
- 共享 OpenClaw session 不共享逐轮审批：派发前发现的旧无 runId 审批不路由到本轮，其 ID 有界保留以过滤重播。续聊派发后首次出现的无 runId 审批缺少可验证关联，明确失败并请求取消本轮、不发布交互或回答审批，ask/full_access 一致，不根据本地时间猜归属、不升级权限或重建 session。新建隔离 session 仍支持无 runId 审批；续聊须由 Provider 提供匹配本轮的 runId，缺失时即使是合法当前审批也明确失败。
- Codex 在新 thread 创建后、首个 turn 前使用 thread/name/set；成功 resume 不重命名；恢复失败后新 thread 同样命名。CC 只在创建时传 --name，不改变 --resume。通用 ACP 缺少标准 setter，保留 session/load/new，名称未应用通过现有 provider_diagnostic notice 与能力记录说明，不伪造原生标题成功；不添加 Runtime capabilities registry。
- 不扩充持久化、历史窗口、聊天正文、工作目录或授权语义；显示名称不替代当前 scoped binding，不成为恢复凭据。

## 原生依据与剩余验证

本机 Codex 0.164.0 `app-server generate-json-schema` 输出 ThreadSetNameParams（threadId/name）；CC 2.1.306 --help 明确 --name 为显示名称。OpenClaw 已有固定 27 版本源码依据；本轮补核固定 8.1 commit `ea806575e6450e4d1efdfc72c19f04be982a1b9b` 的 sessions-resolve、sessions-patch、sessions-read 与 mutations，以及 6.11 commit `e085fa1a3ffd32d0ea6917e1e6fb4ecbffbb77d2` 的 legacy sessions schema。resolve allowMissing 返回 ok:false；现代 patch 使用 permissionMode，旧版使用 execSecurity/execAsk。请求投影与测试需同步补充续接使用的字段，不将替身当作原生验收。

真实测试使用已有本机 OpenClaw 9.4、Codex、CC 和 im-test 专用测试条件，不改变现有用户会话；缺环境记录 BLOCKED/NOT RUN。不能仅因收到 session.update 就宣称模型跨轮记忆已验证。

## 范围外

不改 Host SDK 的命名策略；不加数据库/历史归档；不保证丢失 binding 后自动恢复；不实现未来渠道；不自动重命名已有 Provider 会话；不增加 CI workflow/job/matrix/trigger/gate 或默认 live 开关；不自动合并 PR。

## 验收

协议正反例与跨 worker 透传；任意调用方名称和随机缺省；Gateway DM/群/话题稳定命名、reset/new、不同用户/Bot/话题隔离；OpenClaw 3 轮 1 session、原生无历史补充的记忆验证、缺失 session 明确失败、权限/事件/取消/未知接纳回归；Codex/CC resume 与新会话命名、ACP 未应用名称的真实反馈。运行构建、类型、lint、格式、全仓离线测试及显式 non-gating 真实专项。提交前核对相对 origin/main workflow diff 为空及实际 CI 检查列表。
