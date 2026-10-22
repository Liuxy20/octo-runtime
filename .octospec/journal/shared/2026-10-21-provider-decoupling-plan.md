---
type: Journal
title: Issue 85：Adapter/Extra 双模式载入方案与文档
description: 记录依赖图、SDK 原生装配、CLI 双清单及解析锚点；本轮仅建立方案与架构文档。
tags: [architecture, adapter, extra, installation, runtime]
timestamp: 2026-10-21T00:00:00Z
---

# 调查结果

本页保留规划阶段证据。用户后续已授权实施，产品结果和验收见[实施记录](2026-10-21-provider-decoupling-implementation.md)。

读取 [Issue #85](https://github.com/Mininglamp-OSS/octo-runtime/issues/85)，从最新 `origin/main@d064cfe78f6818d3c451ecf803a280245f4b0496` 创建本地 `spec/85-provider-decoupling` 分支及 `octo-runtime-issue-85` worktree。桌面 worktree 工具因当前项目目录为非 Git 父目录而拒绝创建，使用目标仓库原生 `git worktree add` 完成；该 checkout 不是桌面托管 worktree，未改变其他工作区。

用户补充明确默认发布 App 继续全量，FDE 实际只拷贝部分 Adapter。因此方案收敛为内部依赖方向和宿主交付闭包，不拆分 npm 产品，不要求发布 private 包。

静态读取 workspace package.json 并遍历 dependencies 得到：Core 仅依赖 Adapter SDK 和 Protocol；Kernel 直接依赖 12 个具体 Provider，Host SDK 经 Kernel 继承全目录。假设移除这 12 条边，FDE 的 OpenClaw/Codex/CC 示例仅需所选三个 Adapter、公共框架，以及 OpenClaw 的 ws；Host SDK 和 Extra 只在宿主使用时加入。ACP 系列选择需带其共享实现，不能按目录名盲删。这是静态推导，不是改造后独立产物已通过。

代码核对还发现：runner 仅加载显式 manifest，但裸包名在 runner 位置解析；SDK 已有自有 worker/serveWorker 和原生 createKernelService，主要不需增加服务 API。首次 worker list 经 describe 触发实际 probe，因此“启动但不主动调用 probe”并不能证明未探测真实 Provider。最初的纯注册握手建议已撤回：本任务保持已选 Adapter 的 probe，仅保证未选模块不导入、不探测。

已建立[简报](../../tasks/85-provider-decoupling/brief.md)、[设计](../../tasks/85-provider-decoupling/design.md)、[实施与验收](../../tasks/85-provider-decoupling/acceptance.md)和 context 阅读记录。CLI resolver 方案选用纯 JS 的 import-meta-resolve@4.2.0；已核对 Node 官方 ESM 解析说明与项目文档，只读查询 npm 元数据，未安装或改 lockfile，实际包外解析仍待 M0 验证。

## 用户后续明确的范围

- SDK，包括 Electron App：Adapter 和 Extra 均原生 import，由宿主接入层组装；不要求、读取、复制或生成任何临时或永久 manifest。
- CLI：现有 default_adapters.json 并入 apps/cli/src/manifest.json；再读取 Runtime Home 下的 manifest.json，默认 ~/.octo-runtime/manifest.json。两份均有 adapters 和 extras，跟随 --home，不推广到 SDK。
- 每个合并条目保留原 manifest 文件作为相对路径和裸包名的解析锚点；同名内置优先，忽略项不执行模块代码。显式 --manifest 保留完整替换。
- Extra 清单只声明模块；配置、凭据、enabled 与自启仍由原有配置和命令管理。旧 config.module 与新目录的迁移需要明确报错和说明，不自动修改用户 Home。
- FDE 如何复制代码、处理依赖由业务方决定，不交付 FDE 拷贝或打包工具；默认发行继续全量。原静态闭包分析仅解释耦合事实。
- 新增[中文](../../../docs/zh-CN/concepts/module-loading.md)和[英文](../../../docs/en/concepts/module-loading.md)说明，并同步[整体架构约束](../../rules/architecture.md#cli-与-sdk-的-adapterextra-装配约束)、根架构入口及 Extra 规则；统一清单明确标注待实现。

## 验证范围

本轮静态断言通过：Core 无具体 Provider；Host SDK 的当前闭包包含 12 个具体 Provider；仅在内存中模拟去除 Kernel 的这 12 条依赖后，带 Host SDK 的 FDE 示例闭包为 8 个内部包与外部 ws，具体 Provider 严格等于三个选项。此结果不含候选 resolver，不代表运行时产物验证。

文档检查使用 `uv run --with pyyaml python .octospec/scripts/lint.py`。系统 Python 缺少 PyYAML，改用仓库说明的 uv 方式后，完整检查只报告 `已退出的文档目录仍存在: docs`；在原仓干净 main 运行同一命令复现相同错误。检查器的其他 OKF、规则索引、本地链接项目未报告错误；没有修改既有检查脚本或删除 docs 来消除告警。

worktree 未安装 node_modules，因此只在内存中将现有 scripts/check-developer-docs.mjs 的依赖入口指向原仓已安装依赖、将 root 指向本 worktree 后执行，不修改检查器或工作区。检查通过：17 对双语页面、35 份 Markdown、本地链接、16 个 JSON 示例、16 个 Mermaid 块及 12 类内置 Context 示例。中英文非 Mermaid 代码块逐字一致。完整 pnpm docs:check 的既有 TypeScript 样例编译和 docs/checks 测试未运行；本轮未改产品代码或已有可执行样例。`git diff --check` 与 7 个新增文件的换行/尾空白检查通过。

没有改产品代码、安装候选 resolver、构建 FDE 产物、运行模型/IM、提交、推送、创建 PR 或发布。产品验收 A01-A17 全部待执行。
