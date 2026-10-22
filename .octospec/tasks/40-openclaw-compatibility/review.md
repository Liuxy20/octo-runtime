---
type: Task
title: Issue 40：交付评审记录
description: 分别记录工程规范与需求实现复核，以及收尾竞态的修复和回归依据。
tags: [openclaw, adapter, testing, git]
timestamp: 2026-10-22T00:00:00Z
---

# 评审范围

对照 Issue 40、用户授权的 ask 向 full_access 回退口径及任务验收，独立执行工程规范与需求实现两项复核。交付基线已更新至 main 的 `102fb9caf995d9eb1ac53acaf5b91922be4f023d`；索引冲突保留 Issue 99 与 Issue 40 两项记录。

以下首次交付结论只针对当时检查的场景。PR #102 对 `c3e4f1f` 的外部评审随后复现新问题；不能以原 CI 或原复核通过替代这些问题的修复。最新结果见文末 PR 复核。

## 工程规范复核

无问题。实际覆盖 Adapter、共享审批桥、源码请求投影、真实验证脚本与脱敏证据；按仓库规则检查职责、合同、注释与知识回填。GitHub 内容和提交信息依据用户明确要求使用英文。

## 需求实现复核

初次发现一项 P1：已收到原生成功结果后，消费者在接收 model_step.finished 或最终消息时取消，会被 signal 状态覆盖成 run.cancelled，且触发无意义的 abort。

已修复：最终回执在 yield 前保存终态；lifecycle 在 yield 前完成原生对账。已知终态不再走取消桥，已确认失败也不被迟到取消覆盖。4 条回归分别覆盖最终回执／lifecycle 与模型步骤／最终消息两个取消时点，要求唯一 run.completed、无 stopped／run.cancelled、无 sessions.abort。

独立复核通过，未发现剩余需求阻断；`node --test test/openclaw-compatibility.test.js` 共 75 项通过。连同 Codex 文件的定向复跑共 101 项通过；原有取消 ACK 与成功证据矛盾时失败的测试继续保留。

交付回归：同步最新 main 后 WebUI 35 通过；完整 Node 套件以并发 4 执行，1570 通过、35 条件跳过、0 失败。默认并发两次分别出现未改动的 Codex 收尾计时、进程组回收超时，定向复跑均通过；失败和命令差异如实记录于 implementation.md。

## 验收边界

用户已接受真实 6.11 与 9.4 的代表验证，授权提交、PR 和合并；不将未实测版本标成真实通过。内网地址与凭据不进入 PR。GitHub main 仍要求 CI Gate 及至少一条其他账号的批准，交付遵守保护规则。

## PR #102 外部意见与同类问题

读取 Jerry-Xin、yujiawei 对 `c3e4f1f5d508cecd34a1fb57dca6474ae54cab70` 的两条请求修改评审，逐项复现后确认两项均成立。独立扩查工程规范与需求实现，又确认三项相关缺陷。五项均已修复：

| 来源／级别 | 触发与影响 | 修复与回归 |
| --- | --- | --- |
| 外部 P1 | `pending` 被客户端当最终回执，后续相同 RPC ID 的最终答案、usage 被丢弃 | RPC、wait 与 terminal 共用中间回执判定；同时覆盖同类 `running` 和 pendingError。真实本机 WS 验证 pending／running 后的最终文本与 usage，严格只执行一次 |
| 外部 P2 | lifecycle wait1 挂起，取消任务 wait2 确认取消后主动 close，wait1 因连接关闭失败，最终误报 run.failed | 已确认的终态优先收尾；真实 WS 保持 wait1 未响应，验证 aborted／rpc 均只产生一个 run.cancelled、一个 agent 和一个 abort |
| 扩查 Spec P1 | 原连接／最终回执／恢复连接的旧 wait 迟到返回，覆盖已确认取消为成功或失败 | 所有异步对账先保存局部结果，只有尚无终态时才能提交；三路径乘两种过期结果共六条回归 |
| 扩查 Standards P2 | lifecycle 在 wait 前标记模型步骤已结束，却因断线未发布；恢复后只发 Run 终态 | 等对账后再归一化 lifecycle，统一终态出口补齐已开始步骤；恢复完成／失败／取消三个场景各有唯一匹配步骤结束 |
| 扩查 Spec P2 | 对账中溢出或终态后迟到广播触发 abort，正常收尾却仍报成功 | 确认终态后不再接收广播；对账返回和正常出口优先检查原始资源错误。分别覆盖收尾 4097 广播及 wait 中同步溢出，后者必须失败、不得重连或报成功 |

新增 17 条回归，另扩展已有客户端测试覆盖全部中间状态。全部 OpenClaw 测试 114 项，113 通过、1 项 GC 条件跳过、0 失败。修复前两条真实 WS 复现及扩查用例分别失败；修复后通过。保留矛盾 abort 证据必须失败、迟到取消不改写原生失败及真实 transport cleanup 错误仍拒绝的控制。

最终独立复核：Standards 无剩余规范问题或代码异味；Spec 无剩余已复现阻断。没有新增 Provider 实网、模型或 IM 验证，WS 为本机受控对端。已有 6.11／9.4 代表实网证据保持原范围。

补齐最后资源竞态及清理控制后，默认并发完整 `pnpm test:suites`：Node 1622 项中 1587 通过、35 条件跳过、0 失败，WebUI 35 通过。最终完整构建／类型、lint、命名、格式、开发文档（4 条执行测试）和 diff 检查均通过。OctoSpec checker 仍只有原有 docs 目录冲突。该结果针对本地修复，不借用旧 head 的托管 CI 作为新提交通过证据。
