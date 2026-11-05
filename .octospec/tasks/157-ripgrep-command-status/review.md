---
type: Review
title: Issue 157：本地实现审查
description: 按状态归因、输出保真、范围与验证证据审查未提交 diff。
tags: [review, adapter, canonical, testing]
---

# 审查对象

基线 `780cd7cd5e67e4868df895a2e74a826097f349fd`，对象为本次全部 tracked diff 与 untracked 任务、journal 和手动测试。串行自审，未委派子代理，未声称独立外部审查。

## 规格与责任

- 首个错误转换位于 Adapter 的 `isRipgrepNoMatch`，仅调整该例外。原生事件、运行命令、重试、Core、服务所有权和公共 schema 无改动，#316/#317 保留。
- 严格要求实际数值 exitCode=1、明确空字符串输出。缺失/null/对象/非空/纯换行输出不再充当“已知无匹配”。工具 ID、exec_command 名称、stepId、顺序、running/terminal 和原始 exitCode/output 均通过出口断言。
- 整条命令匹配字面子集；拒绝 shell 运算符、展开/转义、包装、其他可执行名和格式错误。没有从 commandActions、末段或链式文本推导前置执行事实。
- 正则的路径、参数及分隔符采用不同字符边界，不引入通用 shell parser；引号内含运算符也保守拒绝。对 rg 的命名识别沿既有本地受信执行边界，不声称验证 PATH、alias 或同名可执行文件的身份。

## 测试与修正

- 基线真实 cmd 反例已复现并独立存为 JSON；成功匹配、无匹配、真实错误及 suppressed stderr 分别检查。
- 新专项保持 `test/manual/` 显式执行。旧根测试仅将不具备前置成功证据的链式预期改为 failed；未删减业务或清理断言。默认 suites、CI、打包及选择器无扩展。
- 夹具首次错将 `tool_call.delta` 写成 update，已修正；首次并发基线有一次 5 秒 PowerShell 超时，串行复测使用有界 15 秒单命令期限。
- cmd 嵌套引号的初版夹具错误采用 Node 默认 C argv 转义。依据 Node 文档显式设置 windowsVerbatimArguments 并包住 `/s /c` 命令边界，重跑 Node 24/26，全部 26 项通过。此更改仅位于测试，不修改用户命令或生产启动器。

## 规则核对

核对 architecture、protocol-design、output-protocol、adapter-metadata、context-input、environment、mcp、reasoning、engineering 和 collaboration。无业务意图补造、无凭据引入、无 CI 变更。规则正文仅向 output-protocol 回写失败归因约束；完整验证与未验范围见 [validation](validation.md)。

目前核心修复无未关闭 finding；全仓门禁不能表述为全绿，详见 validation 的基线及修复后结果。

修复后全量六项失败中，四项与基线重叠，另两项位于 native-host 的 owner shutdown 清理钩子，串行专项通过；其 fixture 不发 rg commandExecution，不进入本次例外。未据此宣称并发清理根因已查明，也未更改 #317 的生命周期或清理断言。完整默认门禁仍失败。
