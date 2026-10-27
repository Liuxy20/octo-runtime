---
type: Validation
title: Issue 198 本地断网与服务停机模拟
description: 在真实 CLI 和原生 SDK 上使用真实时钟验证服务停机、静默丢包及恢复后的新消息。
tags: [channel, testing, lifecycle]
timestamp: 2026-10-27T00:00:00Z
---

# 试验条件

用户于本轮明确要求本地模拟。复用本任务独立 worktree 的未提交修复，macOS、Node v24.19.0；不修改机器网络或用户正在使用的服务。每个模式独占短临时 Home、HTTP/WS 端口、控制 IPC、Kernel worker、运行期生成的无效测试凭据。CLI 模式运行真实 CLI 前台组件，SDK 模式直接创建同一公共服务；HTTP、WuKong 加密握手、消息投递和 Kernel IPC 均走真实本地连接，执行使用 fake Adapter 返回确定的 answer，不调用模型或外部 IM。

# 可重复命令

在此 worktree 已构建的情况下运行，两个模式可用独立进程并行执行：

```sh
OCTO_RECOVERY_OUTAGE=1 node --test --test-name-pattern='cli:' test/recovery-dual-mode.test.js
OCTO_RECOVERY_OUTAGE=1 node --test --test-name-pattern='sdk:' test/recovery-dual-mode.test.js
```

未设置该环境变量时保留普通回归，不让常规 CI 每次等待 90 秒。显式长测保留原始心跳与退避参数，不使用 fake timer、不加速 Date 或性能时钟。

# 场景与断言

1. 初始 HTTP 503，恢复服务可用性后自动上线，基准消息执行并回复。
2. 普通 socket 断开、两轮 reason 12、reason 0 与新增断开码 255，逐轮等待 retrying → online，每轮新消息均执行并回复。
3. 停止 fixture 的 HTTP 监听端口并终止其 socket：连接请求实际被拒绝，等待两次失败，核对 5/10/15 秒退避；原端口重启后等待下一次尝试恢复，新消息回复正常。
4. 静默丢弃应用层 HTTP 和 WS 流量，不发送 close/error：等待产品自己记录 IM_HEARTBEAT_TIMEOUT，再恢复流量；检查真实检测时间、新连接、新消息回复。这模拟长连接静默失联，不等同于内核 TCP 防火墙丢包或物理 Wi-Fi 断网。
5. 保留原 worker 丢失回归：旧任务不重新接纳，新任务可执行。结束时 Gateway/Kernel 进程身份不变，每个模式累计 8 条连接（初始 + 7 次恢复），当前连接仅 1 条；有断开、安排重试、开始尝试、连接成功四类日志。
6. 关闭隔离服务、等待所属子进程退出、删除临时 Home。

# 结果

CLI 与 SDK 各一轮全部通过（每轮约 170 秒），使用真实时钟。原始日志：`/tmp/octo-198-local-outage-cli.log`、`/tmp/octo-198-local-outage-sdk.log`。

| 模式 | 故障 | 故障持续/检测时间 | 恢复服务/流量至上线且回复 | 结果 |
| --- | --- | --- | --- | --- |
| CLI | 停止服务监听后原端口启动 | 15014 ms | 15052 ms | PASS，新消息收到 answer |
| CLI | 静默丢弃流量，等待心跳发现 | 99957 ms | 5050 ms | PASS，新消息收到 answer |
| SDK | 停止服务监听后原端口启动 | 15015 ms | 15051 ms | PASS，新消息收到 answer |
| SDK | 静默丢弃流量，等待心跳发现 | 99963 ms | 5062 ms | PASS，新消息收到 answer |

停机期间观测到退避 `[5000, 10000, 15000]`，第三次等待期间恢复服务，因此下一次尝试约 15 秒后成功。静默丢包检测约 100 秒，之后等待首轮 5 秒退避恢复；这两段不能合成“5 秒发现并恢复断网”。socket 仍未收到有效数据时的 online 是既有探活阈值内状态，不能由此宣称即时感知网络失效。

所有场景均检查新消息经过 Gateway → Kernel → fake Adapter → 加密 WS 回复，Gateway/Kernel 身份保持、没有重提旧未知任务、累计连接数符合预期且恢复后只有一条连接。case 的 finally 已等待所属服务/子进程关闭并删除临时 Home。另有状态机与原 IM 全链路相邻回归 95 项通过，日志 `/tmp/octo-198-local-adjacent.log`；两个测试文件格式、Node 语法及 diff 空白检查通过。

# 结论与边界

本地模拟证实永久停止重试的分类修复有效，也用真实时间证实另一个未改变的限制：静默断网约 100 秒才发现，达不到 20 秒发现并恢复。此次仅增加模拟覆盖，未改变心跳参数；若要求更短的失联发现时限，需要单独明确探活合同并实现验证。

本次是本地受控故障试验；不是物理 Wi-Fi 断网、操作系统休眠、线上滚动发布或真实 Provider/IM 验收。未提交、部署或更新操作者当前安装。模拟服务的主动断开不证明事故服务端为什么下发 reason 12。
