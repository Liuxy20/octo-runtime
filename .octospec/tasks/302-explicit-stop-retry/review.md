---
type: Review
title: Issue 302：显式 Stop 修复自查
description: 核对取消尝试、原观察、内部排空、并发和范围边界。
tags: [kernel, cancellation, review]
timestamp: 2026-11-04T00:00:00Z
---

# 承重路径检查

- 仅公开 `cancelInvocation` 为新显式意图开启重试；只有上一尝试失败后才允许新控制。`requested` 在建新 Promise 前设置，并发调用继续共享该次尝试。
- drain、signal 以及接纳 ACK 接续使用默认内部调用，继续复用当前结果；没有自动重试或重新 invoke。
- `cancelTask` 保存当前控制尝试，`firstCancelTask` 锁定原 invoke 观察结果。原控制 Promise、原错误对象与真实尾事件不因后续 Stop 成功而被替换。
- 新尝试使用原登记的 RunRef 和本次显式 reason；不重新选择执行身份、Provider 或会话。
- 取消并发上限、排空共享绝对期限、控制终态分别判断，原队列与 controller 清理结构保持。
- 确认真终态后停止对已退役记录发控制；执行结果未知仍拒绝，不以 ACK 或客户端存活伪造成功。
- 每项登记最多增加一个首次 Promise 引用，不保存无限次尝试历史，随原记录生命周期释放。

# 验证与范围检查

两版 Node 的修复前专项均有3项预期失败，覆盖登记层与真实 IPC 的丢请求/丢 ACK；其余4项保护行为通过。修复后增加自然完成竞争场景，专项及相关 Kernel 文件均39/39通过。执行详情与全量、静态检查最终结果见 [validation](validation.md)。

新增专项仅在 `test/manual/`；没有修改 GitHub workflow、job、matrix、触发器、默认选择器或 Gate。没有改变公开 KernelClient 签名、wire、Provider 适配、Home 或配置。

这是本地自查，未执行真实 IM Stop UI、真实 Provider 或其他操作系统验收，不作为外部 reviewer approval。
