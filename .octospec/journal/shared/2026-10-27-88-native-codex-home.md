---
type: Journal
title: "Issue 88：Codex 原生 Home 断言验证"
description: "记录原生 Windows 复现、测试修复和未验证的平台边界。"
tags: [testing, windows, adapter, envs]
timestamp: 2026-10-27T10:00:00Z
source: self
---

# Issue 88：Codex 原生 Home 断言验证

## 结果与范围

- [任务](../../tasks/88-native-codex-home/brief.md)基线为 main `bd3c74d8312e552a9347f768865183ae5e3625f7`；仅修改 Codex 命令测试，产品源码、SDK 导出、类型和 Schema 均不变。
- 原生 Windows 11 Enterprise build 22621、x64、普通用户、PowerShell 5.1，Node 24.22.0、pnpm 11.19.0。
- 修复前，HOME/profile 不同、HOME 缺失及空 CODEX_HOME 均失败；显式非空覆盖通过。完整 adapters 文件为 54 通过、1 失败。
- 修复后，四个环境场景在一个独立 Node 子进程内顺序执行，完整 adapters 文件为 59 通过、0 失败、0 跳过。保留命令、argv、cwd、环境透传 sentinel 和 cleanup 验证。
- `test/windows-review-regressions.test.js` 中两个 Codex home 大小写/覆盖回归通过；其中 linux 分支是 Windows 上的平台注入，不能视为 Linux 真机验证。

## 检查与边界

- `pnpm typecheck`、`pnpm lint`、`pnpm lint:names` 通过。
- 初次全仓格式检查因隔离 checkout 的 CRLF 换行失败；恢复 Git 中的 LF 后 `pnpm format:check` 通过，不批量格式化源码。
- macOS/Linux 未在本机执行。初版提交 `2970eca6` 的 Ubuntu/macOS、Node 24/26 CI 均通过，日志确认三个 POSIX 场景执行，Windows HOME 缺失场景按设计跳过，见 [CI 记录](https://github.com/Mininglamp-OSS/octo-runtime/actions/runs/40484180697)。后续修订以对应 head 的 CI 为准。
- 测试仅调用命令构造器，不启动真实 Codex，不读取或改写真实凭据/config。
- 本机没有可调用的 Python/PyYAML，未运行 `.octospec/scripts/lint.py`；任务、context 和 journal 的本地链接及 frontmatter 另行核对。
- 用户复核后授权提交并创建关联 #88 的 PR，本次本地验收仅要求 Windows；不修改 Issue 正文，不合并或发布。现有规则已覆盖此问题，无需新增规则。

## PR 评审修订

- Windows Node 24.22.0 实测确认，同进程修改 USERPROFILE 会立即改变 `homedir()`；同进程、单子进程和四子进程三种形态均通过四个场景，且能完整恢复环境。因此合并为一次子进程启动，保留父进程隔离；实际调用计数为 1。
- 显式覆盖放在缺失回退之前；子进程每轮重置 HOME/CODEX_HOME，不将前轮值带入后轮。仍保留原生 Home 自检、场景名称及四个子测试结果。
- 原 HOME/USERPROFILE 断言能捕获新增/改错/删除对应值，并非恒真；但不能证明无关变量透传，改用测试独占的 OCTO_TEST_SENTINEL 断言表达此目标。
- 对实际新版测试进行临时加载变异验证：丢弃 sentinel 时在显式覆盖场景报 ERR_ASSERTION；移除 CODEX_HOME 重置时在默认回退场景报 ERR_ASSERTION。变异仅在外部加载器内注入，不修改产品或提交变异脚本。
- 修订后 Windows 完整 adapters 59/59、相关 Codex 回归 2/2 通过；格式、lint、命名及 `tsc -p tsconfig.json --noEmit` 检查均通过。类型检查复用已有构建；生产 TypeScript 未改。
