---
type: Validation
title: "Issue 303：精简版本验证"
description: "直接端点改名的构建、专项、相关回归及平台限制。"
tags: [runtime, ipc, testing, windows]
timestamp: 2026-11-04T11:00:00Z
source: self
---

# 版本与范围

基线 bd287f9557e1280d8197a184201136bb6caf0100，PR #311 的精简修订。
此前 94b5e13d 的兼容机制及专属测试已经撤回；其通过结果不用于证明当前版本。
七个 Kernel/公开导出/CLI 错误投影文件逐字恢复主线，新增布局模块和升级指南删除。

Windows 11 Enterprise x64 build 22621、普通用户；Node 24.19.0 / 26.13.0、
pnpm 11.19.0。源码构建，Home/TEMP/AppData 位于 checkout 外的独占任务目录。
测试只关闭/清理本次持有的服务、客户端、私有夹具；不接管在线实例。

## 本次结果

| 检查 | 实际结果 |
| --- | --- |
| pnpm typecheck（含完整构建，workspace 并发 1） | exit 0 |
| Node 24：#303/#306/#237/#302 显式专项，test-concurrency=1 | 52 tests，47 pass / 0 fail / 5 skip |
| Node 26：相同专项 | 52 tests，47 pass / 0 fail / 5 skip |
| Node 24：九个端点/SDK/client/CLI/startup/profile 回归文件 | 43 tests，41 pass / 0 fail / 2 skip |
| 修改的两个 TypeScript 文件 ESLint | exit 0 |
| pnpm docs:check | exit 0，4 pass |
| pnpm format:check、pnpm lint:names | 均 exit 0 |
| 知识 lint、工作区/暂存区 diff check | 均 exit 0 |

原生 Windows 检查包含指定中文/空格 Home、实际 Kernel/attach/Extra RPC、同 Home
普通互斥、CLI status/doctor、现有 orphan recovery、重复关闭及原始数据保留。
Node 24/26 的 #303 精简专项本身各 6 pass / 0 fail / 1 native Unix skip；其余结果
来自配套专项。POSIX/Linux/macOS 派生计算覆盖准确地址、21 字节缩短、整路径 UTF-8
边界及超限错误。九个回归文件沿用之前的明确选择，未改变默认 selector。

逐字 diff 确认整个 Kernel 包、public 导出和 CLI output 与基线一致；兼容错误、布局
辅助模块和迁移指南无残留引用。最终生产代码只改 Host SDK endpoint 与 CLI state。
没有新增公共 API、兼容状态、第二监听或恢复流程。

## 历史与未验证项

旧实现阶段的全量 Windows 套件没有全绿，出现超时、文件锁、OOM 及未确认恢复失败；
全仓单进程 lint 曾 OOM，逐目录检查当时通过。这些历史结果保留在前一提交的记录，
不当作当前版本通过。本次只执行与直接改名匹配的检查，不扩大默认套件或 CI。

本机没有 macOS/Linux 真机，合成 platform/字节边界计算不等于真实 Unix bind；
POSIX 原生边界专项在本机明确 skip。旧 head 的 reviewer/CI 证据不冒充此新 head。
Provider/IM、Electron 和发行部署 live acceptance 未执行，为 non-gating。
