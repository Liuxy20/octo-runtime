---
type: Journal
title: 独立组件启动取消与回滚复核
description: PR 61 启动阶段 owner 退出、清理事实保留和同类竞态的修复与验证。
tags: [lifecycle, kernel, extra, testing]
timestamp: 2026-10-20T00:00:00Z
---

# 修复合同

启动属于 owned 生命周期。父断连或 stop 必须在配置读取前被观察，并在异步资源取得后检查取消，避免迟到的 worker 或 endpoint。Kernel 启动失败沿用 teardown 回收 worker、manifest 与端点；Extra 初始化与关闭共享 barrier 和清理截止，超时不能确认资源已回收。

启动失败通过公开 `ComponentStartError` 保留原始 cause 和 `cleanup`。即使进程退出，disposer 或宿主依赖 Promise 未完成仍保留失败所有权，禁止同名替换。Kernel 重启失败后的 stop 返回新实例的失败事实；native readiness 要求 status PID 与新子进程一致。

Extra 的独立清理步骤各自尝试，Kernel client 或日志关闭失败不能丢失资源记录；全部成功后才释放控制端点租约。设计中的 stdin-json 停止消息对齐为 `component.stop`。

# 本地证据

- macOS arm64 / Node 24.19.0：新增 20 项回归覆盖启动中 owner 退出、主动取消、迟到配置/导入/租约、初始化及日志等清理失败、宿主未完成依赖、替换实例失败和 native PID。
- 全量 Node 1275 项：1265 通过、10 条件跳过、0 失败；WebUI 35 项通过。
- workspace 构建、根严格 TypeScript、ESLint、命名、Prettier、知识结构/本地链接检查及 diff 空白检查通过。
- 包外离线安装、公开类型、owned Kernel、独立 Extra、CLI Kernel、卸载保留 Home 均通过。本地构建保留 dirty 来源标记，未声称已发布。
- Windows CI 新增三个启动测试文件；远端结果以 PR #61 对应提交检查为准。本轮未安装系统服务、调用真实模型或发送 IM 消息。
- 首次远端验证中 Linux/macOS 完整通过，Windows 触发 `onSpawn` 结束时已经取消的 readiness 分支。该分支原先未观察已创建的 `client.list()` Promise，回滚中的 client.close 会导致未处理拒绝并提前中断清理；新增本地确定性测试先失败后通过，修复为取消分支也观察该 Promise。另一个 Windows 启动身份超时保留诊断，等待后续 CI 核实。
- 自主回滚 ACK 与 stop 发送关闭竞态曾误报 incomplete；等待进程 close 排空 IPC 后再判断 ACK，发送错误不覆盖已确认的资源回收事实，其他清理错误继续保留。新增确定性 IPC 发送失败回归。
- Windows 诊断发现父进程退出时 Kernel 被直接终止，未执行 disconnect/exit handler。[Node/libuv 的非 detached 子进程 Job](https://github.com/nodejs/node/blob/v24.19.0/deps/uv/src/win/process.c#L65-L80) 会在父进程退出时强杀成员。SDK 的 Node 组件现在统一 detached，并隐藏 Windows 窗口，使 IPC owner 断连回滚有机会完成；Kernel 到 Windows worker 的 Job 关系保留。

完整功能待验范围继续见[实施记录](../../tasks/executor-kernel-host-lifecycle/implementation.md)。

# owner 退出后的最终期限

后续远端 P1 指出：清理 Promise 的截止不等于进程退出期限。真实 SDK owner 退出后，永不完成的 initializer/disposer 持有 interval，runner 在 4 秒后仍会存活。单独 process.exit 也会留下 POSIX 普通子进程；正常 dispose 配合 unref 子进程还会使未引用的回收定时器来不及执行。

runner 从 stop 开始设置 4.5 秒最终退出兜底。主动关闭自己的 IPC 与真正失去 owner 分开判断，实际 owner 断连时必须引用定时器；POSIX 仅回收以自身 PID 为组号的独立进程组。失败仍报告 incomplete 并保留租约。内部定时器要求事件循环可调度，不能覆盖同步死循环与 owner 同时消失；该组合需要独立 supervisor。

Kernel 同类修复：manifest.close 或 endpoint 删除失败后继续尝试其他清理，但保留端点租约，不用 worker 已退出代替整体清理成功。

新增 6 条回归覆盖三个真实 owner 退出场景（挂起初始化、挂起 dispose、unref 后代）、活 owner 下强制回收的失败所有权，以及 Kernel 两种删除失败。全量 Node 1281 项：1271 通过、10 跳过；WebUI 35/35，构建、类型、ESLint、命名、格式、知识链接和最终 tgz 离线验证通过。旧 `2ca7a95` 三平台 CI 通过不证明这些此前缺失的故障场景；当前提交远端结果另以 PR 检查为准。
