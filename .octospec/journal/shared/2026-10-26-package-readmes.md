---
type: Journal
title: 包导航与 25 个子包双语 README
description: 按真实包分层导航，统一五句用途说明并核对源码、链接和示例。
tags: [documentation, architecture, adapter, extra, testing]
timestamp: 2026-10-26T00:00:00Z
---

# 范围与结果

本记录描述 README 整理阶段；用户随后追加的代码删除及其验证单独记录在[删除外部组件启动器](2026-10-26-remove-native-component.md)。

基线为 `origin/main@87291ca`，独立 worktree 分支 `codex/core-package-readmes`。任务见[需求与合同](../../tasks/15-core-package-readmes/brief.md)，仅以 `Refs #15` 关联，不关闭 issue；未提交、推送或创建 PR。

整理 packages 总导航及全部 25 个子包，共 26 对、52 页。默认入口为英文 `README.md`，中文为 `README.zh.md`，双向链接。每个子包开头用五句话说明用途、输入、输出、存在原因及调用方或所有权，具体协议和生命周期放在后续段落。

导航按公共协议、Adapter、Executor Core、Executor Kernel、Extra 业务、Host SDK 装配和 CLI 部署辅助分层，各表每行一个实际包。15 个具体 Adapter 分别说明用途，不用通配合并行；Host SDK 的 Home、身份、依赖和生命周期功能合并在该包内说明。删除与当前包导航无关的 worker-access 外部目录说明。

对照 package.json、公开门面和源码核实 native/canonical、ACP 传输与事件映射、worker 监督、Extra 装配、动态 Context、存储所有权及资源回收。不改包名、代码、接口、配置 Schema 或发行内容。保留 DSH 上游 SDK 的实验性、内存及后代清理限制；不以文档扩大 Provider 支持范围。

# 验证

- `pnpm build` 通过，覆盖 workspace 包、CLI 和公开 SDK 门面。WebUI 构建有已有的资源体积及依赖模块指令警告，没有构建失败。
- `pnpm docs:check` 通过：17 对开发者文档、35 个 Markdown 页面、18 个 JSON 示例、16 个 Mermaid 块、12 个 Context 示例及 4 个测试。
- 使用 Markdown AST 一次性检查本轮 52 页：454 个本地链接有效，双语互链及代码块一致。两个导航均包含全部 25 个包，每条表格数据行的首列都是实际包名。
- 使用 TypeScript 严格模式、NodeNext 和已构建公开 SDK 类型，对 3 个 README TypeScript 示例进行虚拟入口检查，通过；未向仓库添加测试脚本或生成示例文件。
- 使用 `Intl.Segmenter` 检查 50 个子包首页用途段落，中英文均为五句。
- Markdown 使用 Prettier 格式化，`git diff --check` 通过。
- 本轮仅修改文档，不调用真实 Provider、不修改真实 IM 配置、不注册系统服务；上述检查不声明新的线上联调或平台验收。

# 已有检查限制

系统 Python 缺少 PyYAML，改用 `uv run --with pyyaml python .octospec/scripts/lint.py`。OKF 全仓检查仍报告以下 7 处缺少 frontmatter；已逐一用 `git show 87291ca:<path>` 确认基线同样缺失，本轮新建 OKF 文档具有 frontmatter，本轮链接无新增错误。

- `.octospec/tasks/dsh-upstream-sdk/brief.md`
- `.octospec/tasks/dsh-upstream-sdk/upstream-feedback.md`
- `.octospec/tasks/systemd-directive-paths/brief.md`
- `.octospec/tasks/systemd-directive-paths/review.md`
- `.octospec/journal/shared/2026-10-22-systemd-directive-paths.md`
- `.octospec/journal/shared/2026-10-24-124-sass-build-fix.md`
- `.octospec/journal/shared/2026-10-26-dsh-upstream-sdk.md`
