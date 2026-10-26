---
type: Task
title: Issue 17 DSH Desktop 原生 SDK Adapter
description: 经独立 dsh adapter 调用已有 Desktop 的 SDK subprocess，统一事件、恢复、取消和错误。
tags: [adapter, dsh, context, lifecycle, testing]
timestamp: 2026-10-24T00:00:00Z
---

# 目标与授权

> 2026-10-25：本文记录 #173 的历史方案。用户已否决自实现 Client，当前替换方案见[官方 Client 接入](../17-dsh-official-client/brief.md)；本文自实现及其容量/进程组保证不代表替换后的实现。

从最新 `origin/main@67e2e509ed7a5be03255c76810cdd791b79475ab` 建立独立 worktree，实施 #17；用户已授权实现、审查、端到端测试、英文提交、PR 和合并。此前 F28 的“当前不实施”由本次授权更新，不移植旧 Gateway engine。

## 合同

CLI/SDK 原生 Kernel → worker 内唯一 AgentExecutor → dsh adapter → 每 invocation 独占的 DSH SDK 子进程。Desktop 是已安装 Provider 的分发载体，不接管正在运行的 Desktop GUI，不启动另一 Kernel/Gateway。新进程复用用户选定的 DSH Home/认证；不覆盖 profile，不复制凭据，不安装 Provider。

业务 Context 由 Core 渲染；adapter 只传 providerInputParts。本轮执行配置和环境不进入模型文本。续聊使用明确 providerSession 并调用原生 session/resume；失败不换 session。reset 由业务层清 binding，下一轮生成新 Provider ID，保留目录和存档。

`session/prompt` 只接纳；成功须同时观察本轮 receipt、root turn/end completed、非空已提交文本及 session/wait 完成，并确认进程清理。取消关闭本次拥有的进程，不影响兄弟 invocation；同一 Provider session 并发在 Adapter 内拒绝，上游持久层仍负责跨实例互斥。

## 范围与限制

固定 Desktop/runtime `0.2.1-rc.3`（build `be72761ee1a6736ebcdf4f3739363b083ae53c98`），SDK wire serverInfo `0.0.1`。低层 Client 依照该版本协议实现，复用 Runtime 有界 NDJSON、队列和进程清理；不依赖会隐式安装 DSH 的官方 TS client。

此版本 SDK 无交互审批/逐 Run cancel；ask、assisted 明确拒绝，只有调用方显式 full_access 可执行；设置原生 DSH_PERMISSION_MODE=danger-full-access，不自动升级。非默认 actmode、未接线 MCP 明确拒绝。reasoning 按公共 mapper 返回未应用提示。

SDK 只发布 durable assistant/message（含 compact stream），没有逐 token live notification。逐消息/模型步输出经通用 canonical 流投影；不得宣称逐 token 实时能力。子 Agent 可用 lineage 放入现有开放 payload 字段，不修改公共协议。

## 验收

1. fixture 覆盖协议、队列/行上限、唯一终态、快照/增量去重、child 归属、错误、无 receipt/终态、空结果、恢复拒绝、同 session 并发和取消隔离。
2. pnpm build/typecheck/lint、相关测试、全量测试、发行包外 import 与 CLI discovery。
3. 本机真实 Desktop：KernelClient 调用、新建、持久续聊、工具操作、取消和后续恢复、兄弟任务、缺失进程/断流。
4. `https://im-test.deepminer.com.cn/` 专用测试会话验证 SDK 和 CLI Gateway：DM、群 @、拒绝、卡片、failure/cancel/recovery/reload。缺少身份或环境时逐项记录 BLOCKED，不能用 fixture 替代真实结果。
5. verified-review 串行逐文件阅读及执行，修复后复验。未完成的 issue 验收不标记通过。

设计及版本事件表见 [design.md](design.md)，准备度见 [assessment.md](assessment.md)。
