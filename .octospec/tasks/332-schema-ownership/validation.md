---
type: Validation
title: Issue 332 本地验收与交付记录
description: 记录 Schema 清理、双包资产、离线执行及 CI 范围核对的实际结果。
tags: [protocol, schema, validation, packaging]
---

# 验证对象

- 起点：最新 origin/main `86b3379cc9b426255dabc85c1450dfd530ac1c94`。
- M1 方案提交：`63486248`；M2 实现提交：`15d0b815`。
- 平台：macOS arm64，Node `24.22.2`，pnpm `11.19.0`。验证在 M2 提交前的实施工作树执行，构建来源为 M1 加 dirty 标记；没有将其称为 clean release，不发布 `0.0.332` 测试版本。
- 用户追加“不用管 workapp”：不修改或验证 Work App，不将其兼容性作为验收前提。PR 明确披露删除接口。

## 已通过

| 检查 | 命令/结果 |
| --- | --- |
| 依赖 | `pnpm install --frozen-lockfile --ignore-scripts`，674 包安装成功，lockfile 无变化 |
| 类型/构建 | `pnpm typecheck`，全部 workspace 和 public 类型检查通过 |
| 代码/命名/格式 | `pnpm lint`、`pnpm lint:names`、`pnpm format:check` 全部通过；手动脚本后续修改再次 Prettier 检查通过 |
| 文档 | `pnpm docs:check`：37 对双语页面、75 篇 Markdown、8 个 JSON、6 个 Mermaid、12 个 Context 示例及 4 项运行示例通过 |
| 全量离线 | `pnpm test:suites`：1607 项，1546 通过、61 条既有条件跳过、0 失败 |
| 针对性 | protocol/run/object-material/notification 37 项通过 |
| 生成一致性 | 重新运行 `node packages/octo-runtime-protocol/scripts/gen-types.mjs` 后 `git diff --exit-code -- packages/octo-runtime-protocol/src/generated/protocol-types.ts` 通过 |
| Schema/目录 | 两个 Draft-07 Schema 与全部 96 个保留定义可编译；保留定义逐项 JSON 结构与基线一致；7 份 fixtures 与基线逐字节一致 |
| 打包 | `node scripts/pack-release.mjs --version 0.0.332` 生成 runtime/client 两份本地 tgz，未发布 |
| 清理专项 | `node --test test/manual/schema-ownership-332.test.mjs`：6/6，覆盖目录、删除组/引用、生成常量、原 native 样本、公开路径及两份实际 tgz 的资产集合 |
| Client 包外 | `OCTO_CLIENT_TEST_VERSION=0.0.332 node --test test/manual/runtime-client-309.test.mjs`：11/11；npm/pnpm 单独/双包离线安装、公开类型、执行/清理、保留 fixture 导入、behavior 导出拒绝及旧 IPC 拒绝 |
| Runtime 包外 | `node scripts/verify-release.mjs dist/release/mininglamp-oss-octo-runtime-0.0.332.tgz`：离线全局安装、CLI/SDK/文档示例、本机 Kernel、fake Provider 执行、恢复与卸载保留 Home 通过 |
| OKF | 使用独立临时 venv 安装 PyYAML 后，`.octospec/scripts/lint.py` 通过；未修改项目运行依赖 |
| Diff | `git diff --check` 通过；相对基线 `.github/`、lockfile diff 均为空；根 test/test:suites 默认选择不变 |

Client 压缩归档约 112542 字节、解包约 518903 字节、82 文件，依赖闭包仅包含共享 protocol。完整包和 client 中各协议资产只包含两份 Schema 及刻意保留的一份 IPC conformance fixture；无 behavior 和其余内部 fixtures。公开导入路径不变，磁盘位置已分离。

## 验证中发现并修复

1. 新文档最初链接 README fragment，既有 docs 检查器禁止 fragment。改为整页链接后完整 docs:check 通过，未改变检查器或扩大检查范围。
2. 历史 client 手动脚本将 `ipc_version: 2` 作为不支持版本，且期待与 IPC v1 的旧 Kernel 互操作，与当前 v2 合同矛盾。改为以 v1 验证明确拒绝。真实提取并构建旧 `de3ff37a` Kernel，安装当前 tgz，调用 submit 得到 `KERNEL_IPC_VERSION_UNSUPPORTED`；独立断言旧服务仍就绪、版本为 1、Provider 调用数为 0。没有弱化版本拒绝或恢复旧协议兼容。

## 审查

独立代理检查了 Schema 引用图、96 个保留定义、生成常量、实际 tgz、导出、CI/default 测试差异和文档清单；首轮与修复后复审均无未关闭 actionable finding。复审特别核对旧 Kernel 测试确实证明拒绝且零执行，并未把执行失败算作互操作成功。细节见 review.md。

## CI 与远端交付边界

2026-11-09 读取 main 分支保护：必需状态为 `CI Gate`，strict=true，至少一位批准且过时批准自动失效，enforce_admins=true。本次不修改保护规则、不自批、不绕过。

基线实际检查包括四个 Ubuntu/macOS × Node 24/26 Build/test/package、两个 Windows Node 24/26 package verification、CI Gate、组织 Secret Scan/label 及 main 的 release draft。基线 main 上一个 macOS26 检查曾取消导致 Gate 失败；这不是本地清理的验收结果，PR 检查单独等待。本次 workflow diff 为空；新专项只在 test/manual 显式运行，无新增 Gate 或默认测试开关。

PR 创建后的 URL、实际检查及合并状态写入后续交付节；在远端状态确认前不声称已进入 main。

## 未验范围

没有真实模型 turn、IM 或外部应用验收；Windows/Linux 原生服务未在本机实测。离线 fake Provider 结果不证明这些环境。实际输入/权限/Provider/恢复语义和 96 个保留数据定义没有变化；因此本次本地验收集中于合同、目录和双包发行，不恢复已删除的 native SDK 工具链。
