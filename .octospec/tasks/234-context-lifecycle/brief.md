---
type: Task
title: Issue 234 Gateway 稳定 Context 生命周期
description: 按会话首轮及可配置周期刷新稳定说明，分离本轮触发事实并完成本地全局安装。
tags: [channel, context, session]
timestamp: 2026-10-29T00:00:00+08:00
---

# 目标与授权

Issue：https://github.com/Mininglamp-OSS/octo-runtime/issues/234。以评论中的最新决定为准：群聊为主，接受定期提醒的保留边界，不增加压缩事件监听。

用户授权独立 worktree、Octospec 规划、可执行性超过 95 分后实施、本地编译构建和全局安装，随后通知人工验收。2026-10-29 后续明确授权提交 PR，包含本任务提交和推送；不包含合并、发行或扩大 GitHub CI。

基线：origin/main@96a6f58cf1ec8cfb0f33e88b522bea6b6a95e822。
worktree：/Users/lvsijia/github.com/Mininglamp-OSS/octo-runtime-issue-234。
分支：fix/234-context-lifecycle。

## 后续规划：接续历史保守选择

用户确认首轮保留窗口内包括自身 Bot 在内的历史；仅正常接续同一 Provider 会话时，才排除有明确证据证明已由该会话 assistant 内容覆盖的自身输出。补位、reset/new、fresh fallback、归属或连续性不明时保留，不按 UID、正文或 URL 全面去重。产品改动仅在 channel-gateway，不能修改 Core、Kernel、协议、Adapter 或其他 Extra 来实现。详见 [保守历史设计](conservative-history-plan.md)。已按最新授权完成实现、审查、build 和全局安装，本项独立准备度 96/100，原功能 97/100 不作为本项评分；2026-10-29 用户已明确确认真实群聊验收通过，详细边界见 validation.md。

## 架构合同与接入文档

当前合同回写 [架构规则](../../rules/architecture.md#channel-context-生命周期与历史预算)、[Channel 规则](../../rules/channel-integration.md)、[Context 输入](../../rules/context-input.md)、[会话重置](../../rules/session-reset.md)和[无状态执行](../../rules/stateless-execution.md)。统一最近20条、完整序列化messages数组8000 Unicode码点（含身份、时间、结构与转义）、同次主历史与恢复补充共用总预算，以及首轮保留/正常接续有限省略的保守边界。默认30轮规则刷新、动态message-trigger和产物后处理责任同步保留。

对外说明同步到[中文架构](../../../docs/zh-CN/concepts/architecture.md)、[中文会话指南](../../../docs/zh-CN/guides/context-and-sessions.md)及对应英文页；规则正文以 `.octospec/rules/` 为准，公开文档说明接入行为并链接权威合同。

## 后续 P2 范围

远端 OpenClaw 的文件引用转换因场景少暂缓实施，单独跟踪为 [Issue #243](https://github.com/Mininglamp-OSS/octo-runtime/issues/243)，不影响本地交付修复验收。本轮只写入架构约束及两个 Adapter TODO，细节见 [P2 待办](remote-artifact-backlog.md)；本轮不增加远端转换、配置或运行时判断。

## 产品意图与责任

- 成功 final 的本地 Markdown 路径按 Gateway 实际文件系统尝试读取，OpenClaw preset 来源不代表远程，不预先拒绝，不默认限制到工作区；不需要新增或修改用户配置。原 allowed_roots 若显式配置仍作为限制，空列表拒绝全部；不改变 Agent 工作区，保留 realpath、常规文件、类型、大小和去重/文件卡合同。文件不存在按实际读取失败报告，不主动下载远端产物。

- 自动历史每条消息包含 sentAt，按原消息时刻及系统实际时区输出带显式偏移的 ISO 8601（如本机 `2026-10-29T13:36:53.000+08:00`），不硬编码时区，message-trigger 同步；未知为 null，不补当前时间。引用、转发及正文截断同样保留各自时间，时间计入既有 JSON 总预算。

- history-instructions 只约定三个意图目标：结合前文理解当前意图、遵循最新相关修正、不自动重启历史旧任务；不规定具体操作或加载/工具流程。模型侧删除自动 history-gap，历史不完整时在 `extra.im/history.payload.note` 附一句简短说明；正常历史不加 note。

- 默认 artifact-delivery 的 guidance 只要求本地交付物在 final 使用绝对路径 Markdown 链接，图片使用 !；不指挥上传/发送工具，不干扰用户明确要求的 octo-cli 操作。确定性上传与安全策略仍由后处理执行。

- message-trigger 的频道信息使用 `conversation: {id, type}`：id 为原始频道 ID，type 固定为 `dm`、`group`、`group_topic`；群与子区名称及各自 ID 仍分别保留在 group/topic 字段。

- Gateway 决定自动稳定 Context 的发送时机和本轮 actor/trigger 数据；这是 Octo IM 业务策略，不推广到 Core、Kernel、WeCom、WebUI 或 Provider Adapter。
- Bot 配置 `stable_context_refresh_interval_turns` 默认 30，只接受正安全整数。每会话第 1、N、2N…轮刷新，reset/new 后重新计数。
- 只统计真正开始执行的用户任务；控制命令、准备失败、工具步骤、自动重试及同代次卡片重试不增加轮数。首次或周期刷新未成功确认时保留待补状态，不能把准备或创建 Provider 会话当作模型已收到规则。
- 稳定 mention、产物交付、历史阅读规则与动态发起者/频道/mention 分离。周期规则通过普通模型 Context 到达续聊，不依赖仅首轮使用的系统指令字段。
- extra.im 整个命名空间由 channel-gateway/channel-wecom 拥有，宿主静态/动态来源的全部 extra.im 项忽略，即使本轮没有渠道同名项也不透传；规则的外部更新由渠道内部按业务合同读取，不新增配置中心接口。其他合法宿主 Context 保序转发，不按文本/hash 去重；全局 octo.control/instructions 保留既有特殊合并。冻结重试保留渠道已生成的快照，不增加宿主生命周期 API。
- 群规则继续每轮查权威版本、变更后注入；周期轮也重带当前群规则。无规则游标能力的宿主 store 保持每轮携带的明确行为。
- 当前引用、资源、富文本、历史增量按原条件加载；重试复用冻结材料和投递策略；fresh fallback 显式带齐本轮稳定规则和省略的群规则。
- 触发身份名称与类型使用 Bot 独立、有容量上限的内存缓存，固定 TTL 10 分钟，不落盘；过期才查，失败或缺失不缓存，不增加本轮重试。当前消息 UID/时间和群规则权威版本不受该缓存影响。
- 聊天历史按从旧到新的 JSON 消息列表提供 `{uid, username, content}`，所有正文统一为带 type 的 content 对象，文本为 `{type:"text",text:"..."}`。引用、转发、富文本、图片、文件、文档保持类型和嵌套关系，姓名来自同 Bot 身份 API/缓存，未知为 null；不自动下载/解引用，资源标 read=false。仍限 20 条和消息数组序列化后 8000 Unicode 码点；纯文本缩短正文而保留身份，特殊内容放不下则保留显式 omitted 占位。不抓更多历史。
- 缺口的范围、游标、source、automatic 等内部元数据留在 Gateway；模型只收到 history 的 messages 与必要的英文 note。读取失败或预算省略正文时允许 messages 为空并附说明；宿主 extra.im 项不替代渠道历史，其他宿主项保持原值。状态仍依据实际交给执行的材料推进，说明本身不构成正文交接证据，不能因精简模型输入而丢失失败补读、预算降级或冻结重试语义。

## 验收

1. 默认 1/30/60、自定义周期、两个会话独立、reset/new、排队和代次竞态。
2. 准备/展示/提交前失败、同轮自动及卡片重试、store 保存与重建，不提前消耗说明或重复计轮。
3. message-trigger 保留 JSON，guidance 一句简短英文；包含群/子区名称和 ID、发起者姓名/UID/类型、接收 Bot 名称/ID、原消息时刻的系统时区时间及显式偏移、实际 @ 目标。身份通过同 Bot 权限下的接口查询，缺失为 null/unknown，不从正文或 UID 后缀猜测；稳定说明分行，本轮历史状态无大段固定规则。
4. 三种 Adapter 的普通续聊输入验证：Codex turn/start、Claude Code stdin、OpenClaw agent.message 均保留周期 Context 和真实换行。
5. 构建、类型、lint、相关回归；原有测试集合可运行，不新增 CI 范围。使用正式打包脚本产生 tgz，安装到当前全局 npm 环境并核验入口和构建来源。
6. 保留用户原有配置及会话，不擅自 reset，不启动真实群聊任务；真实 IM 行为由用户验收。
7. 验证 10 分钟缓存命中/过期、失败不缓存、Bot/Space 隔离、容量淘汰；历史多发言者、同人连续消息、换行/Unicode 截断、姓名失败；模型侧无自动 history-gap，异常说明合并至 history 后游标提交、失败补读及预算省略回归不变。

实施设计见 design.md，可执行性见 assessment.md，最终事实和限制写入 validation.md。
