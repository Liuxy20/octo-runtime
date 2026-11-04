---
type: Validation
title: "Issue 304：Windows 集成验证"
description: "合并 Home/端点合同后的双 Node 专项、包外 SDK 与全量回归证据。"
tags: [startup, windows, testing, lifecycle]
timestamp: 2026-11-04T12:15:00Z
source: self
---

# Issue 304：Windows 集成验证

## 环境和源码

验证者为 GitHub 用户 Liuxy20，在本地 Codex 工作环境执行。Windows 11 企业版 x64 10.0.22621，PowerShell 7.6.5，普通用户；Node 24.19.0 / 26.13.0，pnpm 11.19.0。最终基线 `6fe5b5fc72084a0c2de91844a3606a9bc81e17d3` + 本分支未提交 diff，包含已合并 #306（#310）和 #303（#311）。未导入其他任务的未提交版本。

独立 checkout，每个 Node major 的 HOME/USERPROFILE/TEMP/TMP/APPDATA/LOCALAPPDATA 在 checkout 外专用目录，提前准备 AppData。依赖 frozen lockfile、ignore-scripts 安装并复用现有 store，锁文件未变。先 build/typecheck，再 lint/测试，没有与测试并行 clean build。真实 ACL 只修改临时文件，并在 finally 撤销本次 deny；未重置身份、修改线上 Bot 或结束无关进程。

## 修改前事实与修正

初始 `e7958065` 上，真实 ENOENT 经 AggregateError、ServiceInitializationError 后没有统一 diagnostic。原 CLI 仍保留 wrapper code 和单层 cause_code，但深层路径和 errno 没有进入可操作结构。该初始基线仅用于缺口对照，不能代替最终前置整合验收。

整合专项发现并修正：Extra 插件文件失败被前置通用 IO 包装误报 HOME_NOT_FOUND；Kernel 相对日志目录先被 Home 预算校验拦截；catalog 表格测试依赖单个空格。现在按实际责任边界分类，日志纯配置先校验，表格按语义读取。兼容映射见双语 startup-diagnostics 指南。

原型阶段还发现动态解释字段顺序不稳定、长而不完整的 URL scheme 触发正则回溯。已统一 context 顺序并使用前缀锚点，专项验证相等性、私密信息过滤和长输入耗时。

## 已执行检查

| 检查 | 结果 |
| --- | --- |
| `pnpm typecheck`，Node24 / Node26 | 两版本完整 build/typecheck 通过；最终代码额外 Node24 root tsc --noEmit 通过 |
| `pnpm lint` / `pnpm format:check` / `pnpm lint:names` | 通过；names 无 findings |
| `pnpm docs:check` | 36 paired pages、73 Markdown、20 JSON 示例；4 测试通过 |
| 三个手动专项 + 十个相关根测试文件（含 Playboard），串行文件执行 | Node24 / Node26 各 133 项：126 pass、7 平台 skip、0 fail/cancelled |
| WebUI `test:ui` | 两版本各 35 pass |
| Node26 `node scripts/pack-release.mjs` | 本地 tgz 通过，没有发布包 |
| tgz 包外 SDK，Node24 / Node26 | 两版本通过：只安装本地归档，空依赖缓存、npm --offline --engine-strict --ignore-scripts；严格 NodeNext 编译；Runtime 无 workspace 链接 |
| Node24 全量根测试与 protocol 测试，文件串行 | 2401 项：2316 pass、79 skip、6 fail；其中 4 项 Playboard 输出回归已修复并在最终双版本相关回归中通过，剩余 2 项经干净 main 对照确认既有；最终 CLI 修正后未重跑全量 |
| 知识 lint / 最终 diff、秘密检查 | 通过；644 个知识单元，无元数据/链接错误；最终 diff/新增文件检查无未处理发现 |

相关命令使用 `node --test --test-concurrency=1`，文件为 `test/manual/startup-diagnostics.test.js`（22 项）、`test/manual/runtime-home-306.test.mjs`、`test/manual/direct-kernel-endpoint-303.test.mjs`、`test/extras.test.js`、`test/host-sdk-lifecycle.test.js`、`test/native-service-architecture.test.js`、`test/cli-lifecycle.test.js`、`test/cli-lifecycle-races.test.js`、`test/cli-components.test.js`、`test/cli-foreground.test.js`、`test/kernel-invoke-lifecycle.test.js`、`test/module-loading.test.js`、`test/playboard.test.js`。

全量命令：`node --test --test-concurrency=1 test/*.test.js packages/octo-runtime-protocol/test/*.test.js`。与 `test:suites` 相同根/protocol 文件集合，加上述单独执行的 WebUI，没有修改默认选择器。

包外样例捕获真实 Extra initialize 读取失败，断言 rootCode=ENOENT、实际 path、component/phase、actions 和 cleanup.complete，并消费两个公开入口的类型、验证 Kernel 构造失败分支。npm 离线模式限制依赖安装；最终包外复验关闭 npm 版本通知；不将离线参数模式声明为物理断网实验。Runtime 诊断没有网络请求。

## 场景矩阵

| 场景 | 证据及结果 |
| --- | --- |
| 缺失文件、目录代替文件、JSON 无效 | 真实 filesystem/Host readJson/runCli；根码、中文空格 path、资源角色、建议在 SDK/文本/JSON 一致；旧 CLI 外码和退出码保留 |
| Extra IPC 前失败、initializer 和 disposer 同时失败 | 真实 Extra；主根因和实际 cleanup/pending 保留；外层 complete 不抹去内层 incomplete |
| Home 不存在、非目录、原生 ACL、长度、Windows 路径语法 | #306 原生与纯计算分别标识；平铺属性和 CLI startup/cleanup 兼容；失败不补建 Home 或日志根 |
| 已占用 named pipe、长 pipe 边界、独立 Extra | Windows 真机 IPC；冲突给所有权指导，生命周期与执行就绪分开 |
| #303 endpoint/Home 消费者/orphan inspect-ack | 已合并专项通过；Windows 真 IPC 与 POSIX 计算分开，没有旧端点迁移层 |
| executable 不存在 | 真实 spawn；保留 executable/errno，建议检查程序和 cwd，不建议用 mkdir 提供程序 |
| context_loading 无效、缺失模块、相对日志目录 | 公开构造/initialize/模块加载；configKey/module/path 进入共享 catalog 建议 |
| 未知、聚合、循环、恶意 getter | 注入；16 对象/六层有界，不输出异常正文、配置、环境、stderr |
| URL 私密信息、凭据赋值、控制字符、保存文案篡改 | 运行期随机 canary；文本/JSON 同样净化，回读解释/动作由 catalog 重建 |
| 最近失败、旧 code-only 日志 | 真实临时文件；组件/时间过滤，legacy code/cause_code 与共享诊断保留 |
| PID、execution_ready、business disconnected | 真实服务/IPC，三个事实独立，无 synthetic Run/模型请求 |
| 双语目录 | 全码与 English-first summary/action 对照；显式生成，不扩大 CI |

## 非门禁 live acceptance 与限制

Provider 相关回归使用仓库 fake fixtures；未调用真实模型、登录云端或连接 IM。macOS/Linux 原生 filesystem/socket、外部 Electron 和真实 Provider/IM 未运行，不能用 Windows 计算或 fake 结果替代。Node26 完成构建、相关回归、UI 和包外消费，未重复全部根测试。默认选择器、CI 和门禁未修改。

## 最终全量失败归属

全量发现的 4 项 Playboard 失败来自顶层 handler 把执行/交互与回收失败标成 startup，导致原有执行提示丢失。已改为仅对带启动事实的错误使用共享启动展示，保留执行域输出，最终两版本各 133 项相关回归均通过。另通过真实 runCli canary 复现并修正附带 logs 路径未净化的问题；文本和 JSON 都验证不含随机凭据。

剩余两项为 openclaw-runtime-connection 中 typed/untyped CLI restart：Windows 测试使用 child.kill(SIGTERM) 强制终止，第二次启动返回 ORPHAN_CLEANUP_INCOMPLETE。干净 main 6fe5b5fc 完整构建后同文件加 Playboard 对照 27 项、25 pass/2 fail；本分支同 OpenClaw 文件 6 项、4 pass/2 fail，错误码相同。未更改此不相关的强制结束/恢复合同，PR 如实报告，不能称全量全绿。

最终包外 SDK 两版本通过；原生服务四组 fixture 完整通过，结束后检查无本任务残留计划任务。

早期旧基线全量运行受机器并发负载影响，出现 native service 超时和 Playboard worker 被局部终止；旧原型串行长测曾被宿主会话中断。这些运行不计作最终通过依据。仅清理已核对属于本任务的临时测试树/计划任务，没有把清理当作产品修复。
