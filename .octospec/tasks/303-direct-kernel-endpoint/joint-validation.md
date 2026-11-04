---
type: Validation
title: "303 与 PR 310 的联合验证"
description: "基于 306 已发布 PR head 验证直接 Kernel 地址、Home 边界及兼容租约预算。"
tags: [runtime, ipc, lifecycle, testing, windows]
timestamp: 2026-11-04T08:00:00Z
source: self
---

# 联合验证

## 主线交付基线

#306 已通过 PR #310 合并为 `bd287f9557e1280d8197a184201136bb6caf0100`。
已确认该提交与下述验证 head `ff611e3f` 的 Git tree 完全相同
（`87f15b2de4a0a590d917fd4295014b9eda6edfe2`），没有代码或依赖差异。
分支 `fix/303-direct-kernel-endpoint-after-home` 直接基于该最新主线承载 #303 修改，
保留完整构建与联合检查证据。用户随后明确要求提交 PR；按仓库模板创建，
不自动合并。下文为此前联合验证的实际执行记录与剩余限制。

对齐主线后复跑 Node 24 的 #303/#306 两个显式专项：56 tests，46 pass、0 fail、
10 skip；未改变源码或默认测试选择器。知识 lint 再验 exit 0（642 units、20 rules、
3925 links），工作区与暂存区 `git diff --check` 均通过。

用户要求在 #306 合并前直接验证 #303 是否修复。独立 worktree 基于 PR #310 head
`ff611e3f729c1814b5465712b5a8c5dda31334c8`，应用本地 #303 补丁并解决接口冲突；不修改
#306 的 checkout，不执行 commit、push、PR 或合并。此前 e7958065 上的验证保留为历史。

保留 #306 的原始 Home 校验、CLI 默认和 RuntimeHomeError 投影；接入 #303 的直接
Kernel 端点、旧租约保护和 close 清理确认。新增纯布局计算供端点与 kernelStartupPaths
共用，将旧 owner/recovery 与旧 .runs 纳入文件系统预算，旧地址不再套用 IPC 字节限制。
保留其非递归子目录准备边界，根不存在时不补建或回退。

验收：完整构建/类型后执行 #303/#306/#237/#302 专项，启用原先 #306 缺失而跳过的
预算断言；确认 Windows 默认/显式 Home、冲突环境、中文空格、长 Home、真实 IPC 与
状态/恢复。现有 API 不再提供 runtimePaths.socket，专项改以真实 CLI status/doctor
验证一致性。真实 Unix bind 仍按实际环境报告，不把计算或故障注入记作真机通过。

## 结果

Windows 11 Enterprise x64 build 22621，普通用户；Node 24.19.0 / 26.13.0、pnpm
11.19.0。运行产物由当前联合源码串行完整构建；Home、TEMP、AppData 均隔离到
checkout 外的 `CodexValidation/303-joint`，未使用全局安装的旧 Runtime。

| 检查 | 实际结果 |
| --- | --- |
| `pnpm typecheck`（含完整 build） | exit 0 |
| Node 24：四个显式专项（303/306/237/302），`--test-concurrency=1` | 62 pass / 0 fail / 10 skip |
| Node 26：相同四个专项 | 62 pass / 0 fail / 10 skip |
| Node 24：九个相关回归文件 | 41 pass / 0 fail / 2 skip |
| 修改的 TypeScript 源文件 ESLint | exit 0 |
| `pnpm docs:check` | exit 0，4 pass |
| `pnpm format:check`、`pnpm lint:names` | 均 exit 0 |
| `.octospec/scripts/lint.py`、`git diff --check` | 均 exit 0 |

九个回归文件为 runtime-endpoint、host-sdk-lifecycle、kernel-clients、
service-bind-startup、cli-home、kernel-endpoint、runtime-debug、extra-startup、
profile-layout。实际 Windows 检查包含中文/空格 Home、超过 260 单位的 Home、
named-pipe 边界、ACL 拒绝、独立 Extra、CLI status/doctor/recover、重复关闭、
初始化回滚及未确认清理保留。旧格式文件拒绝/保留和竞争租约是在 Windows 上执行的
文件系统测试，不冒充 POSIX socket 竞争。

原始 PR #310 endpoint.ts 与联合产物进行派生对照：示例 Home
`/Users/alice/Library/Application Support/octobuddy/octo-runtime`，#306 单独仍派生
105 字节旧地址并报 `IPC_ENDPOINT_TOO_LONG`；联合修复得到 84 字节的直接地址，
低于 macOS 103 字节预算，Windows 管道身份相同。对照只替换模块导入以复用同版
校验器，未改原始派生逻辑。这是源码/计算证据，不是 macOS 真机 bind。

新增联合预算测试在首次执行时因测试 Home 单组件先超过模拟 NAME_MAX=47 而失败；
修正为多组件夹具后，上述 Node 24/26 完整专项均通过。没有为此放宽产品校验。
旧兼容 owner/recovery 和 .runs 已纳入实际启动文件系统预算，直接端点边界测试启用，
Extra 控制地址继续独立拒绝超限。

## 结论与边界

在固定 PR head 上，#303 的原始路径过长根因已经消除，#306 Home 合同下的 Windows
联合行为验证通过。#306 本身不包含 #303 短地址修复；需要本次联合补丁。
macOS/Linux 真实 bind、权限导致 socket unlink 失败和跨版本 socket 竞争仍须真机执行；
10 个专项 skip / 2 个回归 skip 保留，不计通过。本轮未重跑全量默认套件或全仓 lint；
此前基线的全量失败与内存限制记录保留在历史 validation.md，不宣称全仓全绿。

未改 workflow、默认 selector、锁文件或全局设置；#306 checkout 仍干净且 head 未变。
联合 worktree 为 detached HEAD 上未提交修改；没有 commit、push、PR、公开评论或合并。
