---
type: Rule
title: 纯执行与有界状态
description: 不持久化业务历史，只保留有界执行窗口和运行配置。
tags: ["storage","stream","stateless"]
timestamp: 2026-10-19T00:00:00Z
implementation_baseline: df63c8f
id: runtime-stateless
tier: repo
priority: 90
load_bearing: true
inject_when:
  paths: ["packages/octo-runtime-executor-core/**","packages/octo-runtime-host-sdk/**","packages/octo-runtime-executor-kernel/**","test/stateless-*"]
  touches: ["storage","stream","stateless"]
source: self
supersedes: []
---

# 纯执行与有界状态

Runtime 接收已准备的请求、校验执行配置、调用 Provider、传递事件、处理交互和取消。业务 Agent 定义、Session/Run 历史、Provider binding 和重启后的业务恢复由调用方保存与决定。

当前 ExecutorCore 导出 AgentExecutor 和本轮执行配置解析，不导出工作区分配/准备工具、领域 store、SQLite 或业务调度引擎。Issue 335 删除 prepareRunContext 与 WorkspaceAssignments；调用方先创建目录，Core 仅在 Provider 执行前校验本次明确路径，不补建或迁移旧目录。Core 最多保留 1024 个 invocation 的身份元数据，非活动记录按 120 秒惰性淘汰；未消费 iterator 不占容量，暂停的活动调用及清理未完成资源不得被淘汰。源帧回放仍归传输层窗口，不移入 Core。不得以无限增长的 Map 或 Run JSON 归档替代已删除的数据库。

## 源流窗口

以中央 `StreamLimitPolicy`、[HostRunService](../../packages/octo-runtime-executor-kernel/src/host-run-service.ts) 及容量检查为准：

| 项目 | 当前上限 |
| --- | --- |
| Run 数量，含正在接纳的调用 | 128 |
| 每 Run 帧数 / 序列化大小 | 4096 / 32 MiB |
| 总帧序列化大小 | 128 MiB |
| 单帧大小 | 20 MiB |
| TTL | 120 秒 |
| 同时订阅 / 每页帧数 | 16 / 32 |

超过窗口淘汰旧帧，游标缺口和过期明确报错。保留不依赖消费者 ACK；不能用慢连接固定占住无限旧帧。字节上限不是进程 RSS 上限，Provider、对象、队列和复制还有额外开销。

Kernel 宿主重启后旧 stream 不恢复，不自动重放业务请求，不从历史补模型上下文。终态和过期状态必须按窗口合同释放；停止时回收执行资源。

## Provider 接收缓冲

ACP 的每个 session 更新队列使用 DriverQueue：默认单项不超过 20 MiB，排队不超过 4096 条，排队序列化总量不超过 32 MiB。单项、累计字节和条数分别返回 `STREAM_QUEUE_ITEM_TOO_LARGE`、`STREAM_QUEUE_BYTES_EXCEEDED`、`STREAM_QUEUE_ITEMS_EXCEEDED`，清空积压并关闭当前传输；不静默丢事件后报告成功，不影响其他客户端。这些是序列化字节及条数上限，不是整个进程的 RSS 上限。

普通协议行在 readline / JSON.parse 前默认限制为 16 MiB，包括尚未收到换行的数据；超限返回 `PROVIDER_MESSAGE_TOO_LARGE`。ACP 当前 prompt 显式包含原生图片时，原生行按既有 `INVOKE_REQUEST_MAX_BYTES`（32 MiB）限制，以容纳输入回显；prompt 结束恢复本 invocation 的有效上限，事件队列预算始终不变。

各 Adapter 同类限制继承中央默认值，可由受信 `execution.stream_limits` 显式覆盖；每项硬最大值为默认值两倍，关系矛盾或越界配置直接拒绝，不静默裁剪。策略在 invocation 开始时冻结，不读取 Context、聊天正文或 Provider 参数。全局重放清理采用活跃策略中的最高受信预算，较低覆盖不得淘汰其他 Adapter 已保留的帧。

超限是本次调用的真实失败，清理队列、reader、pending 和受管进程。正常结束时已接纳的终态仍须交给消费者；不能把正常退出等同于容量溢出。当前回归见 [Provider 缓冲测试](../../test/provider-buffer-limits.test.js)。

## 业务状态归消费者

渠道卡片、投递回执、会话 binding 和上下文历史预算归独立 Gateway 或应用，不属于 Runtime。Runtime 不增加业务数据库，不将宿主业务存储解释为 Kernel durable ACK 或旧 Run 恢复。

## 保留的文件

配置、受保护凭据、machine/Runtime 身份、PID/socket、监督状态和 `invocations.json` 可以保留。后者用于孤儿进程清理，不保存 Run 输入或事件历史。Provider 自身的数据库及原生会话文件仍由 Provider 管理。

旧数据库不读取、不迁移，也不自动删除用户文件。应用可以保存自己的完整业务历史，但该存储不能反过来成为 Host 的 durable ACK 或历史恢复合同。

## 受管日志

SDK Kernel 显式指定 logging.directory；CLI 使用 home/logs，不提供 --logs-dir。未配置的 SDK 实例不创建日志资源。日志只记录生命周期、身份、稳定错误码和输入/Context 项数及安全执行选择；不记录正文、原始错误、完整配置、凭据、预览或内容哈希，不重复落盘原始进程输出。

F31 已确认并实施：按 UTC 小时命名，每序列保留最近 3 个实际文件（包含当前文件），单文件 100 MiB；不按最近 3 小时年龄删除，跨天停机后仍保留最后文件。新小时实际写入第四个文件时淘汰最旧归档，不创建无日志小时的空文件。专用 Worker 隔离磁盘写入，每进程最多 128 条在途和 128 个序列，满额、锁竞争或写入失败可丢诊断，不保证审计完整性；关闭最多等待 1 秒，不影响 Agent 执行。轮转沿用非等待互斥和普通文件校验，不删除身份、Provider 文件、用户文件或旧固定日志。详情与原生服务定义更新见[运维](../guides/operations.md)及[实施记录](../tasks/gateway-august-feature-assessment/implementation.md#f31-核心改造已实施)。

正常关闭应提供上述既有有界排空机会；健康回归场景要求关闭后预期记录完整。目录可写且未触发容量限制仍不等于日志必达：Worker 超时、写入失败、锁竞争继续按可丢弃诊断处理，不能转成执行失败或无限等待。Kernel owner 在 Core 排空后关闭日志，沿用共享截止时间；旧 Windows worker 的 EOF 路径仅属历史实现，见 [#38 记录](../journal/shared/2026-10-20-windows-host-log-close.md)。

## 核对入口

[Core 导出](../../packages/octo-runtime-executor-core/src/index.ts)、[HostRunService](../../packages/octo-runtime-executor-kernel/src/host-run-service.ts)、[进程清理清单](../../packages/octo-runtime-executor-kernel/src/invocation-manifest.ts)、[无数据库回归](../../test/stateless-executor.test.js)。

SQLite 移除时的测试数量与真实执行仅保留为 [历史验证摘要](../journal/shared/provider-validation-history.md)，不作为当前工作树的新验收。
