---
type: Journal
title: "Issue 303：端点缩短必须保留旧协议互斥"
description: "记录直接 Kernel 地址、旧 owner 兼容租约与安全回滚的可复用约束。"
tags: [runtime, ipc, lifecycle, octospec-learning]
timestamp: 2026-11-04T07:00:00Z
source: self
---

# 端点缩短与旧协议互斥

POSIX Kernel 由 `<home>/sockets/octo-runtime-executor-kernel.sock` 改为
`<home>/executor-kernel.sock`，固定减少 21 UTF-8 字节。Windows 原管道与所有平台
service ID 保持，Extra 控制地址与 Kernel 执行地址分别定义。

只改派生 helper 会让旧地址的活 Kernel 失去互斥。新 Kernel 因而先持有旧版本已识别
的 PID/nonce owner 租约，再取得新端点，并且只监听新地址。旧 socket/旧执行清单/
未知 owner 不是可清理垃圾：保留并要求旧版本先停止或恢复。匹配过渡 marker 的死
owner 可重新取得，不把兼容锁当作执行清理已确认，也不以 PID 退出证明后代消失。

规范地址同样不能仅凭连接失败 unlink；匹配的 Kernel owner、PID 与文件身份检查
共同限制回收。独占创建后的 owner 写入失败也会留下资源，必须按本次文件描述符
身份回滚；回滚失败聚合原拒绝和清理异常，沿服务生命周期报告 incomplete。

故障注入先在重建前产物复现了部分 owner 写入未回滚的问题。Windows 文件租约控制
证据与真实 Named Pipe/RPC 证据分开，不能冒充 Unix bind。全量测试还受原生
PowerShell/计划任务超时与进程内存不足影响，保留每轮退出码与隔离结果。

可复用合同已回写[基础架构](../../rules/architecture.md)。具体实现审查、测试与缺口见
[自查](../../tasks/303-direct-kernel-endpoint/review.md)和
[历史验证](../../tasks/303-direct-kernel-endpoint/validation.md)。#306 已合并到主线，
本次按其实际 Home/预算 API 完成整合，兼容租约按文件系统预算检查，实际直接端点
按 IPC 预算检查；[联合验证](../../tasks/303-direct-kernel-endpoint/joint-validation.md)
记录 Windows 结果。macOS/Linux 真机验证仍未完成。
