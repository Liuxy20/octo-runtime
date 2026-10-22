---
type: Task
title: Issue 85：Adapter/Extra 按需装配实施与本地验收
description: 记录 SDK 原生导入、CLI 双清单加载、迁移边界及实际发行包验证证据。
tags: [architecture, adapter, extra, installation, testing]
status: locally-validated
timestamp: 2026-10-21T00:00:00Z
---

# 实施结果

用户在规划后授权本 worktree 实施。基线为 origin/main@d064cfe，分支 spec/85-provider-decoupling。未执行 Git 提交、推送、远端 issue/PR 更新或发布。

以上为首次实施阶段记录。用户随后授权本地审查、提交 PR 并合入 main；已更新到 main@318b0f2，交付分支改为 fix/85-provider-decoupling。[审查记录](review.md)包含发现、修复、复审和 GitHub 保护约束。

Kernel 移除全部 12 个具体 Adapter 依赖，完整目录由 CLI 持有。Core、Kernel、Host SDK 的生产依赖闭包没有具体 Adapter/Extra。默认单一发行仍包含 12 个 Adapter 和三个 Extra，不改变业务方自行复制代码并管理依赖的责任。

SDK 沿用原生 import 与宿主装配。Kernel 服务和 Extra 服务在调用进程直接创建；宿主自己的 worker 原生 import 并注册所选 Adapter。没有引入 startOwnedKernel、外部 Node 顶层服务装配器或任何临时/永久 manifest 要求。内部执行 worker 保留既有隔离和恢复职责。

CLI 将 default_adapters.json 迁为唯一内置 manifest.json，包含 adapters/extras；追加选定 Runtime Home 的 manifest.json。合并时内置优先，忽略项不解析或导入。共享 Adapter SDK 的 ./module-manifest 使用锁定的 import-meta-resolve@4.2.0，按每项原始来源解析裸包及相对路径。CLI 将已解析 Adapter 快照通过现有 Node IPC 的 kernel.adapters 消息交给内置 runner，恢复沿用快照。Extra 仅在运行目标且 enabled 时解析和导入。

Extra config.json 保留业务配置和 enabled，允许省略 module。旧 module 存在时必须与有效清单文本一致；缺声明报 EXTRA_MANIFEST_DECLARATION_REQUIRED，不一致报 EXTRA_MODULE_MIGRATION_REQUIRED。迁移由用户显式完成，Runtime 不重写 Home。配置读取、停止和部署修复命令无需启动模块。

## 验收证据

| ID | 结果与证据 |
| --- | --- |
| A01 | 通过。module-loading.test.js 检查框架生产依赖闭包，native-module-selection.test.js 复制实际中立生产闭包后运行；CLI 持有完整具体模块依赖。 |
| A02 | 通过。包外 SDK fixture 原生 worker import/serveWorker；Kernel PID 等于调用进程 PID，无 CLI 包与 manifest。 |
| A03 | 通过。同一 fixture 原生 import 所选 Extra，直接传入宿主函数依赖；Extra PID 等于调用进程 PID。 |
| A04 | 通过。统一清单 12+3，构建复制及 Playboard 使用同一来源；实际发行验证旧默认文件缺席。 |
| A05 | 通过。指定 Home 的缺失、追加、损坏与显式替换回归；沿用 CLI Home 参数和平台默认逻辑。 |
| A06 | 通过。双命名空间、内置冲突诊断及单文件重复项拒绝；忽略项即使包缺失也不解析。 |
| A07 | 通过。两个隔离 node_modules 同名包来自各自 manifest，保留来源；不从 runner 或仓库兜底。 |
| A08 | 本机通过。scope/subpath/exports、import 分支、特殊字符及 file URL 回归；原生 Windows 盘符/UNC 测试按平台跳过，未做 Windows 真机验收。 |
| A09 | 通过。显式文件完整覆盖内置/Home，旧 Adapter-only 文件补空 extras；空数组可启动空 Kernel。 |
| A10 | 通过。CLI 未启动 Extra 缺包、禁用 Extra 缺包都不影响目标服务启动；配置保留原位置。 |
| A11 | 通过。无 module 新配置、一致旧配置可用；不一致和缺声明均明确失败，原配置不被重写。 |
| A12 | 通过。本次 type 不符与缺包隔离，加上既有 runner 坏导出、工厂、协议、重复注册、清理及 CLI 启停回归；未增加真实 Provider 探测。 |
| A13 | 通过。包外生产闭包没有 CLI 和具体模块包，宿主只复制选定 fake Adapter/Extra，完成调用、取消与清理。 |
| A14 | 通过。启动后修改清单并终止 worker，恢复仍只有旧快照 Adapter，顶层服务仍在调用 PID。 |
| A15 | 通过。实际 tgz 在仓库外离线安装，默认 12 个 Adapter 可加载，三个 Extra 入口与 WebUI 资源完整，卸载保留 Home。 |
| A16 | 通过。隔离 SDK fixture strict 编译，发行 public types 使用 skipLibCheck=false；原生调用、取消、独立关闭和既有资源归属回归通过。 |
| A17 | 通过。双语 17 对页面、JSON、Mermaid、Context 示例及 TS/行为示例检查通过；整体架构、Extra 和 Adapter 约束已对齐。 |

主要新增测试：[模块选择与双来源解析](../../../test/module-loading.test.js)、[隔离原生 SDK](../../../test/native-module-selection.test.js)、[宿主 fixture](../../../test/fixtures/native-loading-host.mts)。实际发行检查：[verify-release.mjs](../../../scripts/verify-release.mjs)。

## 执行检查

| 命令 | 本地结果 |
| --- | --- |
| pnpm build / pnpm typecheck | 通过，包括跨 workspace 构建与公共声明。 |
| pnpm lint / pnpm lint:names | 通过。 |
| pnpm test:suites | 通过。UI 35 项；Node 1457 项中 1447 通过、10 跳过、0 失败。 |
| pnpm docs:check | 通过。17 对页面、35 Markdown、18 JSON、16 Mermaid、12 Context；TS 与四项行为测试通过。 |
| node scripts/pack-release.mjs | 通过，生成本地 dist/release/mininglamp-oss-octo-runtime-0.0.0.tgz。 |
| node scripts/verify-release.mjs dist/release/mininglamp-oss-octo-runtime-0.0.0.tgz | 通过。离线安装、public types、内置 Extra/资源、原生 Kernel、独立 Extra、Host store、CLI Kernel、卸载保留 Home。 |
| git diff --check | 通过。 |
| uv run --with pyyaml python .octospec/scripts/lint.py | 仍仅有 main 基线冲突：检查器禁止已恢复的根 docs 目录；没有新增知识链接错误。 |

## 验证边界

本地环境为 macOS、Node 24.19.0。未运行真实模型或 IM、外部 Electron App、Windows/Linux 原生服务真机验收，也未构建业务 FDE 产物。包外 fake fixture 证明装配机制与依赖边界，不代替业务集成验收。自动化测试通过不代表所有真实 Provider 在当前环境已安装或可用；已选 Adapter 的既有 probe/握手语义保持。
