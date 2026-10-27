---
type: Journal
title: PR 124 Sass 构建修复
description: 记录 Sass 空值属性选择器构建错误的复现、依赖修复和验证。
tags: [webui, dependencies, build, testing]
timestamp: 2026-10-24T00:00:00Z
---

# PR 124 Sass 构建修复

- 用户要求先更新 main 再修复 Dependabot PR；原 PR head 为 `84ddba9`，已合入 `origin/main@5eca151`，无冲突。
- 在 macOS、Node 24.19.0、pnpm 11.19.0 上通过 `pnpm install --frozen-lockfile` 复现 Vite 的 `RolldownError: [sass] undefined`。
- 直接调用 Sass 1.106.0 编译现有 `web/src/styles/webui.scss`，得到原始错误：`The empty string can't be represented as a CSS identifier.`。现有样式包含 `[class='']` 和 `[contenteditable='']` 等合法空值属性选择器。
- [Sass 1.106.1 发布说明](https://github.com/sass/dart-sass/releases/tag/1.106.1)明确修复空值属性选择器序列化崩溃。将 WebUI 的 Sass 最低版本更新到 `^1.106.1`，同步锁文件及 Vite/Vitest peer 快照；保持样式不变。
- 本地验证通过：`pnpm install --frozen-lockfile`（含全仓 build）、`pnpm typecheck`、`pnpm lint`、WebUI `test:ui`（35 项）。直接 Sass 编译输出 208835 字符 CSS。
- 跨平台 Node 24/26 的完整测试与发行验收以原 PR 新提交的 GitHub CI 为准；更新后仍需 reviewer 批准。
