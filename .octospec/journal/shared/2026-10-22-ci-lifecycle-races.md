---
type: Journal
title: CI 生命周期竞态修复与验证
description: 记录恢复 fixture 通知竞态、Windows 身份查询测试隔离及实际验证范围。
tags: [testing, ci, recovery]
timestamp: 2026-10-22T00:00:00Z
source: self
---

# CI 生命周期竞态修复与验证

## 依据与修复

基线 `main@88fa71d`，独立 worktree `octo-runtime-ci-lifecycle-races`。
[macOS Node 26 失败](https://github.com/Mininglamp-OSS/octo-runtime/actions/runs/39732869529/job/119671741690)为恢复用例启动次数 `5 !== 6`。
fixture 原来先记录启动，再检查故障文件；测试读到记录后立即恢复环境，可让本应失败的第五次启动直接就绪。
现在先确定 blocked 结果再发布记录，并逐次断言初始成功、四次失败和最后一次成功；两次 15 秒慢恢复间隔仍精确验证。

确定性交错探针在 appendFileSync 返回前删除故障文件：旧 fixture 没有按故障退出，最终由探针 SIGKILL；新 fixture 以 78 退出，记录 blocked=true。
探针只在临时路径运行，未加入产品或更改退避时长。

[另一轮 Windows Node 24 失败](https://github.com/Mininglamp-OSS/octo-runtime/actions/runs/39731913784/job/119668645767)仅显示登记轮询 15 秒超时。
原始启动拒绝已被用例吞掉，因此不能确认底层原因。PR 第一轮 Windows Node 24 在取消前约 2 秒出现 KERNEL_START_CLEANUP_INCOMPLETE，内层错误被默认打印深度截断。
现在完整输出嵌套原因，直接等待父进程真实 setWorker 完成，取消 PID 文件及清单轮询，再读取清单确认实际 PID；initialize 拒绝立即传播，仍检查取消原因与 cleanup。
Windows CI 将身份清单与启动回滚放入独立串行步骤，连续验证三次，任一次失败即退出；真实 PowerShell 身份查询仍执行，未增加预算或跳过测试。
上述约 2 秒聚合失败尚无完整内层证据，不将其归因为已确认的 PowerShell 生产缺陷。

后续 [25bf3e2 独立验证的 Windows Node 24 日志](https://github.com/Mininglamp-OSS/octo-runtime/actions/runs/39737677158/job/119687121305) 在约 10.22 秒明确报告 cannot identify worker process，cleanup.complete=true，取消尚未执行。
系统身份查询也存在实际失败，不能只修 testcase 或重跑刷绿。
改为直接通过 PowerShell 调用 .NET Process.GetProcessById/StartTime，显式禁用模块自动加载，减少 Get-Process 命令发现和管理模块加载的依赖；保留 10 秒时限、不缓存 PID、仍返回原 windows:UTC-ticks 格式。
该日志确认查询阶段失败；耗时与 10 秒预算吻合，但并未区分 PowerShell 进程启动、命令发现和系统查询各自耗时，不夸大具体耗时位置。
原生 Windows 回归卸载管理模块并禁止自动加载后执行真实查询，要求同一 PID 的身份一致。
API 依据：[Microsoft Process.GetProcessById](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.process.getprocessbyid?view=netframework-4.7.2)、[PowerShell 模块自动加载配置](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_preference_variables?view=powershell-5.1#psmoduleautoloadingpreference)。

PR 第一轮 Windows Node 26 在慢关闭用例缺少一次 logging.close.finished。
fixture 原来在日志 close 之外延迟 800ms，随后真实 RuntimeLogging.close 最多还可等待 1 秒；组合耗时可超出 worker 的排空窗口。
改用已有日志线程慢写入 fixture，将 800ms 纳入真实一秒日志预算；保留关闭时间、两次启动、进程退出及日志内容断言，移除已无调用方的外部延迟参数。

## 本地验证

- Node 24.19.0 和 26.12.1：目标四个测试文件各 16 项通过；完整 Node 测试各 1489 通过、34 跳过；UI 35 项通过。
- typecheck、lint、lint:names、format:check 通过。
- 新登记同步在 Node 24/26 各 4 项启动测试通过；延迟实际 setWorker 5.5 秒的注入探针各通过（含 replacement 共约 11 秒）。失败注入约 150ms 即报告 probe registration failed 和清理事实，没有误报轮询超时。
- 真实 EOF 排空探针在 Node 24/26 约 3.2 秒完成，logging.close.finished 和 fixture.close_tail 均存在；该证据来自 macOS，不替代原生 Windows 验证。
- 最后并行全量回归在 Node 26 复现 Codex ignore-interrupt 用例总时长约 4.48 秒超过 4 秒断言；原计时包含进程启动/握手，而实际收尾从最终答案开始。修正计时边界并保留 4 秒上限，新增原 60ms 配置回执检查。
- 首轮本地验证错误地将 typecheck 的清理构建与测试并行，造成 dist 缺失；该轮受影响测试与 lint 作废，在构建结束后重跑通过。
- OKF lint 命中既有 `已退出的文档目录仍存在: docs`，本次未改变该目录策略。

## 远端阶段记录

`fa2e4a5` 在 [PR CI](https://github.com/Mininglamp-OSS/octo-runtime/actions/runs/39736195213) 与 [同提交独立验证](https://github.com/Mininglamp-OSS/octo-runtime/actions/runs/39736968440) 两轮均全部六矩阵及 CI Gate 通过。
该阶段包含恢复 fixture 与日志预算修复，尚未包含最后的父进程登记同步调整。
最终提交的 CI、审查与合并状态以 [PR #98](https://github.com/Mininglamp-OSS/octo-runtime/pull/98) 为准；本轮不发布 npm 或变更 tag。
