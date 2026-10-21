---
type: Task
title: Windows Host 正常关闭日志排空
description: 修复 Windows Host 正常关闭抢先终止进程而丢失日志的问题，保持公共 SDK 兼容。
tags: [windows, runtime, logging, lifecycle]
timestamp: 2026-10-21T04:53:00Z
slug: windows-host-log-close
source: self
upstream: https://github.com/Mininglamp-OSS/octo-runtime/issues/38
---

# Windows Host 正常关闭日志排空

## 问题与目标

[Issue #38](https://github.com/Mininglamp-OSS/octo-runtime/issues/38) 的 F31 场景在 fake invocation 完成、Host close 返回后读取日志目录时得到 ENOENT。Windows 直接终止 worker，使既有 shutdown → logging.close 无法完成。正常关闭应提供有界排空机会，健康回归要求记录完整；日志 Worker 超时、写入失败及容量限制仍沿既有可丢弃语义。

## 责任与范围

- 平台关闭行为归 Kernel 内部。公共 SDK 方法、参数、返回类型、导出及调用方职责保持不变；调用方继续使用原 close。
- Windows 正常关闭先监听再发送 EOF，继续消费输出，缓存完整关闭 Promise。worker 复用既有 shutdown/logging.close，通过私有 IPC 报告排空结果并保留 leader，由 launcher 回收所属进程树。
- 关闭沿 service → server → supervisor → worker 传递同一个截止时间。服务仍为 5 秒；server 为清单和端点收尾留出 200 ms。未收到 worker.stopping 时为树回收预留 1900 ms；收到该私有进度通知后，排空等待可延长至“关闭起点 + 4 秒”与“worker 截止时间 - 1000 ms”的较早值。通知不表示清理完成，也不重置截止时间。通常 SDK 路径分别在约 2.9/3.8 秒进入 fallback，覆盖合作关闭的 2.5 秒 shutdown 与 1 秒日志等待。taskkill 命令和最多 200 ms 的退出确认共用剩余截止时间。
- Kernel 私有 Windows 清理分支保留 taskkill 的真实失败；排空通知后 leader 提前退出，也不能将无法识别进程树的命令错误改报成功。执行器报告 incomplete 仍向调用方传播。管道在 finally 释放。
- 心跳失联的活 worker 直接回收，替代实例只在清理成功后启动。启动失败回滚、已退出/损坏输入分支和 POSIX 沿既有共享清理路径。
- 修改仅涉及 Kernel 关闭链路、对应测试和现有 Windows CI。Host SDK、Provider、CLI、共享 Adapter 清理接口及日志持久化语义保持原样。

## 关键合同

所有权属于当前 Kernel；只终止本次 worker 的进程树。请求回执、执行终态、排空通知和资源回收分别验证。真实失败不被吞掉，不用清除 Home 或身份恢复。关闭失败继续保留原错误和必要清单。正常关闭成功后可用同一配置重新构造服务。

## 验收

接近上限的回归使用 2490 ms 执行器关闭延迟与真实日志线程内 950 ms 的最后一条写入延迟；taskkill 建模为立即成功，防止命令自身的启动耗时掩盖提前截断。必须读到尾记录，并分别保留 complete/incomplete 结果。已开始 shutdown 但随后卡住的 worker 仍需在共享预算内回收。

| 场景 | 必须保留的断言 |
| --- | --- |
| 原 F31 enabled/disabled 与目录故障 | 不加 pre-close sleep；健康记录完整、禁用不创建目录、隐私断言保留 |
| 立即、完成后、重复与并发 close | 真实 Windows worker 退出；同一个 close Promise；日志排空先于树回收 |
| 健康慢关闭 | 2400 ms shutdown + 800 ms logging fixture，两轮 SDK close 均小于 5 秒，日志完整、worker 退出、清单删除且可重建 |
| 接近完整排空预算 | 2490 ms shutdown + 950 ms 真实日志写入；尾记录完整，健康关闭成功，执行器 incomplete 继续失败 |
| 响应后卡住 | 真实 worker 已报告开始 shutdown，但迟迟不完成；仍在 5 秒内走现有 fallback 回收 |
| 不合作 EOF | 有界 fallback，worker 实际退出；SDK 小于 5 秒且可重建 |
| 前序关闭和慢回收组合 | 真实服务/worker，socket 关闭回调延迟 300 ms，taskkill 建模为 1500 ms 后成功；5 秒内返回成功时 worker 已退出、清单删除且可重建 |
| 回收命令超时 | 真实不退出子进程替代本次 taskkill；命令在服务返回前结束，返回失败、worker 仍存活、清单保留；测试单独回收 fixture |
| 通知后的退出窗口 | 真实 worker 发 drained 后退出，延迟执行真实 taskkill；detached 后代残留时 close 必须拒绝 |
| 故障恢复 | 真实心跳失联后不等待正常排空宽限，先回收旧 worker 再启动新代次 |
| 失败与隔离 | 执行器 incomplete、taskkill 失败、启动回滚、独立 Host、合作 Provider 工具及 detached 工具断言保留 |
| 自动化覆盖 | 专项和原 F31 接入现有 Windows CI；类型、lint、命名、格式及相关生命周期检查 |

原生环境为 Windows 11 10.0.22621、Node 24.22.0、pnpm 11.19.0；只使用 fake Provider。真实 taskkill 与延迟模型的证据分别标注。验证结果见[记录](../../journal/shared/2026-10-20-windows-host-log-close.md)。

适用合同：[本地执行](../../rules/local-execution.md)、[日志](../../rules/stateless-execution.md)、[生命周期](../../rules/runtime-lifecycle.md)、[架构](../../rules/architecture.md)与[工程验证](../../rules/engineering.md)。
