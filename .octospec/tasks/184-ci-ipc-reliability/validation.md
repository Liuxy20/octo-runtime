---
type: Task
title: Issue 184 实施与验证
description: 记录原实现失败、修复后检查及托管门禁的真实边界。
tags: [testing, ipc, lifecycle]
---

# 实施与验证

## 基线与环境

- 基线：`81284c9ed92066ce7cf34c1b84b608b9336279bf`，分支 `fix/184-ci-ipc-reliability`。
- 本机：macOS / arm64，Node v24.19.0，pnpm 11.19.0；独立 worktree。
- 自动化使用仓库 fake Provider，不调用真实模型、线上业务或用户常驻 Runtime。

## 原实现与修复对照

先新增回归、保留基线产品构建，执行：

```sh
node --test --test-name-pattern='Playboard temporary IPC ignores|Ctrl\+C cancels execution' test/playboard.test.js
```

原实现 3 项全部失败，退出码 1；native/canonical 两个长 Unicode 临时根测试期望 0，实际 1；取消测试期望 130，实际 1。三项 stderr 都为 `SERVICE_INITIALIZATION_FAILED`。本机日志 `/tmp/octo-184-before.log` 是工作时证据，不作为发行物。

产品修复只把 Playboard POSIX 临时根固定为 `/tmp`，使用独占 `op-XXXXXX` 私有目录；Windows 继续使用 tmpdir 和原命名管道。目录创建移动到进程 handler 注册之前，创建失败不会遗留监听。常驻端点和 Home 没有改动。

进程树 fixture 的 ready.json 改成同目录完整写入后 rename，ticks 在 ready 通知之前创建。DSH fixture 统一先终止登记后代并确认 ESRCH，再删目录；退出未确认保留失败，不吞异常。原 CI 的 JSON/ENOTEMPTY 失败有日志和代码证据，本机不把概率性失败声称为必现。

## 本机已执行检查

| 检查 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile --ignore-scripts` | PASS；锁文件未变 |
| `pnpm typecheck`，修复后 CLI build | PASS |
| `node --test test/playboard.test.js test/dsh-adapter.test.js test/process-group-cleanup.test.js` | PASS：87 通过，0 失败 |
| tree/tree-exit 与 reaps group focused 连续 10 次独立运行 | PASS：10/10，每次失败即停止；非整组失败重试 |
| `pnpm test:suites` | PASS：Node 1833 通过、50 平台条件跳过、0 失败；WebUI 35 通过 |
| `pnpm lint`、`pnpm lint:names`、`pnpm format:check` | PASS |
| `pnpm docs:check` | PASS：文档检查及 4 项真实公共 SDK 示例测试 |
| `git diff --check`；lockfile/generated drift | PASS |
| `node scripts/pack-release.mjs` 与 `node scripts/verify-release.mjs dist/release/mininglamp-oss-octo-runtime-0.0.0.tgz --expected-commit 81284c9ed92066ce7cf34c1b84b608b9336279bf` | PASS：独立离线安装、CLI、公共类型、Kernel/Extra 及卸载保留 Home；本地构建带 dirty，未使用 require-clean |
| `uv run --with pyyaml python .octospec/scripts/lint.py` | FAIL：7 个已有文件缺完整 frontmatter；本次改动文件无新报错，7 文件与 HEAD 完全一致 |

OKF 既有失败为 `tasks/dsh-upstream-sdk/{brief,upstream-feedback}.md`、`tasks/systemd-directive-paths/{brief,review}.md`、`journal/shared/2026-10-22-systemd-directive-paths.md`、`journal/shared/2026-10-24-124-sass-build-fix.md`、`journal/shared/2026-10-26-dsh-upstream-sdk.md`。本次不顺带修改其他任务历史文件。

## PR 与最新 main 同步

- [PR #186](https://github.com/Mininglamp-OSS/octo-runtime/pull/186) 的初始 head `5883a32d06b70aa014da0f8ee40a4ec3cc73984f` 已通过 [CI run 40280785379](https://github.com/Mininglamp-OSS/octo-runtime/actions/runs/40280785379)：Linux/macOS/Windows 的 Node 24/26 六组与 CI Gate 全通过，包含 Windows 新增长 Unicode 临时根回归。
- 用户要求更新最新 main；合入 `79b11aadfb77ab1955d5f361d49d9615beb73414`（#181）。仅索引与日志追加位置冲突，完整保留两边记录，产品代码无冲突，新增上游凭据环境及恢复验证代码保持原样。
- 合并工作区再次执行 `pnpm typecheck`、`pnpm lint`、`pnpm lint:names`、`pnpm format:check`、`pnpm docs:check`，均通过；`pnpm test:suites` 为 Node 1845 通过、52 跳过、0 失败，WebUI 35 通过。本机日志前缀为 `/tmp/octo-184-sync-`。
- 最新合并提交仍需其自身的 CI 和正式 GitHub approval；初始 head 通过不能替代新 head 的门禁。

## 尚未执行或不在本机覆盖

- 同步 main 后最终 head 的 macOS/Linux Node 24/26、Windows Node 24/26 长临时根回归及干净发行包验证待 CI；通过后以远端最终 head 的结果为准。
- #183 的控制台关闭、cleanup-failure 注入不在本分支；#183 更新基线后继续使用本修复。
- 强杀 Playboard 自身不能执行 finally，仍不承诺这种情形没有临时残留；未修改该产品保证。
- 审查及最终交付见 [review](review.md) 和后续 GitHub PR；本记录不以本地全绿替代托管平台验证。
