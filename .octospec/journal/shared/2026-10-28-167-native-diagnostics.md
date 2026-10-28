---
type: Journal
title: Issue 167 Windows 原生命令输出编码
description: 区分已修 PowerShell JSON 与剩余 schtasks 诊断乱码，并记录最小内部修复。
tags: [runtime, windows, installation, testing]
timestamp: 2026-10-28T09:08:00Z
source: self
---

# 结论

#179 已修中文 JSON 路径与同账号表示误报；本次只修直接 schtasks 管道。代码页在相同隐藏控制台条件下只读查询，原命令仍直接执行，按原生编码增量解码。公共 SDK、协议与调用方保持现状。

82 项相关回归、5 项原生 SDK/CLI、四组附加原生对照、35 项 UI、构建/类型/静态检查及包外离线验证通过。全量 Node 有 DSH 失败和未退出子进程，按身份确认后停止本次树，未报告全量通过。完整结果和未覆盖项见 [验证](../../tasks/167-native-diagnostics/validation.md)。

# 规则影响

已在 runtime-lifecycle 补充原生文本与 PowerShell JSON 编码边界：不能按本机 GBK 固化全平台规则；解码必须在字节丢失前完成，内部查询不能改变 argv、原生失败或重置超时预算。用户已授权创建关联 #167 的 PR，正文明确 #179 的部分修复归属及本次范围；issue 正文保持原样。
