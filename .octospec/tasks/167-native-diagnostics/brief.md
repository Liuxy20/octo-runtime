---
type: Task
title: Issue 167 Windows 原生命令诊断编码兼容
description: 仅修复仍可复现的 schtasks 管道输出乱码，保留已合入的 PowerShell JSON 与身份修复。
tags: [runtime, installation, testing, windows]
timestamp: 2026-10-28T08:48:57Z
slug: 167-native-diagnostics
source: self
upstream: https://github.com/Mininglamp-OSS/octo-runtime/issues/167
---

# Goal

在当前 main@064f56a 上修复真实 Windows schtasks stdout/stderr 及 ServiceError.detail 中文乱码。用户先授权修复与测试，随后明确授权提交、推送并创建关联 #167 的 PR；issue 正文保持原样，不自动合并或发布。PR 须说明 #179 已覆盖旧 issue 的路径和账号误报，本次只补剩余原生输出兼容。

# Background and responsibility

- 业务目标是可读、准确的服务管理诊断；上层宿主决定操作，cross-service 负责原生适配和输出解码。
- 显式输入继续为 command、独立 argv 和既有 CommandOptions；公共 SDK/协议/类型不增加编码参数。
- main@14ed9c6 的 Windows 11 普通用户原生矩阵已验证四组安装/查询/重复安装/删除无 drift；#179 的 UTF-8 JSON、UTF-16LE BOM 与 SID 比较已有效。
- 同机 NodeCommandRunner 的真实 schtasks 输出仍乱码；同一原始字节用本机代码页可恢复，产品 runCommand 错误翻译保留代码但 detail 已损坏。
- 修复归最先错误解码的产品命令边界，不以测试更改、文本过滤或硬编码 GBK 遮盖问题。

# Design and load-bearing contracts

- 仅原生 Windows schtasks 使用其隐藏控制台代码页；其他命令、PowerShell JSON 和非 Windows 仍按现有 UTF-8 合同处理。
- 通过系统已有 cmd/chcp 的只读查询取得代码页；不修改代码页、系统设置或用户数据。首次成功后按 runner 实例缓存；并发查询各自遵守原调用预算。
- 用纯 JS iconv-lite 支持包含 CP437/850 在内的 OEM 编码；Node TextDecoder 不能覆盖全部这些代码页。解码跨 chunk 保留多字节边界，输出继续有界。
- schtasks 仍由 Node shell=false 直接启动；不把用户 argv 交给 shell，不引入管理器包装进程或新的长期服务。
- 代码页查询和原命令共用既有超时预算；查询失败明确失败，不静默猜测 UTF-8/GBK。原命令的 ENOENT、exitCode、COMMAND_FAILED 和真实 drift 保留。
- CLI 和其他 SDK 宿主共用相同内部实现，无调用方改动。资源只包括本次短命令和测试临时任务。

# Out of scope

- 不重做 #179、不改身份语义、公共 SDK/协议、Provider、进程树清理、其他 issue 或 CI 范围。
- 不操作已有 Runtime Home、服务、凭据、配置或不属于本次测试的任务；不将 Windows 11 结果推广到 Win10/其他 locale/Unix 真机。

# Acceptance

- 新增回归在未修复 runner 上暴露 OEM stdout/stderr 错解；修复后按 CP936、CP850/437 与 UTF-8 对照通过，含多字节分片、尾部保留、超时及查询故障。
- 真实 schtasks 非零中文错误经 runner/runCommand 可读，成功查询保留中文参数与目录；原始码保留。
- 四组原生服务矩阵复测通过，并确认随机命名任务均删除；已修 JSON 不退化，真实 drift 仍报告。
- 运行相关测试、lint、format、typecheck 与依赖/构建检查；记录全量及平台缺口，不修改无关失败。
