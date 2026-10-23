---
type: Task
title: Issue 81 与 Dependabot 安全整改
description: 基于最新 main 逐条复核 CodeQL 告警并修复依赖漏洞。
tags: [security, testing]
timestamp: 2026-10-23T00:00:00Z
---

# 目标与基线

- 用户授权修复 Issue #81 及当前 Dependabot 告警；基线为 `origin/main@445d2bb`。
- 原 CodeQL 分析为 `main@6fee2e1`、CodeQL 2.27.2、security-extended 103 条规则、35 条告警。
- 最新 main 托管重扫：[Actions 39889943281](https://github.com/Mininglamp-OSS/octo-runtime/actions/runs/39889943281)。逐条结果见 disposition.md。
- Dependabot #1/#2 均命中 `@vitest/mocker@4.1.11`，升级同一 Vitest 4.x 修复线至至少 4.1.12。

# 合同与范围

业务目标为修复真实安全缺陷并保留已有功能。文件所有权、鉴权目标、持久凭据合同在各自模块判断；不恢复已删除 daemon，不改变 Home、身份、配置或 IM 准入，不削弱 CodeQL 查询或批量忽略告警。

现有服务/进程拓扑和 composition root 不变；Kernel、worker、Extra 各自资源所有权不变。不新增协议或生命周期入口。宿主明确配置的凭据及 API 目标仍由宿主选择，执行层不代替业务重新选择。

# 验收

1. 原 35 条与最新扫描新增项都有路径、信任边界、处置、回归证据和托管结果记录。
2. 真实缺陷补针对性恶意输入、文件失败或并发回归。
3. lint、typecheck、相关测试及完整测试通过，依赖审计无本次已知漏洞。
4. 用户后续已授权按逐条处置流程合并 main；遵守分支保护要求的 CI Gate 和至少一位 reviewer 批准，不绕过门禁。最终合并 main 托管重扫与告警面板核对仍是 Issue 关闭条件。
5. PR review 5623626814 的两项发现均修复：严格 umask 不改变权限夹具含义；CLI 与 Gateway 对重复尾斜杠、末尾 /api 的规范化结果一致，保留内部路径。
6. Windows 发行验收在命令超时和前台 CLI 停止时回收本次进程树；目录清理失败不得覆盖原始错误。新增真实后代进程回归须在 Windows Node 24/26 执行。按用户要求身份查询期限从 30 秒改为 40 秒，外层运行验收覆盖身份查询与后续 RPC/清理预算；身份失败仍禁止使用未知 PID，不删除安全断言。
7. PR review 5623908244：系统树回收与 fallback kill 均失败时，在有限 close 确认期限后报告原始命令错误及明确 incomplete/PID，不无限等待、不伪造进程退出；缺失可执行文件保留 ENOENT，退出状态独立保存。
