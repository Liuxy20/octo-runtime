---
type: Review
title: "Issue 236：修复自审"
description: "核对原生 spawn 失败终态、真实清理失败、所有权与范围。"
tags: [adapter, lifecycle, review]
timestamp: 2026-11-02T09:00:00Z
---

# 结论

修复位于最先违反合同的 ACP 事件生产方。Core、Kernel、worker 清理、协议、公共签名、依赖、锁文件和默认测试入口均不变。新增专项仅显式执行；没有 workflow/job/matrix/Gate 扩大。此为本地自审，未请求独立代理或托管 review。

## 关键路径

1. **改变什么**：原生 Error 同时具有字符串 code 和 `spawn ` syscall，且传输 finally 的 close 成功时，ACP 输出原 errno/message 的唯一失败终态。Core 正常耗尽、验证 return 后释放 owner；worker 正常报告 complete，launcher 仍执行所属进程树清理。
2. **可能影响谁**：使用共享 ACP 工厂的缺失命令、无效 cwd、原生启动权限等失败路径。直接消费 Adapter 的调用方改为收到 canonical 失败终态；公开类型、参数、导出与上层失败分类不变。AcpInvocationError 及非 spawn 结构化错误原对象保留，不扩展为任意异常已清理的通用证明。
3. **凭什么确认**：两版 Node 原 #236 完整文件各三轮通过；新增专项覆盖真实 ENOENT、close 未完成时不提前发布失败、close 拒绝仍保留 Core owner、其他结构化错误对象不变，以及真实 worker drain/PID/管道和 Kernel manifest/endpoint/lease 释放与重新初始化。

## 失败边界核对

- 判断处在 `await client.close()` 之后；reject 会直接越过该分支，不能转为清理成功。
- 不改变 Core 的 `nextFailed` 防护，拒绝或未确认的 finalizer 继续 incomplete；不重试已经失败的生成器 return。
- errno/message 经现有 Core 归一化和脱敏；缺 cwd 与缺命令仍由共享 workdir 检查区别分类。
- 原 #236 的并行、后续调用和 worker 存活断言未修改，原测试超时未扩大。
- 真实 Provider、IM、Windows 10、macOS/Linux、Electron 与发行包实机未执行，不以 fake Provider 或当前 Windows 结果代替。
- #237 与 CodeBuddy 的剩余失败分别记录在 validation；不得称全仓通过或关闭 Windows 总验收 #14。
