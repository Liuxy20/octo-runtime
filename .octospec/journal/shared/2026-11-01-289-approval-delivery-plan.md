---
type: Journal
title: Issue 289 独立 worktree 与审批投递计划
description: 记录最新主线基线、OctoSpec 计划范围、源码发现及未实施边界。
tags: [adapter, interaction, protocol, planning]
---

# 规划记录

按用户要求在上游独立 worktree、分支 `codex/289-approval-delivery-plan` 规划 [P0 #289](https://github.com/Mininglamp-OSS/octo-runtime/issues/289)。首次基于 `3f2a810b` 建树，检查期间上游更新，已快进至 `148d737d3ee14f0453ae5018c563b08d6b21ec5b`；新合入仅涉及 Harness 文档，审批源码未变。

固定同步 `octo-spec@1.2.0`，按命中路径/标签读取规则并登记 [context.yaml](../../tasks/289-approval-delivery/context.yaml)。计划明确人工审批 256、自动/人工回答统一投递、单一 stdin 写入所有者、callback/drain 顺序、字节/条数/期限、取消不可撤回及本地错误优先归因。

发现 native 公共校验器只允许流容量错误携带 failure，因此将 Core 的受限投影与校验分支纳入计划；SDK 的另外两处 16 条审批桥不在 Codex 调用链，未扩大修复到其他 Provider。相关 CI 入口已核对，新增专项拟放 test/manual，保持默认检查范围。

[简报](../../tasks/289-approval-delivery/brief.md)、[实施计划](../../tasks/289-approval-delivery/plan.md)及[验收矩阵](../../tasks/289-approval-delivery/validation.md)已形成。准备度 96/100 是计划主观评估；真实 Provider、预算校准和平台时序仍待实施验证。本轮没有修改产品代码、提交或推送，也没有触碰 Work App 及其 Runtime 子模块。

# 实施记录

用户追加实施、code-review 和 PR 授权。实现人工等待 256 与独立发送器；普通 RPC 和审批响应共享 callback/drain 背压，取消删除未发送响应，清理沿 EOF 和受管进程回收。公开期限保留 10 分钟，内部投递使用 30 秒期限与 5 秒无进展期限。中央分类、Core native 投影与受限公共校验保持原因一致。

真实 Codex shell 在 canonical/native 分别观察到 20/27 个并发待写回审批，各 32 条请求成功；动态 MCP 各 32 次调用完成但无审批突发。清理完成且未改变既有认证。最终验证结果见 [验证记录](../../tasks/289-approval-delivery/validation.md)。未触碰 Work App 子模块或扩大 CI。

两轴审查发现三项问题并完成闭环：容量拒绝移出 8 条控制预留、聚合清理故障保留本地执行首因，以及验证记录范围表述。复核未关闭问题均为 0；修复后专项及相关回归 123/123 PASS。具体证据见 [审查记录](../../tasks/289-approval-delivery/review.md)。

PR #290 创建期间对齐主线 `dc14c094` 的 async question 修复，独立问题额度、RPC ACK 和晚答语义保留。复核发现并修复协议校验错误误报传输故障；最终定向 174/174、Spec 独立复验 13/13 通过，两轴未关闭均为 0。PR 标题修正为 Conventional Commit 后已通过标题检查，最终提交重跑现有 CI。
