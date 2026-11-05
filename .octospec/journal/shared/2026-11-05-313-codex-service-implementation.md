---
type: Journal
title: Issue 313：Codex 常驻服务实施与验证
description: 记录 Core scope 所有权、服务恢复、逐轮清理和常驻 PID 诊断的实际实施、测试与未验边界。
tags: [architecture, adapter, lifecycle, testing]
---

# 实施结果

用户在[原规划](2026-11-04-313-codex-service-plan.md)后授权实施。基线 `de3ff37a86ee3cb8f6ab66148ceca817f6ae5240`，实施和审查时使用 `plan/issue-313-codex-service`，改动尚未提交。用户后续授权 PR 交付后，更名为 `feat/codex-service-lifecycle`。

Core 每次注册 Adapter 可创建独立 scope。Codex scope 持有最多八种兼容配置的常驻服务；service.ts 持有 owned 进程、stdio、初始化、路由、代次和单飞有界恢复，app-server.ts 保留逐轮状态。取消仅撤销所属 writer 条目并中断/退订原 thread；Core owner 停恢复并关闭服务，失败/未决服务 ID 单独汇总。

合格 final_answer 通过本地上下文回调确认 fallback 成功；不扩展公共输出联合，清理失败仍保留 failed/incomplete。doctor 读取既有 KernelStatus 安全快照，同一存活身份和 PID 合并角色，只展示常驻 Host/Kernel、Extra、app-server；无 turn/thread/Run 或凭据，不触发 Provider 启动。

本机 macOS arm64、Node 24.22.2、Codex CLI 0.164.0。真实 direct/IPC 各五轮覆盖 PID 复用、idle/active kill、无重放和恢复后显式续聊，owner 清理 complete；真实 MCP elicitation 往返通过。离线 26 项、既有全量 2400 项中的 2334 pass/66 skip、Go/Python 各 43 项、包外严格类型/安装/运行通过。完整命令及修复后重验见[验证](../../tasks/313-codex-service-lifecycle/validation.md)。

Linux/Windows 原生、外部 Electron、实际 im-test HTML 投递与部分真实并发审批/预算耗尽组合尚未验证；[A01-A21](../../tasks/313-codex-service-lifecycle/acceptance.md)逐项区分 pass/partial/not run。不能据此关闭 #307 或 #313。已按要求完成 code-review 与 verified-review，六个独立问题修复后复审无未关闭 finding，详见[审查记录](../../tasks/313-codex-service-lifecycle/review.md)。

无 workflow、脚本、默认测试选择器或 Gate 扩围；所有新增专项在 test/manual 显式运行。上述实施审查阶段未 commit、push、PR、merge 或 publish。

用户于 2026-11-05 追加“提交 PR -> Main”，现授权英文提交、push 并创建目标为 main 的 PR。再次 fetch 后 main 仍为原基线，无冲突；Git 作者沿用本地配置并追加一次 Codex trailer。远端实际检查以 PR 为准；不自动合并或发布，跨平台/IM 验收范围保持。

PR 为 [#317](https://github.com/Mininglamp-OSS/octo-runtime/pull/317)。后续外部 P2 在相对 cwd + 相对可执行文件路径下复现，绝对 cwd 本来正常；生产代码仅改一次路径解析，四个真实 POSIX 可执行夹具验证替换后新增服务且旧服务保持。30 项手动专项和默认 2400 项回归通过，类型/lint/格式通过，本地双轴复审无未关闭项；[整改记录](../../tasks/313-codex-service-lifecycle/review.md#pr-317-外部路径审查整改)与[重验](../../tasks/313-codex-service-lifecycle/validation.md#外部-review-修复后重验)保留证据。没有改成热重启或仅重启生效策略，未扩 CI；GitHub 重新批准需看远端实际状态。
