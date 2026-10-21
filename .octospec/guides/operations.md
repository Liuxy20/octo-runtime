---
type: Guide
title: 本地 Runtime 运维
description: 按身份、就绪、Provider 与扩展状态排障。
tags: []
timestamp: 2026-10-20T00:00:00Z
implementation_baseline: feat/executor-kernel-host-lifecycle
---

# Runtime 运维

先区分本地身份、IPC 就绪、Provider 可用、扩展业务连接和执行终态，见 [Runtime 合同](../rules/runtime-lifecycle.md)。涉及真实服务的调试使用 `https://im-test.deepminer.com.cn/`。

## 启动与检查

HostApp 准备模块和 Provider，createKernelService 后 initialize，或 attachKernel 连接既有服务；createExtraService 后 initialize。服务在调用进程构造，关闭使用 close。CLI 在两个终端分别运行组件：

```sh
octo-runtime --home /absolute/runtime/state executor-kernel run
octo-runtime --home /absolute/runtime/state channel-gateway run
octo-runtime --home /absolute/runtime/state status
octo-runtime --home /absolute/runtime/state adapter list
octo-runtime --home /absolute/runtime/state adapter probe codex
```

SDK 查看 KernelClient.status 的 execution_ready、worker 状态及 ExtraService.status 的 plugin/kernel_available。socket 文件、历史 connected 值或 Extra 初始化成功均不能替代实际就绪／连接证据。全局 status 查询 Kernel 与各已配置 Extra 自身 status；`executor-kernel status` 或 `<extra-name> status` 单独查询对应组件。默认紧凑文本展示业务健康和计数，`--json` 输出缩进 JSON 完整状态。

Kernel 与每个 Extra 分别执行 start，未安装时自动注册本组件并开启登录/manager 激活自启，向 stderr 打印安装及启动进度；--json 的 stdout 只保留最终结果。显式 install 首次和重复安装同样默认自启，只有 --autostart=false 才关闭。禁用后，start/restart 提示用 install --autostart=true 恢复，普通 install 同样恢复自启。Extra 先启动允许 Kernel 暂时不可用，后续 Kernel 上线无须重新启动 Extra，不存在必须 Kernel 先启动的依赖。裸组件命令显示用途及配置/启动帮助。修改配置后只重启对应服务，不改变其他组件。

## 排障

| 故障 | 检查与恢复 |
| --- | --- |
| IPC 不可用 | 检查有效响应、runner／Host 入口、owner lock、进程与日志 |
| Host 就绪但无法执行 | 检查 probe、Provider 安装／认证、执行配置、工作目录和权限 |
| 扩展缺失或初始化失败 | 检查宿主提供的包、入口与配置；缺失不触发自动安装 |
| 业务连接断线 | 按对应扩展协议检查地址、TLS、鉴权和实际连接状态 |
| 输出断流 | 沿原 run／stream 游标修复；缺口或过期明确失败，不重新 invoke |
| 取消已受理 | 继续观察真实终态与 Provider 清理 |
| 历史缺失 | 检查消费应用存储；Host 内存窗口不是完整历史库 |

不要因外部离线删除本地身份或重装 Provider。聊天 reset、身份重建和执行取消是不同操作。

## 日志与验收

SDK Extra 的 logging 默认关闭，宿主可向 createExtraService 显式传 `logging: { directory: "/absolute/logs" }`；Kernel 通过 worker 的 OCTO_RUNTIME_LOGS_DIRECTORY 环境指定目录。当前 CLI 为 Kernel worker 和 Gateway 配置 `<home>/logs`，不支持 --logs-dir/--verbose/--force。start 不改已安装的服务定义。旧 OCTO_RUNTIME_DEBUG 不创建独立 Host debug 文件。

CLI 初始化失败也使用下面的统一结构化日志：`cli.initialization_failed` 保存稳定错误码，`cli.initialization_cause` 保存受控原因码；日志关闭沿有界刷新，不额外捕获原始 stdout/stderr。检查管理器退出码、IPC 超时与提前退出，不能仅靠 COMMAND_FAILED 猜测。文本错误写 stderr；--json 错误写 stdout，均须检查退出码。JSON 接口不输出任意异常正文或原生 stderr，以免泄露凭据。

文件按 UTC 小时命名：内核 `<directory>/kernel-YYYYMMDDTHH.log`，Extra `<directory>/extras/<extra_type>-YYYYMMDDTHH.log`。每个序列保留最近 3 个实际日志文件，包含当前文件，单文件最多 100 MiB；没有新日志的小时不创建空文件。停机或空闲跨天不按时间年龄删除这 3 个文件，产生第四个文件后淘汰最旧归档。启动、首条小时写入及每 60 秒执行本序列清理，停止后不清理；其他类别、用户文件和旧固定文件不受影响。时钟回拨时保留当前活动文件，再按文件名时间保留两个最新归档。见[逐项实施记录](../tasks/gateway-august-feature-assessment/implementation.md)。

格式为 `time/level/source/event/extra_type?/data`。data 只允许既有调用/Run/session 标识、Adapter 类型/模型、状态/稳定错误码、耗时、输入/非 Adapter Context 项数及帧/转换计数等元数据；不保存正文、原始错误、完整配置、环境值、图片、地址、预览或内容哈希。ExtraContext 的 log 由加载器绑定真实 extra_type，插件不管理文件，也不能通过 data 覆盖来源。日志关闭不建立目录、文件或日志 Worker。

专用 Worker 隔离同步磁盘操作，每进程最多 128 条在途、最多 128 个文件序列，满额或写入失败丢弃诊断；关闭最多等 1 秒，不阻断 Agent。文件写入沿用非等待互斥、容量和符号链接检查，锁冲突可能丢日志；它不是审计账本。SDK/launcher 不再将任意原始 stdout/stderr 落入另一套日志，必要 stderr 仍交宿主终端或系统服务管理器。Provider 原生日志、用户重定向和系统日志不由该策略管理；真实跨平台服务安装仍需各平台验收。

本版没有 Runtime SQLite outbox 或逐事件 durable ACK，不采用清 outbox／修 ACK 水位作为运维步骤。分别记录 IPC 就绪、扩展连接、真实 Provider 终态及业务保存／投递结果。fixture 测试不能替代 im-test 与真实桌面 renderer 验收；文档修改本身不产生新的实测证据。
