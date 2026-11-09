---
type: Validation
title: client-release-version 实际验证
description: 记录成功检查和未完成的外部发布条件。
tags: [validation, release]
---

# 实测与边界

2026-11-08：Runtime 发布器本来就接受 1.1.12，源 manifest 为 0.0.0，未发现强制 2.0.0 的产品代码；本分支修正工程目录中 client 2.x 的错误约束，并在架构规则与双语维护文档明确 npm/IPC 版本独立。历史候选测试记录保留，其 2.0.0 不再是发行要求。无兼容层、无接口回退。

pnpm install --offline --frozen-lockfile（包含完整 build）通过；node scripts/pack-release.mjs --version 1.1.12 通过，完整 Runtime 与独立 client 归档内 version 都为 1.1.12。docs:check 的类型/文档和 4 项真实本地 Kernel 示例通过，Octospec lint 与 diff --check 通过。Gateway 独立版本分支使用这些归档完成 572 通过/1 跳过回归与三归档消费者验证。

这是本地候选验证，不是 npm 发布。未创建 tag、未改已有 draft release、未推送 npm。未来正式发行以 main 上的 approved commit/tag 为来源，并由 Gateway 刷新正式锁。

## PR 330 评审修正（2026-11-09）

基于 PR head ba4d2bed，本地修正索引，使当前发行入口直接指向本任务；agent-env-invocation 验证页顶部及 npm 候选章节明确标记历史 2.0.0/^2.0.0 约定已被取代，并链接当前决定与验证边界。保留原实测版本，不将历史测试改写成 1.1.12 的证据。

- 离线 frozen install（ignore-scripts）及 `pnpm run build` 通过。
- `pnpm run docs:check` 通过：37 对页面、75 Markdown、8 JSON、6 Mermaid、12 内置 Context 样例，以及 4 项可执行示例。
- `uv run --with pyyaml python .octospec/scripts/lint.py` 与 `git diff --check` 通过。
- 相对最新 main 的 PR workflow diff 为空；本轮未修改 CI、默认测试范围或运行时代码。
- 远端原 CI 的 Windows Node 26 job 在安装依赖阶段被取消，后续验证未执行并导致 CI Gate 失败；本地结果不代替该平台检查。本轮未重新打包或发布。
- 用户追加授权检查同类问题并 commit/push。检索当前文档、规则、指南、历史任务及发行脚本，未发现其他将 npm 2.x 作为 Runtime/client 当前发行要求的内容；其余 2.0.0 引用属于 OpenCode、Grok 或其他依赖版本。历史候选实测继续保留，不修改为新版本实测。提交推送使用英文消息，保留 Git 配置身份及 Codex trailer。

## 同步最新 main 后复验（2026-11-09）

用户授权更新代码、提交推送并请求 yujiawei 复审。合入 main@4276f6d3，仅知识目录冲突：同时保留 CLI 命令平铺入口和当前 1.1.12 发行入口，未恢复旧 client 2.x 约定。

离线 frozen install（ignore-scripts）、`pnpm run build`、`pnpm run docs:check`（4 项执行示例）和 Octospec lint（694 个 OKF 单元、20 条规则、3280 个本地链接）通过。diff 检查通过，相对目标 main 的 workflow diff 为空；实际检查列表仍为既有构建/打包、依赖审查、历史检查、标签、标题、密钥扫描、CI Gate 和 code-review。本轮不新增必需检查；远端新提交的 CI 与人工 review 结果须单独确认。
