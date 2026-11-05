---
type: Task
title: "Issue 304：共享启动诊断"
description: "集中启动失败的安全事实、恢复建议与 SDK/CLI 投影，保持执行与生命周期合同。"
tags: [startup, lifecycle, ipc, extra, testing]
timestamp: 2026-11-04T06:15:00Z
slug: 304-startup-diagnostics
source: self
upstream: "https://github.com/Mininglamp-OSS/octo-runtime/issues/304"
---

# Issue 304：共享启动诊断

## 目标与归属

启动可以在任何 Run/Session/Task 或 IPC 之前失败；调用方必须直接取得稳定码、组件、既有阶段、已确认资源事实和可执行建议。此能力属于 Runtime 的启动合同；Home 选择、配置来源、依赖安装及修复动作仍归宿主。用户已授权更新 main、完成实现和验收后直接 commit/push/创建 PR，不合并。

## 基线与输入

- 独立远端 clone，初始 main `e7958065a250e8ed0986715e4a3fb07a70d885e9`；最终整合基线 `6fe5b5fc72084a0c2de91844a3606a9bc81e17d3`（已含 #310/#311），分支 `fix/304-startup-diagnostics`，本地 autocrlf=false。
- 2026-11-04 重读 Issue 正文/活动，无讨论评论，仍 OPEN；gh open PR 查询为空。
- Kernel 和 Extra 均原生构造，宿主持有服务，业务经既有 KernelClient/RPC；无执行 worker。
- CLI 已有受控 hints、单层 cause_code 和日志白名单；不能把现有能力描述为完全丢失原因。

## 承重合同

- 诊断是启动失败投影，复用 ServicePhase/cleanup；无第二套状态机、自动重试或 synthetic Run。
- 同一来源维护 catalog、动态安全格式化、SDK 与 CLI JSON/文本；有界 cause/aggregate/cycle 遍历，不输出原始异常、stderr、配置或环境。
- 保留公共错误码和原 cause/cleanup；未知原因明确未知；支持的入口才提供相应恢复动作。
- Home/端点最终合同已按 #306 → #303 → #304 整合；不导入其未提交 diff，不恢复已退役隐式 SDK Home resolver。
- 不修改默认测试选择器、CI、线上 Bot、其他 checkout 或无关进程。

## 范围与非目标

修改共享诊断定义、Kernel/Host 启动边界、CLI 失败投影/安全持久记录、双语 catalog/SDK 示例和显式手动专项。成功启动后的任务失败、Provider 探测 #238、服务环境 #292、业务连接状态机及旧端点迁移实现不在此任务。

## 验收

- 修改前记录实际传播链和缺口；相同错误跨 SDK/文本/JSON 保留 stable/root code、组件阶段、动态资源及建议。
- 覆盖 IPC 前失败、嵌套/聚合/循环及 cleanup incomplete、缺失/非目录/真实 Windows ACL、长度/IPC 冲突、缺失依赖/配置、未知原因；注入与原生验收分开。
- 运行期生成敏感 canary，验证允许事实保留和私密内容不投影；包外 SDK 类型与运行消费。
- Windows 11 build 22621 x64 普通用户，Node 24.19/26.13、pnpm11.19；build/typecheck 后再 lint/测试，首次完整相关回归并判断失败归属。
- 记录前置整合、公共兼容、未验证平台与真实业务缺口，完成知识 lint、diff 复核及 validation/review/journal。
