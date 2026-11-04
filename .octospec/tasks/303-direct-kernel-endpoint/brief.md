---
type: Task
title: "Issue 303：直接 Kernel 端点与安全过渡"
description: "将常驻 POSIX Kernel 地址收敛到指定 Home 根目录，阻止旧地址并行运行并保留所有权。"
tags: [runtime, ipc, lifecycle, architecture, testing]
timestamp: 2026-11-04T06:15:00Z
slug: 303-direct-kernel-endpoint
source: self
upstream: "https://github.com/Mininglamp-OSS/octo-runtime/issues/303"
---

# Issue 303：直接 Kernel 端点与安全过渡

## 目标与决定权

POSIX Kernel 的规范地址准确为 `<home>/executor-kernel.sock`。Windows 保留现有按规范 Home hash 派生的命名管道，Home 不随传输改变。宿主选择、准备 Home；SDK 显式校验及 CLI 默认值迁移由优先级更高的 #306 拥有，本任务不复制其未提交实现。

业务目标是缩短不必要的地址并让所有调用方与清理流程保持一致。显式 Home 是输入，不追加 app slug、不选择替代目录。默认 SDK Home、环境覆盖、其他状态根均不属于本任务可添加的策略。

## 基线与前置

- 独立 checkout / 分支 `fix/303-direct-kernel-endpoint`，main `e7958065a250e8ed0986715e4a3fb07a70d885e9`。
- #303、#306 正文与评论已通过 GitHub REST 刷新；均开放、无评论，无开放 PR。
- #306 当前仍是另一 checkout 的未提交草案，只读参考；最终整合次序为 306 → 303。最终完整验收必须在其落地主线后刷新复验。
- 本机 Windows 11 Enterprise build 22621、x64、普通用户；Node 24.19.0 / 26.13.0。没有已确认的 macOS/Linux 执行环境。

## 承重合同与拓扑

- CLI / Electron 宿主原生构造同一 Kernel 服务，Adapter 对象留在调用进程。服务 socket、Core、状态与租约归本服务；不新增执行 worker。
- Kernel 自有 client、attach、Extra 均通过同一地址 RPC；Extra 控制端点仅查询 Extra 状态，不是第二个 Kernel，不机械改名。
- endpoint 与 Home 是不同层次；端点派生不代替 #306 的启动校验。路径预算复用最终 #306 边界，UTF-8/UTF-16 与传输分别测量。
- 旧/新地址不能同时自动激活同一 Home 的 Kernel；保留旧地址识别和停止/重启流程，迁移不重建 Home、配置、凭据或身份。
- 只释放本次租约及可确认属于本次服务的资源；文件存在、PID 退出、控制 ACK 均不等于可任意删除或已完成回收。
- doctor / recover 与状态路径一致；未确认清理记录继续阻止启动，不杀无关进程，不复制业务状态。

## 范围外

- 不实现 #306 Home 选择/校验迁移，不复制其 diff；#304 完整诊断 catalog、#292 服务环境和 #14 总验收保持独立。
- 不改变 GitHub CI、默认测试选择器、workflow/job/matrix/trigger/Gate。
- 初始阶段只交付本地修复与验证；后续用户已明确要求提交 PR，允许本次 commit/push/PR，不自动合并或手动关闭 Issue。

## 验收

2026-11-04 追加：用户授权在 #306 合并前验证；以已发布 PR #310 head 做独立联合
整合，具体基线、冲突处理、结果和剩余真机缺口见 [联合验证](joint-validation.md)。

- 直接地址、Windows 旧管道身份、不同 Home、空格中文、派生字节预算有显式手动专项。
- 核对创建、内部 client、attach、独立 Extra、CLI status/doctor/recover、租约与清理的调用链。
- 实测 Windows 本地 IPC initialize/status/attach/Extra/close/recover，确认状态保留与隔离。POSIX 真实 bind/升级过渡未执行时明确记录缺口，合成平台计算不算真实 bind。
- 旧服务、旧 owner、异常遗留、竞争启动和 unrelated 文件保护均有相应证据；升级文档说明 stop/restart 与受影响调用方。
- build/typecheck 后再 lint、相关回归、全量既有测试、format/names/知识 lint，记录退出码与 skip。
- 审查完整 diff、凭据、API 兼容、资源所有权与 #306 前置整合状态。
