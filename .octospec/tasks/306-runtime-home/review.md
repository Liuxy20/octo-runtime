---
type: Review
title: "Issue 306：合同与 diff 自查"
description: "围绕宿主 Home、原生装配、启动诊断和授权边界复核改动。"
tags: [architecture, runtime, review]
timestamp: 2026-11-04T06:00:00Z
source: self
---

# Issue 306 自查

## 承重路径

- Home 策略最先越界在 SDK helper，已经删除 resolveHostHome；服务的 home 必填，在 initialize 原有生命周期内校验，保留 cause/cleanup。
- Kernel 与 Extra 均在调用进程原生构造；业务仍统一 RPC。CLI 的 run/install/start 使用明确选择的根，Playboard 的临时 Kernel 使用宿主已创建的独占临时目录，不将常驻 Home 当临时 endpoint。
- endpoint-only attach/acquire 与内部 server 校验传输地址，不推断 Home，不为其补默认目录。直接 Core 不提供 Home 生命周期。
- 公开服务增加 home 必填，调用方/示例/双语资料迁移；现有 config/身份/凭据不搬迁、不重置。
- IPC、文件路径及追加名称按各自编码和平台预算验证。平台计算不等于实机 bind；验证报告保留未验范围。

## 范围

不修改端点布局，不吞并 #303/#304，不关闭 #14。不扩展 workflow/job/matrix/trigger/gate/default test selectors；新增专项仅 test/manual 显式运行。交付包含提交、推送及关联 #306 的 PR；不执行合并或发布。

## 完成门槛

已复核生产代码、公共导出、现行调用方、示例、测试迁移、CLI 和规则的完整 diff。没有发现需要继续修改的本次合同问题；验证门槛仍非全绿，OpenClaw 两项同 SHA 基线失败、早期全量失败、最终隔离结果和未验范围均保留在 [验证记录](validation.md)。不把“实现完成”写成“全部验收通过”。

## COMPREHENSION

- 产品决定来自 #306：选择/准备 Home 归宿主；SDK 只验证既存根，CLI 单独拥有默认策略。
- 最先违约层是 SDK helper 的平台策略与服务 initialize 缺少验证；没有把问题归给 Electron、Adapter 或宿主清理。
- 新调用链为宿主准备 → 服务原 initialize 前置 Home/完整资源/IPC 检查 → 原 server/Extra 初始化 → 原 cause/cleanup 回收。业务仍统一 RPC，未另建生命周期状态机。
- 反例是基线可用缺失根启动，修复后同类输入得到 RuntimeHomeError、cleanup.complete=true 且无根/监听/身份日志创建；有效根通过真实 Windows IPC 与包外公共 API 启停。
- 公共服务 home 必填、resolveHostHome 删除、HostAccount/ProfilePaths.home 及 hostHomePaths 的存在性合同均已迁移并写明。历史 #210/#224 worker 复现脚本保留历史，不将其作为现行接入样例。

临时 PowerShell ModuleAnalysisCache 已移出 checkout；提交只包含本次实现、调用迁移、专项与资料。未更改 .github、package.json、pnpm-lock.yaml，不携带真实身份、凭据或配置。
