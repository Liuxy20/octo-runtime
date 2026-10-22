---
type: Journal
title: Worker 心跳集成测试超时修复验证
description: 记录发行 CI 的失败证据、测试预算修正与实际验证结果。
tags: [testing, ci, recovery]
timestamp: 2026-10-22T00:00:00Z
source: self
---

# Worker 心跳集成测试超时修复验证

## 失败证据

[发行 CI](https://github.com/Mininglamp-OSS/octo-runtime/actions/runs/39728349001/job/119657454399) 的 Ubuntu / Node 26.12.1 在 `test/kernel-worker-supervision.test.js:41` 等待替代 worker 就绪超时。
Node 共 1522 项，1487 通过、1 失败、34 跳过；其他五个矩阵环境通过，同一提交的 main CI 也通过。
错误仅说明未在用例的 7 秒窗口内完成替换，不能据此断定 Node 26 兼容性故障或实际恢复失败。
修改前本地 Node 24 单跑通过，体现该问题对调度和计时敏感。

## 实施

测试分别验证故障检测和新进程就绪，保留精确时钟的心跳截止回归，并新增旧 PID 回收与新进程 RPC 断言。
不修改生产代码，不删除用例、不增加失败重试、不跳过 Node 26。
类似测试应分别验证协议截止、资源回收及启动就绪，不能把一个阶段的预算直接作为所有阶段的总预算。

## Windows 启动取消竞态

[PR CI 的 Windows / Node 24](https://github.com/Mininglamp-OSS/octo-runtime/actions/runs/39730036253/job/119663145536) 在 `component-startup.test.js` 的完整回滚断言再次失败，用例耗时约 5.15 秒；更早的 main CI `39696795979` 也有同类失败。
`spawnWorker` 在等待 readiness 前先执行 `onSpawn`，登记过程在 Windows 调用最长 10 秒的 PowerShell 身份查询。
原测试在子进程写出 PID 后立即取消，不能确认父进程登记完成；服务的 5 秒共享清理截止可以先到，此时 `cleanup.complete=false` 是允许且必须保留的事实。
本用例改为等待原子清单里的 worker PID 与子进程 PID 匹配，验证登记完成后的启动取消；没有改变清理期限或接受 incomplete 为成功，也没有删除回收、删除清单及重新启动的断言。
专用 fixture 持续保持未就绪直到取消，移除原来的 10 秒自动就绪 timer，避免慢身份登记后又与 fixture 启动争抢先后。
原始心跳用例在这次 Ubuntu / Node 24/26 及 macOS / Node 24/26 检查中均已通过。

## 验证

- 初步本地 Node 24.19.0：目标两文件 10 通过；完整 Node 测试 1489 通过、34 跳过，UI 35 通过。
- 独立 worktree 的 Node 24.19.0 与 Node 26.12.1 同时运行完整 Node 测试，各 1489 通过、34 跳过；Node 24 的 UI 35 通过。
- 同时使用 Node 26.12.1 顺序重复目标用例三次，全部通过；三次用例耗时约 11.8 秒，其中约 5.5 秒为空闲健康等待。
- 两个测试文件的 Prettier 检查与 `git diff --check` 通过。
- Windows 竞态修正后，Node 24/26 的启动取消测试各 4 项通过；使用临时 preload 为每次非空 PID 登记注入 5500 ms 延迟，两版本的目标用例仍通过（含替代实例登记，总耗时约 11 秒）。该验证模拟登记慢于清理截止，不替代真实 Windows 验证。
- 远端跨平台 CI 结果以对应 PR 检查为准，不将本机 macOS 结果视为 Linux/Windows 实测。

用户要求提交 PR 并合入 main；本次不移动或重新创建已存在的 v1.1.1 tag，不触发发行发布。
