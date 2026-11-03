---
type: Journal
title: "Issue 241：可移植异步模拟与真实背压夹具"
description: "缺失 API 要显式模拟异步语义，先证明真实写入受阻再验证超时及清理。"
tags: [octospec-learning, testing, ipc, windows, python]
timestamp: 2026-11-03T09:54:06Z
source: self
---

# 改变与证据

仅修改 Python transport 测试和工程记录，生产 SDK 不变。当前 main 的 Windows Python 3.11.9 基线六方法中两个报错、三条 error；只加 AsyncMock 后仍有两条超时。修复后的两 Python 版本全单元与各 42 项真实 Kernel/fake Provider native 回归通过；完整命令、失败归属与未验平台见[验证](../../tasks/241-portable-python-transport/validation.md)。

# 可复用结论

- patch(create=True) 无法从缺失属性推断 async；跨平台缺失 API 的测试必须显式选择 AsyncMock，并继续检查 await 次数/参数。
- “应用不读”不保证“发送处于背压”。Windows 的重叠写可先复制入内核而立即完成；须验证真实 drain 未完成、实际发送缓冲非零。测试夹具可以显式控制其所属 socket 缓冲，不能让生产 SDK 适配错误 Mock。
- 大请求同步校验/编码与 IO 属不同阶段，IO 清理预算从真实传输入口开始；事件同步并取回提前失败比只轮询状态能保留根因。不能靠增大等待掩盖夹具未建立目标条件。
- 所有 RPC/事件任务在测试结束前取回，双方 socket 关闭确认；模拟 Unix 选择与 Windows 真机 pipe 互操作分别记录，不推断未运行平台。

# 规则影响

现有 engineering 的合同事件计时、真实前提、失败事实与资源所有权要求已覆盖本案原则；不扩展规则索引、CI 或默认测试范围。
