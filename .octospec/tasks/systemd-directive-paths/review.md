---
type: Task
title: Issue 113 双轴审查
description: 记录 systemd 路径指令修复的规范审查、需求审查和复核结论。
tags: [linux, systemd, review]
timestamp: 2026-10-23T00:00:00Z
---

# Issue #113 双轴审查

- 固定基线：`fe19d350431534da4ed3a76f3466add4ced86d81`，已 fetch 并 rebase 最新 main。
- 审查对象：修复分支相对固定基线的完整差异，含审查后修正；合并为同一个修复提交，不包含其他需求。
- 需求来源：GitHub Issue #113；仓库未配置 `docs/agents/issue-tracker.md`，本次直接使用用户指定 Issue。
- Standards 与 Spec 由独立 reviewer 分开检查；复核中不修改实现文件。实际验证由主执行者完成，证据见 [验证记录](../../journal/shared/2026-10-22-systemd-directive-paths.md)。

## Standards

- 最终硬性规范违例 0 项，启发式代码异味 0 项，无阻塞项。
- 未改变公共 API、组件拓扑或生命周期所有权，符合共享 Linux backend 的职责。
- 说明与任务文档使用中文；英文 Conventional Commit 与 PR 按 OSS 约定执行，并保留恰好一次 Codex trailer。
- 验证记录按最终检查更新，明确区分自动化、原生实测和未覆盖环境，不以旧轮次计数代替最终证据。

## Spec

- 最终遗留 0 项；初审与复核发现的 3 项 P2 均已修复。
- 偶数尾部反斜杠：原样保留，不再过度拒绝。
- 奇数尾部反斜杠：附加保护空格避免续行，原生 strstrip 随后移除保护空格；1/2/3/4 单测与奇偶原生落点验证覆盖。
- 垂直制表符与换页符：未被 systemd strstrip 裁剪，保持字面量；拒绝范围收窄为尾部空格和水平制表符，三字段均有单测和原生保真回归。
- WorkingDirectory 与 append 日志路径采用专用序列化，ExecStart/Environment 引号不变；没有扩展至其他平台或前台运行。
- 原生 Linux 已覆盖实际 cwd、两路日志、旧坏 unit 重新安装与启动；真实 CLI Kernel 与已配置 WebUI Extra 完成生命周期验证。不宣称已验证 WSL2、真实 Provider 或 IM Bot 在线。

合计：Standards 0 项；Spec 遗留 0 项（已修复 3 项 P2）；两轴均无阻塞问题。

## PR #114 外部 P2 修订复核

固定点为先前 PR head `7beb87eee82b3e286cbf461ea4894efd2f575f78`；审查范围仅 XDG fixture 修订，不重新扩大生产实现范围。

### Standards

硬性规范违例 0，启发式异味 0。显式测试环境、临时目录清理、英文提交及 Codex trailer 符合规范，未改变生产责任边界。

### Spec

实现缺失、越界及错误行为 0。默认/XDG 路径参数化与原生 backend definitionPath 修复均落实外部 P2 要求。已有外部 XDG 本地全量验证和原生 user manager 50/50；Ubuntu Node 24/26 必须以新提交 CI 结果单独闭环，不把本地通过当作远端通过。

本轮合计：Standards 0；Spec 实现问题 0，远端 Ubuntu 两个 job 的重跑结果待推送后确认。
