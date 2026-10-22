---
type: Journal
title: Issue 40：OpenClaw 版本兼容调研与方案
description: 最新 main 独立 worktree，确认旧创建 Schema 的三个不兼容字段并形成 Adapter 兼容计划。
tags: [openclaw, adapter, invocation, interaction, testing]
timestamp: 2026-10-22T00:00:00Z
---

# 本轮结果

用户要求基于最新代码新建 worktree，先用 OctoSpec 调研 Issue 40。fetch 后从 `origin/main@88fa71db6f32c7898bfcc05d40eb2a44fd91d141` 创建 `research/40-openclaw-compatibility`，路径为 `octo-runtime-issue-40`。应用 worktree 工具因本聊天位于仓库父目录返回 Not a git repository，已使用目标仓库内的原生 `git worktree add` 完成。

已形成[简报](../../tasks/40-openclaw-compatibility/brief.md)、[原因与证据](../../tasks/40-openclaw-compatibility/analysis.md)、[26 标签矩阵](../../tasks/40-openclaw-compatibility/compatibility-matrix.md)、[方案和实施步骤](../../tasks/40-openclaw-compatibility/design.md)，并保存实际读取记录与公开源码摘要。

已确认：当前 Adapter 无条件发送新版 sessions.create 字段；7.x 缺少 permissionMode、idempotencyKey、thinkingLevel，8.1 起已核对的稳定标签有这些字段，协议号始终为 4。方法存在及协议相同不能证明字段兼容；Schema 中遗留字段也不能证明实现语义仍支持。旧版 execSecurity/execAsk 与新版 permissionMode 需要分合同验证。

## 用户后续确认

整体目标为 OpenClaw 2026.7.1 至当前稳定版的完整调用生命周期兼容。用户确认采用基于 probe/握手的判定方向：结合协议号、server.version、实际方法与事件及已验证合同；同为 v4 不代表字段和行为一致。

方案已补充 probe 与 invocation 共用 Adapter 内部合同解析器，每次新连接或重连重新核对实际握手，避免服务端版本变化后继续使用过期 probe 判定。调用方保持统一 Runtime 接口。旧版 reviewer／harness 行为和真实全流程验收继续列为待验证，不以明确拒绝执行代替旧版支持完成。本次仅更新 OctoSpec，未进入产品实现。

## 计划细化与权限口径修正

用户要求给出具体建议，并补充 permissionMode 是业务口径，通常为 fullAccess 和提醒两类，允许语义近似与降级。此前将旧版完整等价新版 guarded 作为前置条件过严，已改为业务意图映射。助手随后提出的“权限只能收紧”方向并非用户要求，已被下节的用户明确纠正取代；当前方案不保留该限制。

已补充[细化实施计划](../../tasks/40-openclaw-compatibility/implementation-plan.md)：精确标签与共享合同、权限首选／备选、调用各阶段失败处理、逐项验收和四步实施安排。复读固定上游源码说明确认 ask 与 auto 可能使用同一 allowlist/on-miss 参数对；复读当前 SDK 审批桥确认 full_access 会自动批准。计划要求回退时同步桥接行为，并通过现有 provider_diagnostic 通知，保留请求身份与 Context hash。当前 OpenClaw 为 canonical-only，本次不新增 native 公共接口。

上述为计划及源码判断，没有新增真实 Gateway／模型调用或产品实现。原始 85 分对应旧方案的可执行性评估，不能用来表示完成度或本次已通过权限联调。

## 用户明确：权限向大回退

用户纠正：“ask 没有，降级为 full，权限往大了降”。当前决定为 ask 可用时保留 ask，目标版本／实例无法支持 ask 时直接使用已验证的 full_access 路径，无需逐次确认；此前“只能收紧”及 full→ask 的建议已撤回。授权限于本任务 OpenClaw 逐调用兼容，采用当前会话的原生 full 参数，不改全局策略。

已同步整体方案、简报、实施计划、矩阵和上下文。验收改为 ask→full 后桥接按 effective=full 执行、通知实际回退、缺少人工审批通道不阻断可用 full 路径，以及 ask 可用时仍保持原模式。此次仍仅修改 OctoSpec，未实现、提交或调用真实 Gateway。

## 验证证据

- 源码：26 个非 beta 标签的固定提交、协议号和创建/主调用字段核对完成；最新正式 Release 为 10.5。
- 本地校验：7.1 原始创建 Schema 的四个合成请求断言通过，分别证明 permissionMode、创建 idempotencyKey、thinkingLevel 的拒绝和公共字段接受。
- 知识检查：仓库 checker 改动前后均仅报告已有的 docs 目录禁用冲突；新增 OKF 元数据、索引及本地链接未新增错误。新产物 Prettier 格式检查与 git diff --check 通过，不能报告全仓 checker 通过。
- 真实接口：本轮未连接 Gateway/IM，未调用模型；用户报告的 9.1 成功和 7.1 失败单独作为用户证据。事故 build、旧版权限实际映射／回退效果及全生命周期实测仍待确认。

本轮只完成规划、文档和离线研究脚本，没有修改产品代码、提交、推送、创建 PR 或改写用户环境。实施目标仍为旧版实际可用；ask 不可用时优先按已授权 full 路径执行，所有已知执行路径均不可用时才报告失败，失败不替代支持目标的验收。
