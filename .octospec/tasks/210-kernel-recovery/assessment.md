---
type: Assessment
title: Issue 210 排查结果与建议
timestamp: 2026-10-27T00:00:00Z
---

# 排查结果与建议

本文保留 main 基线的排查与受控复现证据；后续修复方案见 [design.md](design.md)，
当前实施与验收范围见 [brief.md](brief.md)。以下“当前”均指排查时的 main 基线。

## `exhausted` 的真实含义

`WorkerSupervisor.#failed` 关闭心跳、把 worker RPC 标为失联后调用 `#recover`。
恢复先回收旧 worker，再清除 manifest 的 worker 记录，之后才进入启动替代 worker 的循环。
前两步任一步失败，外层 catch 保存异常并设为 `exhausted`，随后没有 timer 或其他恢复入口。

因此 `generation=1 / restart_attempt=0` 可以表示第一次替换根本还没有开始。
它不是快速三次重试次数耗尽；后者已经实现每 15 秒继续恢复，状态为 `recovering`。
这与用户观察的持续 30 分钟失败相符，但模拟不能确定原事故是哪一步失败。

## “确认所有权”的具体意思

这里不涉及账号、登录、Bot 登记或云端所有权。准确的问题是：旧执行进程是否已停止，
能否安全启动替代 worker。拓扑为 Kernel → worker / AgentExecutor → Codex Adapter →
Codex app-server → 工具进程。Kernel 直接监督 worker；Adapter 负责 app-server 的正常
启动、取消和回收。正常关闭可以运行 finally；强杀 worker 时不能假定 finally 仍会执行。

POSIX 上 Codex app-server 使用独立进程组，所以 worker 进程组回收成功不是全部 Codex
工具回收成功的充分证据。当前协议 fixture 在 stdin 断开后退出，实测没有留下该 app-server；
真实 Codex 与工具后代在强杀场景的回收仍需单独验证，不能宣称已经发现真实 Codex 残留。
这些资源应由 Runtime 管理，不应成为用户手工恢复的常规负担。

## 五个复现场景

环境为 macOS / Node.js 24.19.0；全部经过真实 Kernel IPC、独立 worker 和真实 Codex
Adapter，外部 Codex app-server 用无网络 Node 协议 fixture 代替。

| 场景 | 实际结果 |
| --- | --- |
| app-server 提前 EOF | 本次 run.failed，共享 worker 保持 ready，新请求成功 |
| 空闲 worker 被 SIGKILL | 相同 Kernel instance，generation=2 / restart_attempt=1，新请求成功 |
| Codex 执行中 worker 被 SIGKILL | 原请求 RUN_OUTCOME_UNKNOWN，fixture 随 stdin EOF 退出，新 worker 可执行新请求 |
| 所属 worker 组存活探测注入 EPERM | 清理超时，generation=1 / exhausted / restart_attempt=0 |
| 清除 worker manifest 时注入 EIO | 同样进入 generation=1 / exhausted / restart_attempt=0 |

后两项均在撤销故障注入、确认旧 worker PID 已消失后，再等待 1.1 秒，状态仍不恢复。
源码确认此分支没有后续重试；没有让测试真实空等 30 分钟。磁盘保留旧 worker 身份且
invocations 为空；status 不含故障来源。Kernel 明确返回 WORKER_RESTART_EXHAUSTED，
客户端未生成可信未提交证明，Gateway 的真实 ImTask 将这次尝试记为 unknown。
本阶段未运行真实 IM 卡片展示，不能把 ImTask 检查写成完整渠道端到端验收。

## 建议的修复范围

1. **恢复机制首先修复。** 将资源清理失败、身份检查失败、manifest 持久化失败分别处理。
   暂态错误短间隔重新检查并尝试安全清理，确认旧执行停止后立即拉起 worker；不能把一次
   清理超时当作永久停止恢复的理由。严重权限或不可验证身份持续阻塞时也要继续暴露原因。
2. **明确时间目标。** 用户要求快速恢复新请求，持续 30 分钟不可用不符合目标。建议暂态
   清理重试先采用 1/2/5 秒间隔，之后保持有上限的间隔；精确策略尚待实现设计。
   已退出故障无需等待心跳检测；卡死检测和 worker 就绪有独立预算，不能把退避时间直接
   当作恢复总耗时或承诺所有故障几秒可恢复。验收应测故障发现至新请求执行成功的时间。
3. **先处理 Promise 的失败缓存。** worker.close/createProcessCleanup 缓存首次清理
   Promise，manifest 写队列也会被一次失败打断。直接给现有 close 外围加重试循环不会
   重新确认资源，必须设计可以重新观测、重新清理和恢复写入的真实机制，仍保留历史失败。
4. **日志与公开诊断同步补齐。** 提供 CLI `octo-runtime executor-kernel logs`，沿用
   Extra 的 lines/follow/NDJSON 习惯，但读取 Kernel 自身独立的状态日志。日志由 Kernel
   父进程记录 worker 退出、signal/exit code、恢复阶段、清理错误码、代次、重试和就绪。
   不能只依赖 worker 内部执行日志，否则 worker 退出时最关键的原因仍可能丢失。
   status 暴露阻塞阶段、最近原因、下次重试与恢复建议；具体字段和 schema 尚未变更。
5. **正确反馈未执行。** 在 Kernel 实际准入边界证明明确拒绝，经公共客户端可靠传回
   Gateway；这次请求展示执行服务暂不可用。不得由 Channel 按错误名字猜测，也不能将
   提交 ACK 丢失、已经接纳后断流等情况降格为未提交。旧请求不自动重放。

原则是快速恢复新请求，同时保留旧请求的真实结果；不让 Gateway 重启共享 Kernel，
不引入第二套执行服务，不用重置 Home、配置或运行身份规避故障。

## 验证与边界

`pnpm build` 通过；复现脚本 5 项通过，零失败、零跳过。第一次脚本编写时修正了
fixture 默认复用 Run ID 和 modelInput 的问题，最终运行均使用独立请求身份。
本阶段没有真实模型、IM 网络、部署修改、提交或推送。复现的是当前状态机缺陷和错误反馈
路径，不是原始 Codex worker 退出原因；也没有在用户真实 Home 上执行 restart 或 recover。
