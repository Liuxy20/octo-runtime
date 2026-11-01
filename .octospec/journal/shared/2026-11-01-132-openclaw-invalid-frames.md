---
type: Journal
title: Issue 132 无效帧实施记录
description: 从坏帧断连建议调整为日志跳过，并验证共享 worker 后续可用。
tags: [openclaw, protocol, testing]
---

# 用户决定与实施

原 Issue 建议坏帧关闭连接，用户明确希望 null 后继续接收正常结果。已先更新英文 Issue 和 [规格](../../tasks/132-openclaw-invalid-frames/brief.md)，规划可执行性 96/100；用户“开始实施”后，基于 main `148d737d` 修改 Gateway 接收入口与 Adapter 日志传递。

解析结果先按 unknown 校验，仅对必要路由字段判定。无效消息采样诊断后 return，保留 socket、pending、原期限。诊断只输出固定原因和计数，未注入 sink 时尝试 stderr，不写 worker stdout。正常 RPC 失败、取消、断连及终态归一化沿用已有合同。

真实 loopback、独立子进程和真实共享 worker 的 29 项专项通过；相关回归 162 通过、1 GC 项条件跳过。双轴审查修复测试清理等待无期限问题后均无未解决项。完整命令及未验范围见 [验证](../../tasks/132-openclaw-invalid-frames/validation.md)和[审查](../../tasks/132-openclaw-invalid-frames/review.md)。

本次未提交、推送或创建 PR，未扩大 CI。进入验证审查，真实 Provider 及跨平台验收独立保留。

## 本地复审与补充验证

按用户后续要求重新执行 code-review 双轴与 verified-review。修正审查文档类型 Task 为 Review；没有新增产品缺陷。严格 unhandled rejection 模式下手动专项 29 项通过，开启 GC 后相关回归 163 项全部通过（此前跳过的 GC 项已补验）。构建、类型、lint、命名和知识检查重新通过。最终结果补充到 ORT-38 任务评论，工作区保持未提交，仍待验证审查。

## 授权交付

用户进一步授权同步代码、提交 PR 并合并 main。已保留配置的 Git 作者并加入 Codex trailer，rebase 到最新 main `dc14c094`；知识日志冲突保留双方记录，产品无冲突。同步后构建、类型、lint、29 项严格专项及 163 项含 GC 回归重新通过，独立 Spec 复核无新增问题。后续 PR、检查与真实合并事实写回 ORT-38，不能把已授权合并等同于已经合并。

PR #291 获得两位审查者批准后，等待 CI 时补跑全量，发现旧 adapters Gateway 测试仍要求破损 JSON 失败，并因 server/client 清理先后顺序卡住。此前相关定向验证遗漏该文件。已更新既有测试的合同和有限清理，不新增 CI 范围；35 秒未退出到修复后自然退出 0 的证据和增量双轴复审见任务 validation/review。最终 CI 和合并事实仍由任务评论记录。
