---
type: Design
title: Issue 210 快速恢复与 Kernel 可观测性方案
timestamp: 2026-10-27T00:00:00Z
---

# 快速恢复与 Kernel 可观测性

## 目标与故障定位

目标是恢复后续请求的执行能力。允许故障当轮失败，禁止自动重放可能已产生副作用的请求。
当前 `generation=1 / exhausted / restart_attempt=0` 可以由清理失败或 manifest 清除失败
触发；恢复循环在第一次替换之前退出，故障解除也不会自行恢复。这是持续不可用的已复现路径，
不是原事故退出原因的定论。基线证据见 [assessment.md](assessment.md)。

## 监督与恢复

Kernel 直接监督独立 worker；worker 内的 AgentExecutor 调用 Codex Adapter，由 Adapter
启动和正常回收 app-server。这里的所有权确认指旧执行资源是否已安全回收，不涉及登录和云端。
Gateway 只连接 Kernel，不重启共享执行服务。Kernel endpoint、instance、Home 和配置不变。

状态路径为 `ready → recovering → ready`；清理或清单写入暂时失败时显示 `exhausted`，
保留原因并继续单路重试。清理和 manifest 两阶段按 1、2、5 秒间隔重试，之后上限 5 秒。
成功后进入现有替换启动退避（250/1000/4000 毫秒，连续失败后每 15 秒），不等待人工 restart。
持续健康 60 秒后重置快速恢复预算，睡眠不消耗健康时间。关闭取消等待，不再启动新 worker。

回收失败必须允许重新检查实际资源，不能复用首次 rejected Promise。成功回收后记住成功，
禁止再次向历史 PGID 发信号；原 leader 已退出而同号 PID 重新出现时报告身份冲突。
Windows 已观察到后代回收失败后，leader 消失不能作为整树回收成功的证据。
替代 worker 启动失败且回滚清理失败时，保留该实例的真实清理入口，清理完成后才能再启动。
manifest 写队列允许失败后写入最新完整快照，但原调用仍得到失败，不提前清除旧身份记录。

Codex app-server 自身可能是独立进程组。本次不会用“worker PID 已消失”断言所有工具已停止，
也不引入按名称扫描或强杀用户其他进程。真实 Codex 在强杀场景下的完整后代回收保留为验证边界。

## 公开诊断与日志

`KernelStatus.worker.recovery` 为可选字段，含 `trigger`、`stage`、稳定错误 `code`、
`occurred_at`，可选 `retry_at`、`exit_code`、`signal`。stage 区分 cleanup、manifest、
starting、backoff；恢复 ready 后清除当前诊断。`execution_ready` 继续是可接纳执行的依据。
协议 schema 为唯一类型来源，同步生成 TypeScript、Go、Python。

Kernel 父进程记录 `worker.ready/lost/recovery_blocked/retry_scheduled/start_failed`，
即使 worker 死亡也保留恢复过程。CLI 默认写入当前 Home 的 `logs/kernel-status-*.log`，
SDK 沿既有 `logging.directory` 显式启用。独立状态日志不混入模型输入、工具输出、stderr、
任意异常正文或凭据；只保留时间、级别、事件、PID、代次、重试次数和上述诊断字段。
沿用小时轮转、最近三份与单文件 100 MiB 上限，状态队列有界且不阻塞恢复。

新增 `octo-runtime executor-kernel logs [--lines N] [--follow] [--json]`，默认 200 条，
上限 10000，JSON 输出 NDJSON。复用 Extra 日志的读取预算、轮转跟随和退出清理；只读独立
Kernel 状态系列，不依赖配置成功解析、插件加载或系统管理器。普通 status 展示阻塞阶段、
错误码、下次重试及日志命令。空日志成功返回并提示，权限/参数错误仍失败。

## 执行结果与渠道反馈

Kernel 在 `runs.submit` 前因 worker 不可用明确拒绝时，RPC 附带该 instance 的未提交证明。
客户端仅在实际 invoke 的匹配响应上赋予不可复制的可信标记。Gateway 沿公共分类展示
`OH-RUN-2012`（本轮未提交），避免把明确拒绝误报为结果未知。普通同名错误或拷贝的错误对象
不能产生证明；ACK 丢失、已接纳后断流、worker 执行中退出仍保留 unknown，不自动重试旧请求。

## 本地模拟与验收

全部使用独立临时 Home、真实 Kernel/worker、真实 Codex Adapter 和本地 app-server 协议
fixture，无真实模型或 IM 网络，不影响用户正在运行的服务。

| 场景 | 验收 |
| --- | --- |
| app-server EOF | 本轮失败，worker 保持 ready，下一请求成功 |
| 空闲 worker 强杀 | 同一 Kernel 自动替换，后续请求成功 |
| 在途 worker 强杀 | 原请求 unknown，后续新请求成功，无重放 |
| 清理探测 EPERM | 阻塞诊断和定时重试；撤销故障后 5 秒内新请求成功 |
| manifest 暂态写入失败 | 清理阶段不误报；恢复存储后 5 秒内新请求成功，磁盘 PID 更新 |
| 持续失败与关闭 | 重试可观测，无并发替换；close 可取消等待并保留 incomplete |
| 替代启动回滚清理失败 | 保留清理入口，故障解除后继续恢复 |
| Gateway 明确拒绝 | OH-RUN-2012，只有一次提交，不发无意义 cancel |
| 日志 | Kernel 死 worker 后仍留原因；text/NDJSON/轮转可读，不泄漏普通日志 |

5 秒是本地受控故障解除后的验收门槛，不是所有故障的总恢复承诺。总时间还包括故障检测、
实际清理和启动握手；持续权限失败或无法确认资源时应持续重试并显示阻塞，不能虚报 ready。
完成后执行类型、lint、生成一致性、定向与全量回归，并把实测时间、平台和未覆盖项写入 journal。
