---
type: Journal
title: Issue 157：整条 shell 退出码不能归属最后一段
description: 独立 Windows 复现与保守 rg 无匹配例外修复的本地交付记录。
tags: [octospec-learning, adapter, canonical, testing, windows]
---

# 修复与学习

最新主干独立 clone 从 `780cd7cd5e67e4868df895a2e74a826097f349fd` 开始。真实 cmd 前置失败 + 空输出 + exit 1 经基线 normalizer 被改为 completed，说明“最后一段以 rg 开头”不能证明 rg 运行过。

只在明确独立字面 rg/rg.exe、exit 1、显式空输出时应用原有无匹配例外。包装、复合命令、展开/转义及无法可靠解释的引号形式保留失败；保留 exitCode、output、身份与生命周期，不重试、不改执行命令。`commandActions` 也不是逐命令执行证明。

Node 24/26 手动专项各 26 通过，含 20 个真实 Windows shell 场景；相关 native/canonical 回归通过。默认全量基线存在八项失败，具体门禁状态、夹具修正和未验收平台见 [validation](../../tasks/157-ripgrep-command-status/validation.md)，不声称真实 Codex Provider 或跨平台已验收。

可复用约束已回写 [output-protocol](../../rules/output-protocol.md)，不新增通用 shell parser、公共 API 或 CI。首轮只完成本地交付；用户在知悉专项与全量结果后追加授权 commit、push 及创建关联 #157 的 PR，尚未授权合并、发布或直接关闭 issue。
