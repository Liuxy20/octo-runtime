---
type: Task
title: Issue 150/171 Gateway 满载准入与容量文档
description: 修复已有会话满载排队误拒收，统一容量例子及连接恢复说明。
tags: [channel, session, testing, documentation]
---

# 目标

处理 [#150](https://github.com/Mininglamp-OSS/octo-runtime/issues/150) 的满载排队误拒收，以及 [#171](https://github.com/Mininglamp-OSS/octo-runtime/issues/171) 的容量和恢复文档冲突。基线为 `main@0ca12a03a055ccb766e6126716c51bb6cc6efe1c`，独立 worktree，分支 `fix/150-171-gateway-capacity`。

## 合同与归属

- 决定权属于 Octo Gateway 的消息准入；只修复既有 F26 合同，不新增容量配置或公共接口。输入为通过现有授权与去重的消息。
- 每 Bot 最多占用 64 个工作槽。同一逻辑 session 串行处理，一条工作消息加最多四条排队消息；已有非空队列追加消息不申请新槽位。
- 仅 `pending === 0` 的 session 在接纳首条消息时申请槽位；`pending >= 5` 优先按会话队列满拒收。新/空闲 session 在 Bot 满载时仍拒收，历史 binding 的存在不改变此判断。
- 原工作结束并完成必要清理后，槽位原子转交同 session 下一条消息；最后一条完成后释放。取消请求回执不等于工作结束，不提前释放槽位。
- 服务与进程拓扑、资源所有权、共享 Kernel、Provider、WeCom、历史 store、消息去重及投递策略保持现有合同。Gateway 自身维护计数，宿主不接管其队列。
- 文档按工作、排队、历史 binding 分别说明，并用单会话、20 个工作会话、64 个工作会话及释放后重新接纳举例。
- 首次暂态失败与后续暂态断线均恢复；退避为 5/10/15/15… 秒，从连接回收结束后计算，Retry-After 可延长。成功完整上线后重置；缺凭据与明确终端错误停止恢复。

## 顺序与验收

1. 先更新 Octospec 规则和目录，再更新中英文 Gateway README，保留历史 journal 的原始记录。
2. 增补既有容量回归：先占满 64 个工作槽，再给已有 session 追加四条；第六条拒收，新第 65 个工作 session 仍拒收。
3. 旧实现必须在新增回归中失败；修复只在需要新工作槽时检查 Bot 上限。
4. 验证 FIFO、完成/失败/取消后的转交、最后一条结束后的释放与重新接纳；关闭释放所有排队及工作计数，拒收不触发模型或已读。
5. 本地运行相关容量、调度、恢复回归及 build/typecheck/lint、文档检查，按 verified-review 逐文件审查并记录真实边界。
6. 不修改 workflow、job、矩阵、触发器、必需状态或 CI gate，不增加专项 CI 接线。提交前核对 workflow diff 与 PR 实际检查列表。
7. 英文 commit 和 PR，保留 Git 作者配置及 Codex trailer。PR 使用 `Closes #150` 和 `Closes #171`；创建 PR，不自动合并。
