---
type: Journal
title: Issue 210 Codex worker 恢复阻塞排查
timestamp: 2026-10-27T00:00:00Z
---

# Issue 210：Codex worker 恢复阻塞排查

从最新 `origin/main@005116e` 建立独立 worktree 和
`codex/issue-210-kernel-recovery` 分支。用户要求先看方案并模拟，补充 Codex 为受影响
Adapter，且持续 30 分钟失败不符合快速恢复预期。初期只排查和复现；用户随后要求快速
恢复实现、先补齐 OctoSpec 方案、本地模拟验证，并新增 executor-kernel logs。

已完成构建及五项受控复现：正常 app-server EOF 的故障域、worker 自动替换、在途
Codex 请求失联后仅恢复新请求、清理探测失败、manifest 清除失败。后两项均重现
`generation=1 / exhausted / restart_attempt=0`，旧 PID 已消失、invocations 为空、
撤销注入仍不再恢复；Gateway ImTask 把明确拒绝记录为 unknown。

上述为 main 基线行为。已按 [方案](../../tasks/210-kernel-recovery/design.md) 实现：
清理/manifest 失败按 1/2/5 秒持续重试，失败 Promise 不再永久阻断恢复；父进程独立
状态日志和 executor-kernel logs 可读取恢复阶段、原因和重试；status 提供 recovery，
明确执行前拒绝产生可信未提交证明。原请求不重放，Gateway 不重启 Kernel。

Codex app-server 采用独立进程组，worker 组回收不能独立证明全部工具已停止。本次
模拟 app-server 随 stdin EOF 退出，未证明真实 Codex 工具在强杀场景的完整回收。
没有调用真实模型、连接 IM 或改变用户服务。用户随后授权本地 verified-review、提交并
推送 PR、向 Loop OCTO-1 追加 PR 地址；本记录为提交前本地验收。

复现脚本与完整证据见[任务](../../tasks/210-kernel-recovery/brief.md)、
[基线排查](../../tasks/210-kernel-recovery/assessment.md)及[验收](../../tasks/210-kernel-recovery/validation.md)。
修复后故障解除至新请求成功约 1.3–1.4 秒，同一 Kernel 自动替换 worker。Codex 五项模拟、
七项专门恢复测试、39 项日志与渠道测试通过，均无失败或跳过。最终 Node 全量 2022 通过、
56 跳过，WebUI 35 通过；类型、lint、命名、生成一致性、文档和格式检查通过。

Go、Python 各 358 条共享协议样例通过；首次缺少 Python venv，按既有锁文件运行
`uv sync --project native/python --frozen --python 3.11` 后重跑成功。OKF 检查通过，
包括新增审查记录。系统 Python 缺少 PyYAML，使用
`uv run --with pyyaml python .octospec/scripts/lint.py` 检查，未修改项目依赖。

verified-review 复现并修复两项 medium：父日志在 worker 后串行关闭导致共享 5 秒期限
误报 incomplete；读取 Kernel 状态日志时给缺失时间戳记录补当前时间。两项测试均先失败
后通过，最终全量覆盖修复及其他调用方，无剩余 medium 及以上发现。覆盖与证据见
[review](../../tasks/210-kernel-recovery/review.md)。最后一次 Codex 模拟故障解除至新请求
完成分别为 1367 毫秒与 1364 毫秒，真实文件系统故障为 1315 毫秒，均低于本地 5 秒门槛。

PR #212 的外部审查发现 Windows P1，原 head 为 `e8feadb`：普通退出的 worker 被
无条件送入 immediate taskkill 分支，每次重试在 OS 操作前就拒绝，无法替换。此问题
在前次 macOS 本地审查中漏检，不是原事故退出原因。新增真实 worker 的 Windows 分支
模拟先复现失败，再修复 supervisor 的退出状态判断；已观察到清理失败后再退出仍保持
阻塞。Windows CI 现明确包含新旧恢复测试；原生 Windows 结果仍待新提交 CI 验证。
证据和本轮全量重试情况分别记录在 review 与 validation，历史 2022 项结果不覆盖该缺口。
2026-10-28 收尾：本轮 build/typecheck、lint、格式、命名、知识检查与专项回归通过；
全量尝试受睡眠/暂停和短期限超时影响，未取得通过结果，停止继续重复全量。
不把环境相关失败直接定性成产品缺陷，也不宣称当前全量已通过；Windows 原生结果待 CI。
