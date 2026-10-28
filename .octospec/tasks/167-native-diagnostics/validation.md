---
type: Task
title: Issue 167 修复与 Windows 验证
description: schtasks 中文输出兼容的实际结果、既有修复归属与全量检查限制。
tags: [runtime, windows, installation, testing]
timestamp: 2026-10-28T09:08:00Z
source: self
---

# 结果与范围

基于 `main@064f56a25ff431f5fc1c001b2830ba79d45ec951`，分支 `fix/167-windows-native-diagnostics`。以下检查针对提交前的工作树执行。用户随后明确授权提交、推送并创建关联 #167 的 PR；issue 正文保持原样，不自动合并或发布。

#167 原有的 Unicode JSON/路径误报与同账号表示差异已被 #179（`81284c9`）覆盖。当前 Windows 11 实测不能复现；不重复实现。本次只修真实 schtasks 管道字节被强制 UTF-8 解码导致的 stdout/stderr 和 ServiceError.detail 乱码。

# 实现与合同检查

- `NodeCommandRunner` 仅对原生 Windows `schtasks`/`schtasks.exe` 查询隐藏控制台代码页，以 iconv-lite 0.7.3 流式解码；其余命令和平台沿原 UTF-8 分支。
- 代码页查询是只读 `cmd /d /c <System32>/chcp.com`；不改变系统/宿主代码页，不解释原命令 argv。成功按 runner 实例缓存，失败不缓存、不猜测。
- 查询与原命令共用既有预算；原 schtasks 仍由 Node 直接 spawn，shell=false。真实 exit code 124 与 timer 触发分开，原始 ENOENT、COMMAND_FAILED、exitCode 和真实 drift 保持。
- 每个输出流继续最多保留尾部 64 Ki 个 JS 字符单位；DBCS 跨 chunk 边界保留，end 时刷新不完整字符状态。非原生 UTF-8 的 BOM 与原有字符串行为保留。
- 新依赖为纯 JS，锁文件只新增 iconv-lite 与 safer-buffer；没有原生扩展、宿主要求、公共类型/SDK/协议变更或 CI 变更。

# 环境

Windows 11 企业版 10.0.22621 x64，普通非管理员；Node 24.22.1，pnpm 11.19.0，TypeScript 6.0.3。外层 shell 为 PowerShell 7.6.5，产品实际查询为 Windows PowerShell 5.1.22621.1778，zh-CN / CP936。默认 PATH 的 Node 22 未用于本轮构建和测试。

# 已执行检查

| 检查 | 实际结果 |
| --- | --- |
| 基线 frozen install，含 prepare 全仓构建 | 通过。 |
| 新增回归运行于未修改 runner | 12 项：2 通过、10 失败，确认能暴露原生编码及新增预算约束。 |
| 修复后相关文件 | 82 通过、0 失败、0 跳过；含 14 项 runner 合同回归及既有跨平台 fixture/失败传播。 |
| frozen install --ignore-scripts | 通过；确认新增生产依赖与 lock 一致。随后 typecheck 执行完整构建。 |
| pnpm typecheck | 通过，含全仓构建与根类型检查。 |
| pnpm lint、lint:names、format:check、git diff --check | 通过。 |
| 自定义原生 backend 矩阵 | 四组通过：ASCII/空格、中文/空格 Home × enabled false/true，含中文 argv、引号与末尾反斜杠；install、inspect、重复安装、删除及独立不存在确认均通过。 |
| Windows 原生 SDK/CLI 既有测试文件 | 5 通过、0 失败、0 跳过；含定义编码迁移与四组真实 SDK/CLI 安装/查询/删除。 |
| 真实 schtasks 成功/失败管道 | 原生成功 verbose stdout 保留中文路径/参数；不存在任务及无效 /FO 的 stderr 可读；真实 runCommand 返回 COMMAND_FAILED、exitCode=1 和正确中文 detail。 |
| PowerShell 与 drift 对照 | JSON 精确保留参数/目录且无假 drift；去掉 UTF-8 前缀仍重现旧路径问题；预期值真实变化及不同 SID 的 drift 保持。 |
| WebUI 测试 | 35 通过。 |
| 本地发行打包 | 通过。 |
| 包外离线安装 | 通过；只安装 tgz，公共 Host import 成功，包内 native runner / ServiceError 中文诊断正确。 |
| 全量 Node，concurrency=4 | 未通过/未完成。DSH 的 `CLI playboard route uses injected PATH instead of process PATH` 已失败；DSH/Grok 等测试保留子进程，约 8 分钟后核对 PID、父 PID、启动时间和命令身份，回收本次 runner 树。不提供全量通过数。 |

针对性测试命令：

```text
node --unhandled-rejections=strict --test test/cross-service-runner.test.js test/cross-service.test.js test/cross-service-failures.test.js
node --unhandled-rejections=strict --test test/cross-service-windows-native.test.js
node --unhandled-rejections=strict --test --test-concurrency=4 test/*.test.js packages/octo-runtime-protocol/test/*.test.js
```

# 失败处置与环境控制

- 首次 pnpm add 遇到 tsc.ps1 的 EBUSY；已有依赖和 lock 写入后 manifest 未保存完整，已补齐精确声明，并以 frozen 安装成功验证最终状态。未修改系统保护或全局包管理器。
- 新 checkout 的 Git CRLF 转换造成初次格式检查 658 文件告警。仅对字节归一化后与 index blob 哈希一致的未改文件恢复仓库原始换行；用相同 blob 刷新 Git stat 缓存，不产生内容暂存。最终 format 通过，实际 diff 无无关文件。
- Node 24 是便携安装，首次 pack 默认在其相邻目录查找 npm-cli.js 失败。通过既有 npm_execpath 输入指定本机 npm CLI 后正常打包，未修改打包脚本。
- 首次包外验证脚本错误地用 require 条件解析仅支持 import 的 Host export；已按原包声明的 import 入口验证通过，未改公共 exports。
- 对全量中 DSH 的 `CLI playboard route uses injected PATH instead of process PATH` 做单项对照：用 HEAD 原版 runner 经测试专用模块 hook 替换本次 runner，其他产物保持；基线与修复后均报相同 `COMPONENT_CLEANUP_INCOMPLETE`，并在 20 秒预算后回收所属树。这条失败可独立于本次修复重现。Grok 停滞在此前 main 的 Issue 142 记录中有同类观察，但本轮未完成全量干净基线对照，不声称全部失败均已归因。未扩修这些模块。

# 证据与限制

原始日志保留在聊天 work 目录：`167-focused.log`、`167-native-sdk-cli.log`、`167-fixed-native.log`、`167-typecheck.log`、`167-lint.log`、`167-lint-names.log`、`167-format-final.log`、`167-pack-final.log`、`167-package-consumer-final.log`、`167-all-node.log`、`167-full-suite-stop.json`。

DSH 单项对照另见 `167-dsh-control.json`、`167-dsh-baseline.log` 和 `167-dsh-fixed.log`。该对照只替换测试加载的 runner，未改源代码或最终运行产物。

用户可见证据为聊天 outputs 内 `issue-167-fixed-windows-evidence.json`，包含真实原始管道 bytes、修复前后编码对照、产物摘要、错误翻译、四组临时任务清理与包外验证结果。原分析证据另存，未覆盖。

CP437/850/65001 为受控分片字节与查询 fixture，不代表这些 locale 的原生 Windows qualification。没有 Windows 10、Server 2022、Node 26、macOS/Linux 真机或真实 Provider/IM 验收。当前源代码与本地打包验证不表示已发布或更新用户正在运行的全局 Runtime。
