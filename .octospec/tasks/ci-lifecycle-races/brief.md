---
type: Task
title: 跨平台 CI 生命周期竞态修复
description: 修复生命周期测试竞态，并避免 Windows 身份查询依赖命令模块加载。
tags: [testing, ci, recovery]
timestamp: 2026-10-22T00:00:00Z
slug: ci-lifecycle-races
source: self
upstream: https://github.com/Mininglamp-OSS/octo-runtime/actions/runs/39732869529/job/119671741690
---

# 跨平台 CI 生命周期竞态修复

## 目标与边界

基于最新 `main@88fa71d` 新建 worktree，修复阻塞 npm 发行的测试竞态，提交英文 PR 并按已有授权合入 main。
决定权属于工程测试；输入为用户提供的 CI 日志和当前测试合同。不改变产品策略、公共 API、服务拓扑、恢复退避或清理预算，不发布 npm 或修改版本 tag。
后续取证确认 Windows 系统身份查询失败，纳入 Kernel 的资源所有权实现；CLI/SDK 共用查询，保持现有 UTC ticks 清单格式及失败时禁止回收未知 PID 的行为。

## 已确认问题

- macOS Node 26：恢复 fixture 先记录启动，再读取故障文件。父进程读到第五次启动便删除故障文件时，第五个 worker 可能直接就绪，导致预期第六次启动的断言失败。须先固定本次 blocked 结果，再发布记录，保留快速重试次数和两次 15 秒慢重试的验证。
- main 的另一轮 Windows Node 24：启动取消用例等待登记超时，原始 initialize 拒绝被吞掉。现在观察真实 setWorker 完成后再取消，取消 PID 文件及清单的轮询；仍执行系统身份查询和清单写入，并验证清单 PID。原始错误及聚合清理失败完整输出。Windows 将取消和清单测试放入独立串行步骤，连续验证三次，任何一次失败立即退出；保留 10 秒查询、15 秒登记等待和 5 秒清理预算。
- 后续 CI 确认 Windows 曾在取消前约 2 秒发生启动/清理聚合失败，旧日志截断了内层错误；未取得内层原因，不能宣称修复了已确认的生产身份查询缺陷。
- 完整诊断后在 `25bf3e2` 独立 CI 复现 Windows Node 24 在约 10.22 秒报 cannot identify worker process，清理完整，尚未执行取消。这是实际身份查询失败。Windows 查询改为 PowerShell 直接调用 .NET Process.GetProcessById/StartTime，关闭模块自动加载，避免 Get-Process 的命令发现与模块加载；保留 10 秒预算、UTC ticks 格式和未知身份拒绝。添加真实 Windows 禁用管理模块的身份一致性回归。
- Windows Node 26 慢关闭用例曾缺少一次 logging.close.finished：fixture 在日志 close 外等待 800ms 后，再调用自身最多等待 1 秒的真实 close，可能超过排空窗口。改为实际日志线程中延迟写入 800ms，受现有一秒日志预算约束，保留 3.2 秒下界、5 秒上界、尾日志和两次重启断言。
- 本地 Node 26 并行全量回归复现 Codex finalization 用例把子进程启动及握手误计入 4 秒收尾预算。计时改从实际答案事件开始，使用单调时钟，保留原上限并检查原 60ms 配置回执；不改变 Adapter 代码。

## 验收

- 确定性复现 fixture 的通知/故障恢复交错，验证旧顺序失败、新顺序通过。
- Node 24/26 目标用例与完整回归，相关静态检查。
- PR 六平台/版本任务通过后再次验证；合并后核查 main CI。
- 结果与局限写入 journal，保留配置 Git 作者和 Codex trailer。
