---
type: Design
title: 有界 Gateway drain 与 Windows Job 所有权设计
description: 明确关闭状态、取消与投递信号、进程归属、内部 launcher 和失败边界。
tags: [architecture, lifecycle, channel, windows, ipc]
timestamp: 2026-10-20T00:00:00Z
status: planned
---

# 状态与依据

2026-10-20 方案修订：D1–D3 的 Gateway drain 继续实施；下文 Windows Job/broker、原生构建与分发设计已撤回，仅保留历史。公共层严格采用 TypeScript / Node.js，业务 Extra 例外遵守[架构规则](../../rules/architecture.md#实现语言与原生依赖边界)。Windows 回归原 Node spawn/taskkill 机制，不再承诺父先退或强杀后的后代完整回收；旧机制试验通过不计当前产品保证。

以下为原设计记录。现行 API 以实现为准，当前状态见[实施记录](implementation.md)。
公共合同遵循 [架构](../../rules/architecture.md)、[Extra](../../rules/extras.md)、
[生命周期](../../rules/runtime-lifecycle.md)、[本地执行](../../rules/local-execution.md)和
[输出协议](../../rules/output-protocol.md)。现行规则中的已实现描述不在规划阶段提前改写。

## D1 Gateway：把停止接纳与释放资源分开

内部状态使用 `active -> draining -> closed`；`closed` 只在最后的资源释放阶段设置。
进入 draining 必须同步阻止消息、排队任务、卡片 retry 和自动恢复创建新的执行；已在准备中的 loadContexts 取消并等待真实操作按原额度合同结算。

| 内部作用域 | 进入 draining | 真正结束/截止 |
| --- | --- | --- |
| 准入与准备 | 立即拒绝新任务；取消尚未提交的准备；清除重连和重试计时器 | 不得启动迟到 invoke |
| 已接纳执行 | 标记停止意图，通过原 invocation/ref 发 cancel；保留源订阅 | 原流真实 terminal 或 drain 截止 |
| binding 与事件消费 | 消费当前实例、session/generation 的尾事件；沿用原写入规则 | 写入完成后才释放存储；旧代次不得改写新 binding |
| 最终投递 | 沿用既有 projector/finalReply 及幂等键，使用独立存活信号 | 回复尝试完成或 drain 截止；不重新建联 |
| 业务连接与资源 | 保留现有可用连接，只拒绝新工作 | 上述工作结束后关闭；失败仍尝试其他资源 |

`ctx.signal` 的 abort 继续表示 owner 请求停止，不能在入口层推迟或吞掉。Gateway 收到该信号后开始有界 drain，
其 transport/delivery 不再直接共用这个已中止的信号；它们使用插件内部资源信号，在最终释放或截止时 abort。
正在建联的实例收到停止后仍立即取消握手；没有已接纳任务时无须等待投递窗口。
manager.close/remove/upsert、Extra unload、runner stop 和 owner disconnect 必须经过同一条内部关闭路径。
rebase后的binding还包含rulesContext；drain保留其session/generation/revision条件更新，旧任务收尾不能清除较新的规则失效标记，也不能推进未消费的历史游标。

## D2 取消、终态与 iterator

为 ImTask 增加私有停止阶段：禁止后续尝试，向已接纳 Run 发 cancel，但在 drain 期间不提前 abort 正在消费的 invocation signal。
普通调用方显式取消继续沿既有 signal/error 合同执行。Gateway 的 owner stop 不借普通 caller abort 截断尾事件。
`createInputInvoke` 的通用 finally-abort 行为保持不变；不复制一份投影函数绕开它。

ExtraPort 保留原 RunRef 及订阅，close 仍只取消本 Extra 的执行。runner 启动 cancelOwned 与插件 dispose 的有界等待，
不能以执行桥的第二个订阅读到 terminal 代替 Gateway 自身的消费、保存和投递完成。
若 cancelOwned 失败，不提前清空仍需跟踪的 ref 来制造下次成功；断连和 ACCEPTANCE_UNKNOWN 保持 incomplete。

完成/取消竞态采用原源终态：已完成则保持 completed，已取消则保持 cancelled；无 terminal、流失联或清理未确认则报告 unknown/incomplete。
Gateway 可以沿既有业务投影告知“未确认”，不能伪造 Provider 的 run.cancelled/run.completed，也不能重新 invoke 获取一个结论。
draining 期间不再响应新的执行审批或创建重试；原 pending interaction 按取消/终态合同失效。

## D3 共享预算和可观察失败

沿用独立 runner 的 4 秒清理预算与 4.5 秒最终退出兜底，不再为每个 Bot 或每个 disposer 叠加等待。
私有关闭上下文使用单调时钟，以 runner 开始 stop 的 T0 为起点：

| 阶段 | 截止 | 行为 |
| --- | --- | --- |
| 业务 drain | T0 + 3000 ms | 所有 Bot 并发取消、等待本轮尾事件、binding 和最终回复，共享剩余时间 |
| 资源释放 | T0 + 4000 ms | 取消剩余投递，关闭 connector、store-owned handle、日志和端点；单项失败仍发起其他 finalizer |
| runner 兜底 | T0 + 4500 ms | 保留现行最终退出保护；强制退出不能改写 cleanup.complete |
| 平台进程树确认 | 进入强制回收起最多 5000 ms | Windows 等待 Job active process count 为 0；与业务 drain 预算分开记录 |

未接纳的依赖 Promise 仍真实占额。store 仍按既有 borrowed/owned 约定释放；本任务不引入新的宿主存储 API。
drain 内最终投递只使用既有有界重试，所有尝试扣同一剩余时间；不为离线连接新增重连或可靠投递账本。
投递失败不改写执行终态，但本次要求的 final 未确认时不能回报完整业务清理。
内部错误汇入已有 IM_DISPOSE_FAILED / EXTRA_RUN_CLEANUP_INCOMPLETE 和 CleanupResult.errors/pendingResources，公共结构不变。
超时后撤销本实例资源访问，持续观察未决 Promise；迟到操作不能写入替代实例。

## D4 Windows：启动时建立 Job 归属

采用仓库自有、私有的 Windows 原生 broker，按受管资源单元持有独立 Job Object。
选择小型 Go 可执行程序，通过 Win32 调用实现；CGO_ENABLED=0，不依赖外部运行时、node-gyp 或安装期下载。
它不是 Kernel 的替代执行器，也不接触 InvokeInput、业务配置解释或 IM。

每个 Job 设置 KILL_ON_JOB_CLOSE，不设置 BREAKAWAY_OK/SILENT_BREAKAWAY_OK。broker 自身不加入它拥有的 Job。
broker 通过 CreateProcessW(CREATE_SUSPENDED) 创建目标，AssignProcessToJobObject 成功后才 ResumeThread。
关联失败时终止并等待这个尚未运行的目标，启动明确失败；不允许降为普通 spawn/taskkill 后继续报告 ready。
这是消除“先 spawn 再补登记”窗口的必要步骤。嵌套 Job 按 Windows 10/11 的实际层级检验，不能假设任意宿主 Job 都接受嵌套。

每次 Provider 进程拥有独立 Job；共享 Codex/OpenClaw Provider 进程的 Job 归实际连接/进程 owner，
不得因一个 Run 取消而杀掉仍被兄弟 Run 使用的 Provider。Kernel/worker/Extra 的 Job 归对应 owned 组件。
创建记录同时保存 broker PID、真实目标 PID、目标创建时间和持有的 OS handle；PID 数字只用于诊断。
退出或 PID 重用不能改变原句柄的归属，也不能授权打开并终止同数字的新进程。

## D5 私有 launcher、Node IPC 和 owner 消失

新增内部 managed-launch 适配层，调用方保留现有 stdin/stdout/stderr、error/exit/close 与取消行为。
内部返回值分别持有 transportChild（真实 broker ChildProcess）、targetIdentity、目标退出事实和 tree cleanup；
不得改写 ChildProcess.pid 或把 broker 的 exitCode 当成目标退出码。Host status、nativeStatus、worker manifest 和 onSpawn/onChild 的内部消费者逐一改接真实目标身份。
公开导出中若存在 ChildProcess 类型，M0先核对其合同，禁止用类型断言伪装替身；内部重构不能向宿主暴露 broker 或新增必填参数。
目标程序直接继承所需数据句柄，broker 不解析、缓冲或改写 NDJSON；另建本机私有控制 Pipe 交换启动/停止/清树事实。
控制帧上限 4 KiB、最多一个 stop 请求、启动控制就绪最多 5 秒；数据队列继续使用现有背压与容量上限。

Node 控制 IPC 是 M0 必过的实现门：保留 Node 24/libuv 的 CRT stdio 句柄映射、NODE_CHANNEL_FD、fd3、序列化模式与 disconnect 语义。
原型显式核对 STARTUPINFO/STARTUPINFOEX、CRT lpReserved2 映射及句柄白名单；不能假设 Go 的 os/exec 会自动透传 Node IPC。
只传继承白名单；Job、owner process handle、控制 Pipe 服务端均不可被目标继承。broker 启动目标后关闭自己多余的数据/IPC 句柄副本，避免阻止 EOF/disconnect。
不得读取 Node 私有 JS `_handle`，不得把 broker JSON 写到 Provider stdout，也不得改变现有 component.stop 协议。
真实组件 status.pid 仍是目标 PID；内部 cleanup/manifest 同时记录 broker 身份，readiness 不把 broker 存活当成目标就绪。

broker 先建立原始 owner 的私有 Pipe，打开并持有 owner 进程句柄，再发起新生成的 challenge，
要求原始 Pipe 对端在句柄取得后完成响应；同时核对 Pipe 对端进程身份和句柄状态，全部成功后才创建目标。
这一步不能用“握手成功后再 OpenProcess(PID)”替代，否则握手后 owner 退出与 PID 重用仍有窗口。
若响应失败或 owner 已退出则不启动目标；W03在打开句柄前后注入 owner 退出验证此门。
组件 broker 使用 detached，避免 libuv 提前强杀它而跳过 Extra drain：
owner 消失时，Node 目标仍收到原控制 IPC disconnect；broker 给组件现行 4.5 秒宽限，随后终止 Job 并最多确认 5 秒。
Provider broker 在 owner 消失时直接执行受管 Job 清理，不等待模型输出或 JS 事件循环。
broker 自身被强杀时 OS 关闭其唯一 Job handle，触发后代回收；没有活 owner 时不能承诺写回 CleanupResult。

目标 leader 退出后，broker 保存其退出码并终止剩余本 Job 后代，确认 active count 为 0 后才报告树已清空。
显式 stop 先允许已有受控关闭，再在原预算到期时 TerminateJobObject；active count 的查询确认不能仅由通知或 leader exit 替代。
无法查询、拒绝访问、控制失联或截止仍有活动进程，均为 incomplete，禁止替换；taskkill 只可用于已确认归属的故障应急，不能作为成功证明。

## D6 覆盖范围与发行

接线必须覆盖 Host launchNode/native、Kernel spawnWorker、Adapter SDK NDJSON、ACP spawn、Codex app-server、ZCode。
不能只给 Host/worker 设置 processTree=true。外部传入且非本 SDK 创建的共享连接保持 borrowed，不取得杀进程权。
POSIX 继续使用原进程组实现，保留 TERM/KILL 有界确认与故障隔离。

私有源码建议放 `native/windows-process-owner/`，编译为 win32-x64/win32-arm64 两个资源，
存入 adapter-sdk 的 dist/native 下，由现有单包 tgz 携带。开发构建使用固定 Go 1.25.x 与标准库，
交叉编译启用 trimpath、关闭 buildvcs/随机 build id；实际工具链版本与二进制摘要写入构建清单。
pack-release 对资源缺失、摘要不符、架构不符直接失败。构建/打包依赖 Go，消费方和 npm install 无需 Go、管理员或网络。
macOS/Linux 导入不得执行 exe；Windows 启动选择私有平台分支，不给 SDK 使用者增加选项。
干净 Windows 离线安装、真实目标 PID、Node IPC、杀 broker 和父先退必须从最终 tgz 重测。

## D7 约束与协调

#65 的旧 daemon/LocalExtras 改动不能直接照搬；本任务只在最新 host-sdk/独立 runner 路径实施。
若该 PR 或 #66 先合并，逐段核对 Gateway 与共享 Extra 合同后再接线，保留其存储修复，不能恢复已删除包。
WeCom 的同源关闭代码执行回归；仅在共享内部信号/执行桥变更直接影响它时同步修复，不新增其业务回复策略。
公共 API、Run7/Context v3 不因 Windows 变化。Windows 安全软件、受限 Job、通过 WMI/独立服务启动的非后代工作须明确记录；
Job Object 只证明 OS 实际归属的进程集合，不能宣称回收外部服务或任意恶意逃逸进程。

## 官方依据

- [Microsoft Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)：核对 Job 的句柄生命周期、后代关联和回收边界。
- [Microsoft Nested Jobs](https://learn.microsoft.com/en-us/windows/win32/procthread/nested-jobs)：核对嵌套层级和受限宿主场景。
- [Process Creation Flags](https://learn.microsoft.com/en-us/windows/win32/procthread/process-creation-flags)及 [CreateProcessW](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessw)：核对挂起创建、句柄和字符边界。
- [Job accounting](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_accounting_information)：核对活动进程数查询。
- [Node 24.19.0 libuv process](https://github.com/nodejs/node/blob/v24.19.0/deps/uv/src/win/process.c)与 [stdio](https://github.com/nodejs/node/blob/v24.19.0/deps/uv/src/win/process-stdio.c)：核对现有 Job、detached 及 CRT 句柄传递；不能把 Node 自带 Job 当成全部后代保证。

上述文档支持 OS 机制选择；本仓 broker 的透明接线仍须 M0 实证，不能由资料阅读推定已完成。
