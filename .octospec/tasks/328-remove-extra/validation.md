---
type: Validation
title: Issue 328 本地实施与验证
description: 记录独立仓库迁移、执行底座清理、实际归档验证与未验范围。
tags: [architecture, testing, installation]
timestamp: 2026-11-07T00:00:00Z
---

# 实施结果

基线 bf9ff6b599b0e325362698acd3cebd9ac1363467；分支 refactor/328-remove-extra，工作树未提交。先建立两仓新 worktree、完成 brief/context 和 95/100 规划评估，再实施。Gateway 结果另见独立仓库同 Issue 328 验收记录。评分是实施准备度，不是完成率。

删除 native/、三个 Extra 业务包、公开 /extra*、通用插件类型/加载/配置/发现/函数依赖与执行 scope。Runtime CLI、manifest、日志、诊断和发行闭包只保留执行底座；保留 Core/Kernel/Adapter/client、Home/身份和用户服务操作。协议 native 模式及 extra.* Context wire 语义保持。

Gateway 业务与适用回归迁入独立仓库；删除框架/WebUI/WeCom 专属测试、历史手动脚本和夹具，混合测试保留 Kernel/Adapter/通用命令执行断言。历史源码链接固定到迁移前 SHA，当前规则与历史事实分开。现有 CI 仅移除已删除功能的步骤/文件，不新增 job 或扩大必需测试范围。

# 实际验证

本机 macOS，Node 26.13.0。结果来自当前 dirty 工作树，不代表远端 CI 或稳定发行版本。

| 检查 | 结果 |
| --- | --- |
| build、tsc --noEmit、ESLint | 通过 |
| format:check、lint:names | 通过 |
| docs:check | 36 对页面、73 Markdown、12 JSON、8 Mermaid、12 Context 样例及 4 项执行示例通过 |
| 全量离线：node --test --test-concurrency=4 test/*.test.js packages/octo-runtime-protocol/test/*.test.js | 1612 项，1551 通过，61 按既有条件跳过，0 失败 |
| Grok 探针独立复验 | 28 项通过；此前默认高并发全量曾出现一次 2 秒版本探针超时，未放宽测试或改变 Provider 行为 |
| 冻结 lockfile | 使用真实 pnpm 11.19.0 检查通过，无锁文件漂移 |
| pack-release.mjs | runtime/client 两个自包含 0.0.0 本地归档生成 |
| verify-release.mjs | 空缓存离线 npm 全局安装、公开类型、SDK 执行/关闭、CLI Kernel、无 Extra/native 产物、卸载保留 Home 全部通过 |
| runtime-client-309 手动验收，OCTO_CLIENT_TEST_VERSION=0.0.0 | 11 项通过，含 npm/pnpm 包外类型、双包与迁移前 Kernel 互操作 |
| runtime-client-release-309 手动验收 | 24 项通过，含实际发行工作流的假 registry/附件恢复与 dry-run |
| 两仓 octospec lint 与 diff whitespace | 通过 |

本环境自带的 pnpm fallback 不能供手动验收按 Node 脚本调用；改用独占 /tmp/octo-328-tools 中的 pnpm 11.19.0 后完整复验通过。首次发行 SDK fixture 缺少显式 approval_policy，被 Kernel 拒绝；补齐合法输入后重跑通过。未使用源码别名或 workspace 链接代替包外检查。

# 自检与限制

按 brief 核对公开导出、生产依赖、CLI 命令、SDK 所有权、取消/清理及协议不变性，已知迁移问题均修复。此处是实施自检，不冒充独立 reviewer 审批。

未运行真实 IM/模型、桌面 renderer、Windows/Linux 原生服务、真实 macOS 服务安装或远端 CI；离线/fake/loopback 和打包验证不替代这些结果。用户 Home、身份、凭据和原 checkout 未迁移或删除。本次未提交、推送、创建 PR、合并或发布 npm。

# 用户追加：Runtime 文档清理

中英文入口和 Harness 文档去除内置 Extra 接入、共享渠道 Home 和旧代理配置链接；Context/会话、交互、IPC、Home、启动诊断去除已删除 API 及渠道业务实现细节。渠道职责指向独立仓库，历史验证按原日期保留；同步修复当前工程规则中的旧装配说明与失效锚点。协议 native 与 extra.* Context 保持原合同。

本次为文档修改，`pnpm run docs:check` 的 36 对页面、73 Markdown、12 JSON、8 Mermaid 块、12 Context 样例和 4 项执行示例通过，图未改。当前文档链接检查复用 `scripts/lib/developer-doc-links.mjs` 的完整审计器，对 Git tracked/untracked 中仍存在的文档检查链接与锚点，无错误；默认 `--scope current` 直接枚举 Git 索引，会将本次已删除但尚未提交的 7 篇旧业务包文档当作不存在的源文件报错，未因此恢复已删除文档或修改检查器。octospec lint、CONTRIBUTING 格式与 diff whitespace 检查通过。

只复核此次相关文档与例子，未重跑前述全量代码/发行验证或真实服务验收；此前的规划 95 分与实际验证仍分开记录。
