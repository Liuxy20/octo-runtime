---
type: Task
title: "Issue 236：Windows ACP 失败后的清理确认"
description: "定位并修复缺失 ACP 可执行程序后的错误清理状态，关联复测 Issue 237。"
tags: [adapter, lifecycle, invocation, testing]
timestamp: 2026-11-02T08:40:00Z
upstream: "https://github.com/Mininglamp-OSS/octo-runtime/issues/236"
---

# 目标与范围

在最新 main 的独立 checkout 修复 #236：缺失可执行程序仅使对应调用失败，保留原始 ENOENT、并行与后续调用可用，并在实际确认资源回收后正常关闭。#237 是关联回归，不预设同根。初次交付本地 diff 和版本绑定证据；用户后续明确授权提交、通过已有 SSH 身份推送来源分支并创建关联 #236 的 PR，不包含合并或直接关闭 Issue。

## 责任与承重合同

- 业务目标、配置、Provider 安装选择归宿主；本次只有执行故障与资源清理行为，无业务默认值变化。
- 拓扑保持 Host/Kernel → 独立 worker/AgentExecutor → ACP Adapter → Provider 子进程。composition root、公共 SDK、协议与部署不变，没有 API 删除或迁移。
- Adapter 拥有本轮传输与响应桥清理，Core 拥有 invocation ownership；Kernel 拥有 worker、endpoint、lease 与 manifest。首个违反合同的组件负责修复。
- 已接纳调用失败、执行终态、迭代器关闭、OS 进程树回收分别确认。真正失败、挂起或未确认的 finalizer 仍须 incomplete 并保留 ownership。
- 不吞错、不提前释放 ownership、不增大原测试超时、不扩大 CI 或默认测试集合，不改其他 checkout、在线 Bot、既有 Home/身份/配置。

## 验收

- 记录最新 main、Windows 普通用户、实际 Node/PATH、pnpm 与原文件基线错误；追踪 Core owner、ACP close、worker drain 和 Kernel 关闭。
- Node 24.19.0 与 26.13.0 重复执行完整 `test/acp-transport-failure.test.js`，确认所属 PID 退出及原有并行/后续调用断言。
- 每版 Node 至少三轮执行原组合 `test/invocation-manifest.test.js test/component-startup.test.js`，保留每轮结果与具体 cause；只有证实同根才纳入修复。
- 增加显式手动回归覆盖原始错误、成功清理和真实 incomplete；运行相关构建、类型、lint、命名、格式、知识检查及相称回归，完整默认套件的已知独立失败分别记录。
- fake Provider、隔离测试 Home/TEMP/TMP；超时只回收本次所属树。macOS/Linux、真实 Provider/IM 和 Windows 10 未执行即写未验证。

## 基线

`origin/main@58332b3bcf5651f58e674fa236184dc6a0d927ca`，修复分支 `fix/windows-acp-cleanup-236`。2026-11-02 查询 #236/#237 仍 open；#295 为未合并架构重构，不替代当前 main 的修复。交接证据已读，1854 文件原快照完整性及历史结果仅作线索。
