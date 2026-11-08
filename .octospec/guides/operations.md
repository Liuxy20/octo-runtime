---
type: Guide
title: 本地 Runtime 运维
description: 按身份、就绪、Provider 与扩展状态排障。
tags: []
timestamp: 2026-10-20T00:00:00Z
implementation_baseline: feat/executor-kernel-host-lifecycle
---

# Runtime 运维

宿主准备 Home 与 Adapter，调用 createKernelService 后 initialize，或通过公开 Client 的 attachKernel 连接现有 Kernel。关闭时等待服务 close；客户端 close 只关闭自身连接，不停止 Kernel。

CLI 使用 octo-runtime executor-kernel run/start/stop/restart/install/uninstall/status/logs；doctor 检查本地执行环境。--home 指定 Runtime Home，--json 输出完整状态并须检查退出码。install 默认开启用户服务自启；start 未安装时安装自身，uninstall 保留配置。

Kernel status.execution_ready 表示接纳开放，不证明 Provider 已认证或模型调用成功。原 Run 的终态、取消 ACK、资源清理和业务投递分别确认。故障首先检查有效 IPC 响应、owner lock、Provider probe、工作目录、系统服务状态和日志，不因远端离线删除身份。

Runtime 日志位于 Home/logs，受控元数据不含请求正文、凭据或原始异常。日志读取先于配置解析，损坏配置时仍可排障。日志关闭和执行清理均有共享截止时间，incomplete 必须保留事实，不能用进程退出推断成功。

渠道配置、连接、注册和投递由独立 octo-channel-gateway 的 configure、doctor、status、logs 管理；其 Home 独立，通过 --endpoint 指定既有 Kernel。Runtime 不安装或启动 Gateway。

真实 Provider、平台服务管理器与 IM 需要独立环境验收；离线回归和文档检查不能替代真实结果。
