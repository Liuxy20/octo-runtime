---
type: Journal
title: PR 229 名称兼容与续聊复审修正
description: 放宽公共展示名称、限定 Gateway 展示片段，并过滤 OpenClaw 已知旧无 runId 审批。
tags: [session, review, openclaw, testing]
---

# 本轮决定

用户最终确认 `sessionName` 只限制非空白、长度及控制字符，允许 `:`、`-`、`_`、中文等。公共合同为 1–256 Unicode 码点且无 C0/DEL/C1 控制字符；合法名称原样透传。替代前日临时 ASCII 合同，名称仍归调用方，Host SDK 不增加业务命名器。

Gateway opaque 地址不能直接作为无界展示片段。各展示片段限制 80 码点、控制字符替换为 `-`，保留随机后缀；旧非法名称可补正，业务地址、session、generation 及原生恢复句柄不变。OpenClaw 完整复审另发现旧无 runId 审批串入新轮次，现过滤派发前旧审批及其重播；当前合法实时审批保留，原生缺关联字段的剩余歧义如实记录。

# 证据与范围

渠道两项与审批一项新增回归均先在旧实现失败后修复。完整本地 Node 2284 通过、91 跳过，WebUI 35 通过；Go/Python 原生套件 45 通过，各含 434 协议输入。类型、格式、lint、文档与生成检查通过。独立双轴复审各一项 P1 均关闭，详见[审查](../../tasks/224-session-names/review.md)。

OpenClaw、Codex、Claude Code 另用包含冒号/下划线/中文的名称完成真实三轮同句柄与记忆验证、同名 fresh 隔离。真实 IM、通用 ACP 及本轮真实人工审批未验；不扩大 GitHub CI 范围。旧 Ubuntu Node 26 构建超时与名称失败没有日志证据上的关联。命令、版本及边界见[验证](../../tasks/224-session-names/validation.md)。

# 延迟首次出现审批的后续修复

用户后续要求同步 main 处理冲突，并询问两位 reviewer 的同一 P1 如何修复。已保留远端 `45041cf`，合入 main `1dd5a09` 为 `fa42979`，保留双方日志和 Gateway 名称/准备错误逻辑。此前仅记下“未知旧审批派发后首次出现”的歧义，仍留下授权风险，需要修正。

当前续聊遇到派发后首次出现的无 runId 审批，直接失败并请求取消当前 Run，不进入交互桥、不调用 approval.resolve、不提升权限或更换 session；ask/full_access 一致。旧已知审批仍忽略，fresh 独立 session 的无 runId 审批及匹配 runId 的续聊审批仍支持。代价是原生不提供 runId 时，合法当前审批也明确失败；不能用客户端时间阈值保证归属。

三项新红例先复现错误交互，再修复。审批 12/12、渠道相关手动回归 193/193、全量 Node 2290 通过/91 跳过，WebUI 35 通过，双轴独立复核通过。构建类型、lint、格式、docs、native 生成检查通过。知识库 lint 遇到 main 既有 Issue 137 三份文档缺 frontmatter，未改无关任务，未宣称通过。真实人工审批未重验，取消只确认发出请求。详细证据见上述验证记录；CI 范围不变。
