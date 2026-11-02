---
type: Journal
title: "Issue 236：启动失败与已确认清理分别表达"
description: "Windows ACP native spawn 拒绝不能在成功清理后继续污染 Core ownership。"
tags: [adapter, lifecycle, windows, octospec-learning]
timestamp: 2026-11-02T08:53:00Z
source: self
---

# 改动与经验

基于 main `58332b3`，ACP 对原生 spawn 错误在 transport close 成功后输出保留 errno/message 的失败终态。Core 继续保守处理任意 next 拒绝和 finally 失败。生成器已经执行 finally 并不意味着消费者有可验证的清理证明，后续空 return 也不能抹去真实失败。

两版 Windows Node 原 #236 文件各三轮 6/6；显式专项各 6/6，验证 worker drain/PID/管道和完整 Kernel 释放与端点复用。#237 Node24 仍有取消回滚失败，额外诊断在 replacement.close 捕获独立 manifest rename EPERM；不能把历史 initialize、当前回滚及该文件 IO 故障混作一根因。非 spawn CodeBuddy close incomplete 也在原 HEAD 对照复现，保留后续处理。

规则回流：[本地执行](../../rules/local-execution.md)补充 ACP 原生启动错误的终态边界；没有放宽 Core 或 Windows 进程回收保证。完整矩阵、默认套件结果与未验证平台见 [validation](../../tasks/236-windows-acp-cleanup/validation.md)。初次交付仅本地修复；用户后续明确授权沿用已有 SSH 身份推送来源分支并创建 PR，#237 和 #14 只关联，不直接关闭 Issue 或合并。

## 合入 #295 后的 rebase

用户授权将 PR #297 对齐 `main@f06546e9` 并补充提交。local-execution 冲突保留上游原生 owner 规则，不恢复已删除的 worker；手动专项和原 ACP 文件按当前原生 Kernel/RPC 迁移，要求已清理的 spawn 失败完整 close。生产 ACP 修复未变化。当前两版 Node 的12项 ACP 组合与5项原生清单/取消启动组合各三轮通过；用原 main ACP 实现做对照仍有5项失败，说明不能仅通过接受 main 的 known-incomplete 预期消除缺陷。完整当前结果与历史证据分开维护。
