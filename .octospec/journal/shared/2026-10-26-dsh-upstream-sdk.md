---
type: Journal
title: DSH 取消下游 SDK 补丁
description: 记录移除 DSH SDK 补丁、上游反馈、接入限制及验证结果。
tags: [adapter, dsh, sdk, testing]
timestamp: 2026-10-26T00:00:00Z
---

# 2026-10-26 DSH 取消下游 SDK 补丁

## 决定与实施

用户明确要求：提交上游反馈，在新 worktree 移除两个补丁；DSH 继续接入，不保证稳定性。以 `origin/main@8af8360` 建立分支 `codex/dsh-upstream-sdk`。

- 删除两个依赖补丁及 patchedDependencies，pnpm 原生更新锁文件；没有升级依赖版本。
- Adapter 只使用官方公开参数，继续调用 HarnessClient.close；不通过私有字段、另写客户端或进程代理补足 SDK 内部保证。
- 发行包继续收集官方 Client/Protocol JavaScript 与 MIT 许可，不分发补丁；离线安装验证检查没有 `.patch` 文件。
- 保留普通调用、工具投影、续聊、会话并发、取消、错误及 Runtime 自身容量预算回归。SDK 解析前预算、诊断上限和 lineage 上限不再列为 Runtime 保证；进程后代 fixture 由测试宿主负责清理。
- 原超大分片 initialize fixture 补齐 serverInfo，使其成为有效握手；原来被补丁提前拒绝的输入现由官方 SDK 正常解析。无换行数据按官方初始化超时失败。
- 公开文档和规则明确：DSH 为实验性接入；close 的成功范围是 SDK 直接子进程，不证明后代清空；其他 Adapter/Core 合同不变。

## 上游反馈

官方关闭 Issues，README 与 CONTRIBUTING 指定通过 Discussions 反馈，故创建 [#11031](https://github.com/deepseek-ai/deepseek-harness/discussions/11031)。正文说明项目、原始目标、边界、参考实现与验证范围，并关联已有 #1551/#1566。按用户追加要求嵌入两个完整 diff、四个扩展参数的接线与共享清理实现链接。

通过 GraphQL 读回并提取两个 diff，与 `git show 8af8360:patches/...` 原文比较，两者完全一致。补丁适用于 npm 0.2.1-rc.3 的产物，正文明确不声称可直接应用到上游 TypeScript 源码或已经上游发布。

## 验证

环境：macOS arm64、Node 24.19.0、pnpm 11.19.0。

- `pnpm install --lockfile-only --ignore-scripts` 和 `pnpm install --frozen-lockfile --ignore-scripts` 通过；锁文件无 patch_hash/patchedDependencies。
- `pnpm typecheck` 通过，包括全 workspace 构建。首次 lint 与新 worktree 构建并行时因类型产物尚未生成报错，构建结束后重跑 `pnpm lint` 通过。
- 首次 DSH 测试揭示原 fragmented fixture 缺失 serverInfo；补齐有效握手后，`pnpm test:suites` 全量通过：Node 1771 通过、40 跳过、0 失败；WebUI 35 通过。
- `pnpm docs:check` 通过：文档校验及 4 个示例测试。
- `node scripts/pack-release.mjs` 成功，`node scripts/verify-release.mjs dist/release/mininglamp-oss-octo-runtime-0.0.0.tgz` 通过，覆盖空缓存离线安装、DSH、公共 SDK 类型/组件、Kernel、Extra、CLI、卸载保留 Home。
- 改动代码的 Prettier 检查与 `git diff --check` 通过。

本轮仅运行 fixture 和本地离线发行验证，未重新调用真实 DSH 模型、IM 或 Windows。发行验收使用工作树的 dirty 构建，不宣称为 clean release。用户后续明确授权提交、推送和创建 PR；提交使用现有 Git 作者配置、英文说明及 Codex 协作 trailer，远端检查结果以 PR 为准。发布和合并未获授权。
