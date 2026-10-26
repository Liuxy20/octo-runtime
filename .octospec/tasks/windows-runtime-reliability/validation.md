---
type: Task
title: Windows 专项实施与验收
description: 四项修复的实际 Windows 证据、基线对照与未覆盖边界。
tags: [runtime, lifecycle, adapter, envs, installation, testing]
---

# 实施结果

基线为 `origin/main@8af8360`，分支为 `fix/windows-runtime-reliability`。本机为 Windows Server 2022 Datacenter 10.0.20348 x64、Node 24.22.0、pnpm 11.19.0。四项均已实施。本地验证完成后，用户授权英文提交、正式 PR 及按门禁合入 main；已执行 fetch 和 rebase，最新 main 仍为 `8af8360`，无冲突，后续远端结果单独记录。

| Issue | 最终行为 | 已执行的证据 |
| --- | --- | --- |
| #131 | 以启动时间验证 worker 身份后调用 `taskkill.exe /PID <pid> /T /F`，命令成功且 leader 退出才报告回收。失败原子保存 `cleanupIncomplete`，后续 leader 消失或 PID 被复用仍不覆盖证据、不启动替代 worker。 | Windows 真实三代进程全部退出；身份不符时保护无关进程；命令失败留档及后续 leader 消失时 `open` 拒绝替代。 |
| #135 | stdout、stderr 与 readline 错误进入本次调用清理，监听保留至管道关闭；释放所有 stdio，仍传播清理失败。实际缺失程序保留 `ENOENT`。 | stdout/stderr 错误与清理期间迟到错误；原生缺失程序；真实共享 worker 中活动 sibling、三类故障及后续调用均隔离；worker PID/代次不变且最终关闭完整。实际 281 字符 cwd 触发失败，worker 继续可用。 |
| #134 | XML 使用 UTF-16 声明与 UTF-16LE BOM，兼容旧 UTF-8 sidecar 读取并按字节迁移；PowerShell 查询输出 UTF-8，账号以 SID 比较以消除系统规范化造成的假 drift。 | ASCII 与中文/空格 Home × enabled 两值共四组真实 SDK/CLI 安装、查询、重复安装与删除；安装后无 drift。测试 finally 删除唯一命名任务，并查询确认不存在。 |
| #146 | 继承环境 < Context envs < executionEnvOverrides < Adapter overrides 逐层覆盖；Windows 忽略键大小写、保留最终拼写，POSIX 区分大小写；最终 spawn 再合并也不引入别名。 | 平台分支、各层优先级和输入不变；实际 Windows 子进程读取；并发调用中的不同大小写 PATH 覆盖互不污染。 |

真实计划任务验收还暴露并修复两处相邻问题：默认 PowerShell 编码损坏 Unicode 路径，以及 Scheduler 将 `DOMAIN\\user` 规范化成短账号/SID 后误报 drift。SID 比较仅作用于服务查询，不改变 Runtime 身份合同。

# 检查记录

以下命令均在最终实现上完成；最后收尾仅新增或更新 OctoSpec 文档。

| 检查 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 通过，包含 prepare/build。 |
| `pnpm typecheck` | 通过，包含全仓构建与 TypeScript 检查。 |
| `pnpm lint`、`pnpm lint:names`、`pnpm format:check` | 均通过。 |
| 定向 Windows 回归 | 25 通过，0 失败，0 跳过，覆盖进程树、环境、管道错误、共享 worker 和服务假后端。 |
| `node --unhandled-rejections=strict --test test/cross-service-windows-native.test.js` | 5 通过，含四组真实 SDK/CLI 计划任务矩阵及编码迁移。 |
| `pnpm test:suites`，本分支 | UI 35 通过；Node 1833 项，1668 通过、95 失败、70 跳过、0 取消。 |
| `pnpm test:suites`，未修改 `main@8af8360` | UI 35 通过；Node 1819 项，1654 通过、95 失败、70 跳过、0 取消。 |
| 全量失败集合对照 | 两边 95 个失败名称完全一致；新增 14 项全部通过，无新增失败。全量检查仍为失败状态。 |
| `git diff --check` | 通过。 |
| OctoSpec lint | 本分支与未修改基线均为相同四个旧文件缺少 frontmatter；本任务无新增错误。 |

定向回归命令：

```powershell
node --unhandled-rejections=strict --test --test-name-pattern='Windows|environment|envs|mandatory|per-run|concurrent CLI|Codex whitelist|stdout errors|stderr errors|native nonexistent|real worker|service definition' test/context-envs.test.js test/spawn-json-lines-errors.test.js test/kernel-spawn-isolation.test.js test/invocation-manifest.test.js test/cross-service.test.js test/cross-service-failures.test.js
```

全量原始日志保留在 worktree 外：

- `D:/github.com/Mininglamp-OSS/.worktree/windows-runtime-tests.log`
- `D:/github.com/Mininglamp-OSS/.worktree/windows-runtime-baseline-tests.log`
- `D:/github.com/Mininglamp-OSS/.worktree/windows-runtime-baseline-build.log`

基线已有的 OctoSpec frontmatter 问题为：

- `.octospec/tasks/systemd-directive-paths/brief.md`
- `.octospec/tasks/systemd-directive-paths/review.md`
- `.octospec/journal/shared/2026-10-22-systemd-directive-paths.md`
- `.octospec/journal/shared/2026-10-24-124-sass-build-fix.md`

已有 Windows Node 24/26 CI 增加显式专项步骤，运行管道错误、共享 worker、环境覆盖和真实任务安装；原有 manifest 身份步骤继续覆盖新增进程树回归。首版后续已推送并创建正式 PR；其 CI 与本轮评审修复分开记录如下。

# 评审修复与最新 main 验收

正式 [PR #179](https://github.com/Mininglamp-OSS/octo-runtime/pull/179) 的首版 `6e2f54b` 经六个 OS/Node 组合及 CI Gate 验证通过，见 [run 40261795168](https://github.com/Mininglamp-OSS/octo-runtime/actions/runs/40261795168)。三份评审已按[逐项处置](review-fixes.md)处理；新增环境消费者、ACP/Grok、恢复确认和 SID 状态回归。

本轮 `git rebase --autostash origin/main` 同步至 `78bb88a`，唯一冲突为知识目录，已保留双方条目。主仓库同样 fast-forward 到该提交并保持干净。两个 checkout 均重新 `pnpm install --frozen-lockfile`，使用上游未修改的官方 DSH SDK。

| 检查 | rebase 后实际结果 |
| --- | --- |
| frozen install/build、TypeScript、lint、命名、format | 通过；另单独检查最终 `.github/CI.md` 格式。 |
| `pnpm docs:check` | 通过，包含示例、静态检查及 4 项文档回归。 |
| 五个定向文件，严格 unhandled rejection | 29 通过，0 失败，0 跳过。 |
| 原生服务矩阵 | 完整测试中 5 项通过；包含 ASCII/Unicode 与空格路径、两种自启值的真实 SDK/CLI 安装查询删除。 |
| 修复分支全量 | UI 35 通过；Node 1837 项，1673 通过、94 失败、70 跳过、0 取消。 |
| 未修改 `main@78bb88a` 全量 | UI 35 通过；Node 1812 项，1647 通过、95 失败、70 跳过、0 取消。 |
| 失败集合 | 分支 94 项全部出现在基线；没有分支独有失败。基线额外一项 `Windows Host readiness timeout retains direct startup rollback` 在资源竞争时超过 2 秒，单独重跑 1 项通过（469 ms）。没有把两次全量的失败集合写成完全相同。 |
| 新增回归 | 相对最新 main 新增 25 项，全部通过。 |
| OctoSpec lint | 两边均为相同 7 处缺少 frontmatter，无新增错误。上游 #178 新增 3 处：`tasks/dsh-upstream-sdk/brief.md`、`tasks/dsh-upstream-sdk/upstream-feedback.md`、`journal/shared/2026-10-26-dsh-upstream-sdk.md`。 |
| diff | 通过；新 head 托管 CI 必须独立执行，不能沿用首版结果。 |

本轮日志位于 worktree 外的 `D:/github.com/Mininglamp-OSS/.worktree/`：`windows-runtime-rebased-tests.log`、`windows-runtime-latest-main-tests.log`、`windows-runtime-review-install.log`、`windows-runtime-latest-main-install.log`、`windows-runtime-rebased-format.log` 和 `windows-runtime-review-docs.log`。

恢复命令的确认只表示操作者已停止未知后代，不代表 Runtime 已自行验证整树为空；真实整机重启、Session 0 控制台编码、离线域控延迟及真实 Codex 白名单行为尚未验收。合并继续要求最新 head CI Gate 与 reviewer 批准。

# 5049add 后续评审验收

按[后续评审处置](review-fixes.md#5049add-后续评审)补齐 OpenCode/ZCode 环境消费者，并在同类检查中修复 Codex Home；明确模块清单参数的既有作用，清理已失效确认文件。新增 9 项，总定向回归 38 项全部通过。测试验证命令构建和真实临时桌面入口文件发现，不将其表述为真实 OpenCode/ZCode/Codex Provider 调用。

构建、最终源代码类型检查、lint、命名、format、docs 和 diff 检查通过；OctoSpec 为同样 7 处基线错误。完整 UI 35 通过，Node 1846 项：1682 通过、94 失败、70 跳过、0 取消；失败名称与 `5049add` 的 94 项完全相同，没有分支独有失败。相对最新 main 新增共 34 项全部通过；main 原全量额外 1 项启动预算断言的单独复验结果沿用上节记录，不重复把全量记成通过。5 项原生服务测试全部通过。

日志保存为 `D:/github.com/Mininglamp-OSS/.worktree/windows-runtime-review-round3-{typecheck,tests,lint,names,format,docs}.log`。新提交必须重新跑六组 CI；`5049add` 已通过的 run 40268347106 仅作为上一轮历史证据。用户已授权每 15 分钟检查新增 review、集中修复提交推送并评论，直到 review 通过；不得自行撤销他人的反对评审或绕过保护。

# 边界

- [97/100 评估](assessment.md)是实施准备度，不能当作全仓通过率或统计可靠性保证。
- #131 依赖仍存活且可验证身份的 leader。清理前 leader 已消失时，纯 Node 架构无法补回 Job Object 级归属保证；查询身份到 taskkill 之间仍有系统级 PID 竞态。
- 未实测 Windows 10/11、普通非管理员账号、Node 26、其他 locale、Linux/macOS。未修改系统 LongPathsEnabled。
- 未调用真实模型、IM 或用户现有服务；原生测试只操作唯一命名的临时任务和已知 fixture PID。
- 基线 95 个全量失败和四个文档检查错误仍存在，不扩大本次范围修复，也不记为通过。
