---
type: Analysis
title: Issue 93 源码与故障边界分析
description: 将报告事实、源码事实和待验证假设分开，定义每个假设的证据与修复归属。
tags: [channel, ipc, lifecycle, stream, adapter]
timestamp: 2026-10-22T00:00:00Z
---

# 报告事实与可信边界

Issue 于 `2026-10-22T02:25:08Z` 更新，标签为 `bug / needs-triage / P0`，读取时无评论。报告描述 MacBook 合盖约一小时后，某个 Bot 留在 `failed / IM_SERVER_DISCONNECTED_12`；只重启 Gateway 后 WS online，但新消息显示结果未知；再重启 Kernel 后新消息恢复。四 Bot 状态不证明四个全部故障。报告没有准确构建、macOS/Node/Provider 版本、唤醒等待时间、其他 owner 和睡前活动任务信息。

SDK 同类事故尚未独立复现，但 Issue 明确将原生 SDK 列为强制范围。不能从 CLI 通过推断 SDK 通过。两次重启是定位线索，不能证明 Unix socket 监听失效；结果未知文案也不能证明 Provider 没有开始执行。

# 已确认源码事实

以下路径均相对仓库根，基线均为 `3b34415`。定位行号只用于阅读，不替代实施时核查。

| ID | 定位 | 事实及含义 |
| --- | --- | --- |
| F01 | `packages/octo-runtime-extra-channel-gateway/src/transport/wukong.ts:350` | 服务端 DISCONNECT 全部包装为 `retryable=false`，包含 reason 12 |
| F02 | `packages/octo-runtime-extra-channel-gateway/src/application/im-channel.ts:216` | 首次连接失败只有 `recovering && everOnline && retryable` 才重试；初次暂态失败也永久 failed |
| F03 | 同文件 `:231, :251` | 已上线后的暂态断线按 5/10/20/30 秒封顶等待，尊重 Retry-After；先等待旧 connector.close，再启动退避 |
| F04 | `test/im-connection-state-machine.test.js:78, :162` | 测试明确固化“首次暂态失败终止”与“reason 12 终止”；必须改对应断言，不能只增加新测试绕过 |
| F05 | `transport/wukong.ts:324` | 每 25 秒检查最近包时间，超过 90 秒 terminate；挂起时不执行 timer，唤醒后的回调排序需要真实验证 |
| F06 | `packages/octo-runtime-executor-kernel/src/client.ts:33, :234` | RPC 各开新 socket；subscribe 是原 ref/连续 seq 的最多 3 次、10 秒预算修复；不是持久单连接必须重建的模型 |
| F07 | 同文件 `:363, :402` | invoke 先读实例；ACK 丢失仅查询原身份，查不到报 ACCEPTANCE_UNKNOWN；不能盲目再次 invoke |
| F08 | `packages/octo-runtime-executor-kernel/src/supervisor.ts:91` | 1 秒 timer 先比较 lastPong 的 5 秒差值，再发 ping；长挂起后存在先判失联的时序风险，尚未证明是报告根因 |
| F09 | 同文件 `:115, :148` | worker 清理成功才替换，60 秒最多三次；耗尽后保持 IPC status，拒绝执行。不能无条件清零来隐藏崩溃循环 |
| F10 | `packages/octo-runtime-executor-kernel/src/server.ts:170, :245` | status 区分 execution_ready/worker；worker exhausted 单独拒绝。IPC 响应和 Provider 真执行仍是不同事实 |
| F11 | `packages/octo-runtime-host-sdk/src/extra-service.ts:100, :236` | SDK Extra 内部 attach 相同 KernelClient；status 探测 execution_ready，没有强制先等 Kernel 才创建 Gateway |
| F12 | `application/im-channel.ts:1105` | 非终态消费错误尝试取消并设置 resultUnknown，原错误在此 catch 被折叠；卡片不能定位失败层，需增加安全诊断 |
| F13 | `transport/channel.ts:571` 与 `application/im-channel.ts:239` | close 等待下层清理；永不 settle 会阻止下次尝试。只能在确认失去旧资源所有权后替换，不能 race 超时后直接开第二个 owner |
| F14 | `client.ts`、`invocation-lifecycle.ts`、本地执行规则 | client 32 连接、Kernel 64 连接/16 订阅、128 Run/调用登记均有界；需查泄漏与 unresolved 占额，不能用清空未知记录恢复“健康” |
| F15 | `apps/cli/src/main.ts:218`、`help.ts` | 当前组件 action 不含 logs；前台 run 只发布 ready 与启动失败，尚无用户要求的状态日志查看命令 |
| F16 | `packages/octo-runtime-adapter-sdk/src/runtime-log.ts` | 当前结构化日志经 Worker 写文件，不输出状态 stdout；白名单中有 Run/session 元数据，不能整份作为本次 logs 内容 |
| F17 | `apps/cli/src/service-control.ts`、cross-service 三平台实现 | CLI 当前不设置 stdoutPath/stderrPath；launchd/systemd 可原生重定向，Windows task 显式拒绝。这意味着只加 launchd 文件路径不足以满足共同 CLI 功能 |

F03 为当前实现；用户已要求目标改成 **5/10/15/15…秒**，不沿用 30 秒封顶。新的状态日志是独立明确范围，不等于读取聊天或执行逐帧日志。

源码入口：[Gateway 状态机](../../../packages/octo-runtime-extra-channel-gateway/src/application/im-channel.ts)、[WS](../../../packages/octo-runtime-extra-channel-gateway/src/transport/wukong.ts)、[错误分类](../../../packages/octo-runtime-extra-channel-gateway/src/transport/connection-error.ts)、[KernelClient](../../../packages/octo-runtime-executor-kernel/src/client.ts)、[Supervisor](../../../packages/octo-runtime-executor-kernel/src/supervisor.ts)、[Extra 服务](../../../packages/octo-runtime-host-sdk/src/extra-service.ts)。

# reason 12 的补充证据

同级本地 `octo-im` checkout `613fc2b2b3a4c23054385ee3f8238fc44a8f68e7` 中，`pkg/protocol/frame/common.go` 的 iota 将 12 定义为 `ReasonConnectKick`；`internal/usecase/presence/gateway.go:208` 在路由踢连接时发送；`internal/usecase/user/token.go:58` 在更新 master Token 时也发送。此为**本地源码线索**，没有核实与 `im-test` 或事故部署一致，不能推导该事故一定有第二客户端。

M0 须记录部署 revision、reason-code 表、触发点、是否有 owner/session 标识和同 Bot 同时连接证据。reason 文本不得作为可信自动接管许可；当前客户端也没有已验证的 owner 仲裁 API。若协议无法区分暂态踢线与有效 owner 替换，需要服务端提供明确的机器可读原因/租约语义；在本仓只标终态不能算完成 P0，但盲目重试同样不合格。

# 假设、区分实验与修复分支

| 假设 | 故障现场区分实验 | 只有取得相应证据后执行的修复 |
| --- | --- | --- |
| H1 原 Kernel listener 不可用 | 记录 PID/instance/endpoint；同 endpoint status、list、fresh invoke；OS 查询实际监听及 socket 所有者 | 在 server/endpoint 的失效创建或关闭路径修复；禁止看到 socket 文件就 unlink/rebind |
| H2 worker 未恢复或预算耗尽 | IPC status 成功但 execution_ready=false；记录 worker state/generation/PID、last ping/pong、清理和替换原因 | 修 supervisor 的挂起时序/监督；保留真实阻塞和清理失败边界 |
| H3 Provider/会话失效 | 同 Kernel、同 Provider：旧 client/旧 session、新 client/旧 session、旧 client/新 session、新 client/新 session 四组交叉 | 在对应 adapter 的 transport/session 生命周期修复；不得静默 reset 会话或换 Provider |
| H4 仅观察失败 | 保存 ACK/RunRef、最后连续 seq，get 原 ref；对比 Provider 终态和订阅 repair 错误 | 修 client/源窗口对合同的违反；窗口确实过期则如实 unknown，不能扩大为无限 replay |
| H5 资源泄漏或旧调用阻塞新任务 | 比较连接/订阅/队列、active/unresolved 登记及错误码；同 client 与 fresh client 比较 | 回收已确认结束资源，隔离每 Run 失败；不释放仍真实在途、未知执行或宿主依赖的额度 |
| H6 Gateway 断线清理卡住或信号串代 | 记录 connection epoch、abort 原因、close 起止；注入迟到成功/重复 close/error | 修下层可取消清理和代次 fencing，禁止未回收就并发建联 |

先捕获自然失败与探针，再按 Gateway-only、Kernel-only、Gateway→Kernel、Kernel→Gateway 四个独立 trial 定位。某 trial 重启任一组件后，不再用其后续结果声称原失败现场仍被保留。

# 关联工作与边界

#42 的 liveness、#78 的 offline replay/context、#30 的中断卡片和 #47/#48/#49 的服务生命周期均有关联。本修复不依赖未合并分支；M0 重新核实 main 和相关变更。#78 不能替代本 Issue 对恢复后新消息执行的要求，#30 不能用来推迟 unknown 与真实成功的区分。
