---
type: Journal
title: Issue 242 符号链接测试前提与可信结果
description: 记录独占夹具能力判断、普通断言拆分和 Windows 正向验收缺口。
tags: [testing, windows, security]
timestamp: 2026-11-03T04:12:00Z
---

# 变更与学习

在 `e6809e9` 上复现六项 Windows symlink 夹具 EPERM 及两项静默返回。新增测试专用 helper，只把实际夹具创建的 Windows EPERM 转为有原因的 skip；普通文件断言独立执行。四文件最终两版 Node 均 136 pass / 0 fail / 10 skip，其中八项为本次能力 skip，不能描述为保护验收通过。

混合测试的夹具失败会遮住其他断言。例如盘符路径在 Windows 合法，不能用它确定性触发 POSIX 的 path-unavailable；本次保留原引用并增加明确无效的 file URL，生产路径判断不变。

能力前提必须限制在创建夹具的窄边界，不能包住产品操作或按平台整批跳过。可复用约束已回写 [engineering](../../rules/engineering.md)。受控注入验证错误传播与报告语义，不证明真实 symlink 保护。当前普通用户 file/dir 创建均 EPERM，因此八项 Windows 正向保护断言仍未验证，#242 不满足关闭条件。

完整命令、覆盖率、失败迭代、格式基线、工程检查与未验证边界见 [validation](../../tasks/242-windows-symlink-prerequisites/validation.md)。没有修改产品代码、CI 或其他缺陷来源分支。用户后续明确授权提交 PR，以草稿关联 #242 / #14 并保留正向 Windows 验收缺口，不自动关闭 Issue。
