---
type: Task
title: "Task: Issue 60 测试 fixture 原生路径兼容"
description: "在测试启动边界正确转换 file URL，保留现有 SDK 和失败断言。"
tags: [testing]
timestamp: 2026-10-27T00:00:00Z
slug: 60-windows-fixture-paths
source: user
upstream: "https://github.com/Mininglamp-OSS/octo-runtime/issues/60"
---

# Task: Issue 60 测试 fixture 原生路径兼容

## Goal

修复 ACP、ZCode 和 Issue 评论补充的 Grok 测试将 URL.pathname 作为原生启动路径的问题。

## Background

基线 main@f0bacb01590084523c21dc9996d05738c9a06a44，Windows 11 x64、普通用户、Node 24.18.0、pnpm 11.19.0。原始三个完整测试文件 14 通过、30 失败；正文五项和评论的 Grok 路径失败均已再次复现。独立副本只构建相关 8 个包，未使用旧发行产物。

## Load-bearing list

- 测试在生成自己拥有的 fixture 路径时承担 URL 到文件路径的转换；SDK 接收原生路径的合同保持。
- 修复只使用 Node 标准库 fileURLToPath，保留 argv、cwd、容量、超时、失败和终态断言。
- 上层 SDK、公开导出、类型、配置、生产代码及资源所有权均不变。

## Product intent / ownership

- 业务目标：测试能启动真实 fixture，进入既有行为断言。
- 决定权与显式输入：测试拥有 fixture URL、启动参数和本轮临时状态；宿主继续拥有 SDK 接入与配置。
- 合同内动作：在三个测试文件的路径生成位置正确转换 URL。
- 越界动作：修改生产路径解析、增加 SDK 平台选项、改变执行/关闭策略、降低测试要求。
- 其他产品影响：没有产品接口变更；POSIX 也应正确解码特殊字符路径。

## Out of scope

- 不修改 SDK、Adapter、Kernel 或 Provider 的生产实现。
- 路径恢复后 ACP 的 EXECUTOR_CLEANUP_INCOMPLETE 和 Grok 两项断流超时已用脱离路径转换的独立实验定位到 Core 清理确认策略和 Windows fixture 的断流模拟。两者均不属于本 Issue 明确限定的 fixture 启动路径边界；保留原失败，不以放宽断言、跳过或延长超时掩盖，也不扩大到产品清理或断流实现。
- 用户后续明确授权提交、通过现有 SSH 身份推送并创建关联 #60 的 PR；不合并、不发布 npm/GitHub Release，也不修改 Issue 正文或扩大代码范围。

## Acceptance

- 三处 fixture 使用 fileURLToPath，保留所有既有业务断言。
- 原始三个完整文件复测；启动路径错误消失，剩余失败保留真实结果。
- 真实 fixture 从含空格、中文、#、% 的路径启动，不能仅验证转换字符串。
- 运行相关构建/类型、lint、格式检查，检查 diff 无公共接口或无关行为变化。
- macOS/Linux 未在本机运行时明确标注未验证；Windows 路径修复不等于整个文件已通过。

## Result

三处测试启动路径已修复，所有原有断言保持。[验证记录](../../journal/shared/2026-10-27-60-windows-fixture-paths.md)记录普通路径、特殊字符路径和仍存在的关闭/断流失败。后续按用户授权提交并创建 PR，关联 #60、Refs #14；不能据此宣称全部相关测试均通过。
