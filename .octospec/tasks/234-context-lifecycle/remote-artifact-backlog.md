---
type: Task
title: Issue 243 OpenClaw 远端产物交付待办
description: 明确 Adapter 的产物位置判定和远端文件引用转换责任，按 P2 暂缓实施。
tags: [openclaw, adapter, channel, delivery]
timestamp: 2026-10-29T14:40:00+08:00
priority: P2
status: deferred
---

# 决策与背景

[Issue #243](https://github.com/Mininglamp-OSS/octo-runtime/issues/243) 是 [Issue #234](https://github.com/Mininglamp-OSS/octo-runtime/issues/234) 的非阻塞后续项。用户当前主要使用本地 OpenClaw，远端场景少，最新要求是 **P2 待办，不急，暂不实施**；覆盖之前 P0 的提议，父 Issue #234 仍为 P0。

本地文件被 `agentSource=preset` 提前拒绝的问题已按 [本轮验证](validation.md) 修复。`agentSource` 表达来源，不表达执行位置；WS 连接同样不代表远端。当前成功 final 的本地文件引用按 Gateway 实际文件系统读取，不额外增加用户配置。远端转换尚未支持，不能把本地修复描述成远端能力。

## 已接受的后续约束

| 责任方 | 后续责任 |
| --- | --- |
| OpenClaw Adapter | 解析实际连接 URL 的 hostname；协调远端文件访问或上传，将远端产物引用转换为 Gateway 可读取的 HTTPS 资源。 |
| 远端 OpenClaw 所在执行环境 | 提供实际文件读取或上传能力；本机 Adapter 不能凭绝对路径读取远端文件系统。具体接口需验证。 |
| Channel Gateway | 继续执行可信交付限制、附件上传、Markdown 替换、原生文件卡、去重、取消和交付反馈；远端资源接入方式也需随本项实现。 |

用户指定的产物位置判定为：解析 `URL.hostname` 并完整匹配 `127.0.0.1`、`localhost`、`0.0.0.0` 时本地，其他 hostname 远端。不能匹配 `localhost.example.com` 等包含字符串，不从 `agentSource`、Provider 名称或 WS 传输推断位置。此约定不放宽现有 URL、TLS 和认证校验；`0.0.0.0` 的产物分类不表示当前已支持明文连接该地址。

本地文件仍输出绝对路径 Markdown，图片带 `!`。远端文件须在 Adapter 输出边界完成可访问引用转换，不能把远端 `/tmp/report.md` 交给 Gateway 去读本机同名文件。普通网页链接保留原语义，不把代码示例或全部 HTTP 链接认成附件。Adapter 不调用 IM API；模型输出提示只表达环境及格式约定，不替代确定性处理。

## 实施前需确认

1. 核实远端 OpenClaw 可用的文件读取/上传 API、认证、HTTPS 资源有效期及清理方式，不假定现有协议已有该能力。
2. 确定 Gateway 如何区分可交付远端资源与普通网页，并在拉取及交付阶段沿用限制、取消、超时和去重；不另建通用能力注册机制。
3. 明确 IPv6 回环、代理/隧道、容器和共享目录映射对位置的影响，再决定是否扩展指定 hostname 规则。

## 后续验收

- 三个指定 hostname 的本地绝对路径及图片交付保持；其他 hostname 远端，字符串伪装不误判。连接认证及 TLS 规则保持。
- 远端文件能够实际转换和读取，Gateway 继续附件上传与文件卡交付；远端路径与本机同名文件碰撞时不得读错文件。
- 远端接口不可用、文件缺失、URL 过期及交付失败如实反馈，不重跑已完成任务，不把附件失败改写为模型失败。
- 流式与最终正文一致，正常链接和代码不误写；取消、重试、图片/文件去重及显式交付限制生效。
- 验证在本地或显式手动运行，不扩大 GitHub CI 范围。

## 当前记录范围

仅维护架构、OpenClaw 与渠道规则，以及 [Adapter](../../../packages/octo-runtime-adapter-openclaw/src/index.ts) 中连接 URL 解析和 final 输出处的两个 `TODO(P2, #243)` 注释。本轮不实现转换、不删除 `agentSource`、不增加配置或协议字段，不需 build/install 或服务重启。此项仍为 deferred，不能以文档完成为由关闭。
