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
- 修复后，四个环境场景在独立 Node 子进程执行，完整 adapters 文件为 59 通过、0 失败、0 跳过。保留命令、argv、cwd、环境传递和 cleanup 验证。
- `test/windows-review-regressions.test.js` 中两个 Codex home 大小写/覆盖回归通过；其中 linux 分支是 Windows 上的平台注入，不能视为 Linux 真机验证。

## 检查与边界

- `pnpm typecheck`、`pnpm lint`、`pnpm lint:names` 通过。
- 初次全仓格式检查因隔离 checkout 的 CRLF 换行失败；恢复 Git 中的 LF 后 `pnpm format:check` 通过，不批量格式化源码。
- macOS/Linux 真机及其 CI 未执行。POSIX 保留非空覆盖、HOME 默认和空值回退三个场景；仅 Windows 专属的 HOME 缺失场景不在 POSIX 上执行，避免回退至真实账号目录。
- 测试仅调用命令构造器，不启动真实 Codex，不读取或改写真实凭据/config。
- 本机没有可调用的 Python/PyYAML，未运行 `.octospec/scripts/lint.py`；任务、context 和 journal 的本地链接及 frontmatter 另行核对。
- 用户复核后授权提交并创建关联 #88 的 PR，本次本地验收仅要求 Windows；不修改 Issue 正文，不合并或发布。现有规则已覆盖此问题，无需新增规则。
