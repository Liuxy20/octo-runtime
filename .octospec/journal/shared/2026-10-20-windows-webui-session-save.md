---
type: Journal
title: Windows WebUI 会话保存修复验收
description: Issue 39 的文件替换恢复、所属临时文件清理及回归验证。
tags: [webui, windows, storage, testing]
timestamp: 2026-10-22T00:00:00Z
source: self
---

# Windows WebUI 会话保存修复验收

## 已确认问题与实现
Windows 的自然 rename EPERM 会使顺序创建会话返回 500。原路径还会在临时写入或替换失败后遗留本次文件。修复使用独占 open 确定所有权，写入并成功关闭后才替换；失败时尝试清理所属临时文件，保留主错误。句柄未释放或文件系统持续拒绝时，清理也可能失败，此时记录次级诊断。

仅 Windows 的 rename EPERM 使用有界重试，同一串行任务沿用同一临时文件，不重新执行业务回调。退避为 20/50/100/200/400/800/1600 ms，最多 8 次替换、3170 ms 累计等待；这不是包含文件系统调用与事件循环调度的接口硬超时。耗尽或遇到其他错误返回最后一次原生异常。rename 成功即提交内存，之后没有可能反转结果的日志或清理动作。

预算依据来自同机实验：170 ms 候选仍会耗尽，较长拒绝在约 1.63 秒后恢复。此前 20 轮完整 HTTP 流程全部通过，其中 7 轮观察到共 26 次替换调用 EPERM，均由生产代码恢复。具体占用者未归因；不从错误码推断外部程序。

## 原生 Windows 对照
Windows 11 Enterprise 22621 x64、普通用户、Node 24.22.0、pnpm 11.19.0。使用隔离工作树及 checkout 外的测试数据，自动化采用本地 fixture。对照基线 318b0f2，构建标识 dirty=true，buildTime=2026-10-21T11:16:03.987Z。

| 对照 | 实际结果 |
| --- | --- |
| 原始存储和原始 HTTP 用例 | 创建返回 500；捕获 EPERM、errno=-4048、syscall=rename，源为本次 UUID 临时文件，目标 sessions.json |
| 修复后存储和同一原始用例 | 6 次真实 EPERM 均由生产代码恢复；保存后到达原始 POSIX mode 断言，Windows 报 438 != 384 |
| 修复后的完整功能与存储回归 | 创建、淘汰、更新、冲突、重载、删除、失败保持及恢复全部通过 |

观察器仅记录并重新抛出异常，不附加重试。受控 Windows 句柄测试验证文件系统实际拒绝和释放后的恢复，不将受控占用者当作自然故障的原始占用者。POSIX mode 检查独立运行；Windows 跳过该检查不构成 ACL 验证。

## 确定性回归
- 部分写入失败、关闭失败、写入与关闭同时失败、替换失败及清理失败，保留主错误，检查磁盘字节、内存、revision 和恢复。
- 独占创建失败不删除其他所有者文件；首次创建失败后仍可正常创建；未释放句柄及抛错诊断不覆盖保存错误。
- 瞬态 EPERM 在同一队列任务重试，同一临时路径及一次业务回调；持续 EPERM、错误转为 EACCES、其他错误与非 Windows 分支检查边界及最后错误对象。
- HTTP 满容量创建/淘汰、更新、单删、清空失败时，保留最后成功状态；故障解除后的保存不夹带失败变更。
- 重载核对 title、revision、messages、providerSession；删除及清空后再次重载，不恢复已删会话。

## 验证结果
在提交基线 3b34415 上运行完整构建及类型检查、pnpm lint、lint:names、本次四文件 Prettier 和 git diff --check，均通过。以下回归为 25 项，24 通过、1 个 POSIX 检查跳过、0 失败：

~~~text
node --test test/webui-session-store.test.js test/webui-extra.test.js test/runtime-logging.test.js
~~~

公共 SDK 导出、接口、配置 Schema 和 JSON version=1 无本次差异。跨平台完整矩阵由 PR CI 验证，未将 Windows 平台模拟当作 Linux/macOS 实测。
