---
type: Journal
title: Issue 233 独立 Kernel 依赖与恢复测试回收
description: 第二版独立进程装配与 RPC 独立性、超时回收和错误聚合验证通过。
tags: [testing, lifecycle]
---

# 当前结果

交付更新：用户已授权更新最新 main、提交推送和创建 PR。rebase 到 `42102c60`，实现提交 `8baba8d2`；仅日志文本冲突，双方记录完整保留。新基线构建/类型/lint/命名/格式/知识检查通过，恢复 2/2、手动 12/12、相关回归 22/22 复跑通过，两轴复审各 0 发现。详细最新 PID 与观察限制见[验证记录](../../tasks/233-recovery-teardown/validation.md#最新-main-复验与-pr-准备)。后续文档提交仅记录证据，不改变已测测试代码；托管检查结果另行记录。

2026-11-01 第二版实施：外层 fixture 拥有 Kernel 与 Gateway 的独立进程，SDK Gateway 宿主只构造 Gateway、借用 endpoint。Gateway 先关闭；手动独立客户端确认无关在途完成、新 RPC 成功且 Kernel 原 PID/实例不变，再由外层关闭 Kernel。

普通恢复 2/2、手动专项 12/12、已有日志/SDK 生命周期 22/22 通过；真实暂停宽限 7002/7003 ms，子测试保留 timeout 与原始失败，K/G/两代 worker/测试进程全部在兜底前退出。原生宿主使用跨平台 IPC close，发送和退出共用预算，进程退出与管道关闭分别确认。详细 PID、版本及命令见[当前验证](../../tasks/233-recovery-teardown/validation.md)。

SDK 仅将明确观测 lost 的 runs incomplete 作为预期诊断，不放行其他资源失败；恢复宿主默认不创建文件日志线程，通过原有状态白名单捕获 Gateway 日志回调。CLI lost 后聚合 exitCode=5 保留，但不据此声称日志完整。既有日志专项另行通过，未改生产 close 合同。

基线 `7fd022cd725030317feee75d27621fa6b4d996e6` + dirty，分支 `fix/233-recovery-teardown`；未扩大 CI、未提交或推送。以下为首轮历史过程。

2026-11-01 后续：用户要求 Kernel 作为 Gateway 测试的外部依赖。已同步最新 `main@7fd022cd`，重写[规格](../../tasks/233-recovery-teardown/brief.md)，明确 Gateway 入口只使用 endpoint、外层独立管理 Kernel、Gateway 关闭后先验证 Kernel 可服务再收尾。此轮只写规格，旧实现保留待调整；下文是首轮历史结果，不代表新版已通过。旧版规格见[存档](../../tasks/233-recovery-teardown/brief-v1.md)。

Gateway 超过 7 秒关闭期限后，强杀并确认退出，再继续关闭 Kernel；原测试失败与关闭错误聚合保留。手动专项最终 7/7 通过，含两次真实暂停 Gateway 的注入；普通 CLI 通过，SDK 因 lost Run 导致既有 close.complete:false，整体规格验收未通过。

实现位于 `fix/233-recovery-teardown`，基线 `0bcd89c528018ffd508ca8099c8ac9c6b88de35d`，当前未提交。范围仅测试/测试支持与记录，无生产包、CI 或默认专项执行变更。

双轴审查发现的兜底漏进程、错误覆盖和覆盖缺口已修复。具体命令、PID 退出证据及尚待用户决定的 SDK 验收方式见[验证记录](../../tasks/233-recovery-teardown/validation.md)。不能将普通 close 的 Promise fulfilled 当作 complete，也不能为测试通过清除 lost 的结果未知事实。
