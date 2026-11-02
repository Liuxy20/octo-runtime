---
type: Review
title: "Issue 236：修复自审"
description: "核对原生 spawn 失败终态、真实清理失败、所有权与范围。"
tags: [adapter, lifecycle, review]
timestamp: 2026-11-02T09:00:00Z
---

# 结论

修复位于最先违反合同的 ACP 事件生产方。rebase 至 `f06546e9` 后保留 main 的原生 Adapter 装配，不恢复已删除的 worker；本 PR 不修改 Core/Kernel 生命周期、协议、公共签名、依赖、锁文件或默认测试入口。新增专项仅显式执行；没有 workflow/job/matrix/Gate 扩大。此为本地自审，未请求独立代理或托管 review。

## 关键路径

1. **改变什么**：原生 Error 同时具有字符串 code 和 `spawn ` syscall，且传输 finally 的 close 成功时，ACP 输出原 errno/message 的唯一失败终态。Core 正常耗尽、验证 return 后释放 owner；原生 Kernel close 确认端点、租约及 owner 清单回收。Provider 子进程仍归 Adapter 清理。
2. **可能影响谁**：使用共享 ACP 工厂的缺失命令、无效 cwd、原生启动权限等失败路径。直接消费 Adapter 的调用方改为收到 canonical 失败终态；公开类型、参数、导出与上层失败分类不变。AcpInvocationError 及非 spawn 结构化错误原对象保留，不扩展为任意异常已清理的通用证明。
3. **凭什么确认**：历史 worker 基线与当前原生 Kernel 的结果分别写入 validation。迁移后的专项覆盖真实 ENOENT、close 未完成时不提前发布失败、close 拒绝仍保留 Core owner、其他结构化错误对象不变、真实失败 spawn 的 close/管道确认，以及原生 owner 清单/endpoint/lease 释放与同 endpoint 重新初始化；不再断言不存在的 worker PID 或 drain 消息。

## 失败边界核对

- 判断处在 `await client.close()` 之后；reject 会直接越过该分支，不能转为清理成功。
- 不改变 Core 的 `nextFailed` 防护，拒绝或未确认的 finalizer 继续 incomplete；不重试已经失败的生成器 return。
- errno/message 经现有 Core 归一化和脱敏；缺 cwd 与缺命令仍由共享 workdir 检查区别分类。
- 保留 main 原 ACP 文件的并行、后续调用和 execution_ready 断言，超时不变；将其为未修复缺陷保留的 close 拒绝预期改成要求 ServiceCleanupResult 完整，并继续通过原宿主 disposer 验证目录收尾。
- 真实 Provider、IM、Windows 10、macOS/Linux、Electron 与发行包实机未执行，不以 fake Provider 或当前 Windows 结果代替。
- #237 与 CodeBuddy 的剩余失败分别记录在 validation；不得称全仓通过或关闭 Windows 总验收 #14。
