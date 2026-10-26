---
type: Task
title: Issue 58：实现与验证
description: Windows 控制台事件、执行结果与资源回收的兼容修复证据。
tags: [windows, testing, lifecycle]
timestamp: 2026-10-26T00:00:00Z
source: self
upstream: https://github.com/Mininglamp-OSS/octo-runtime/issues/58
---

# Issue 58：实现与验证

## 实现

- foreground、module-loading、Playboard 使用测试拥有的独立隐藏控制台投递 CTRL_C_EVENT，分别记录数字退出码与 signal；child.kill 的强杀另行验证。
- Windows worker 在父 IPC 连接期间由 Kernel 先取消并消费源终态，再经 EOF 排空关闭，避免共享控制台事件令 worker 提前退出；独立运行及父断连继续自行收尾。
- Playboard 在清理后选择结果，保留原执行错误/取消事实与清理错误；成功但清理失败仍拒绝。
- foreground 的 status 与原 start/restart 共用假 ServiceBackend，避免任务计划程序查询占用组件测试预算；真实 CLI、Kernel、worker、IPC 和全部退出后断言保持。
- module-loading 在最新基线并发中暴露通用 2 秒轮询先于 CLI ready 超时；改为等待真实 ready 与实际 PID，并由原有 15 秒总预算、提前退出和取消信号约束，关闭仍限定 7 秒。
- 控制台工具每个测试进程在忽略的独占构建缓存编译一次，避免临时 exe 系统映射影响 Home 删除；事件投递进程也等待退出。工具不进入产品构建或发行。

## 兼容边界

没有修改公共 SDK 方法、签名、导出、协议/schema、依赖或调用方代码。CLI/worker 所有权、Home/profile、文件保护及原有超时预算保持；不增加 blanket skip，不恢复 daemon。

## 验证

环境：Windows 11 Enterprise build 22621 x64、普通用户、PowerShell 5.1、Node 24.22.0、pnpm 11.19.0。使用 fake Provider 与隔离的 Home/profile/temp/cache。

基线为 `main@81284c9ed92066ce7cf34c1b84b608b9336279bf`，本次公共入口、SDK、协议/schema、配置与依赖 diff 为空。

- `pnpm install --frozen-lockfile --ignore-scripts`、`pnpm typecheck`（含构建）、`pnpm lint`、`pnpm lint:names`、`pnpm format:check` 通过；最后修改的 module-loading 文件单独复查格式通过。
- `node --test test/cli-foreground.test.js test/module-loading.test.js test/playboard.test.js`：35 项，33 通过、2 项原有跳过、0 失败，耗时 39.79 秒。
- foreground 耗时 5.53 秒，三次 CTRL_C_EVENT 均为 0/null，关闭 171/684/158 ms；module-loading 两次为 0/null，关闭 645/158 ms。
- Playboard CTRL_C_EVENT 为 130/null，关闭 514 ms；唯一 cancelled 终态、所属 PID 回收、临时目录清空及后续 completed 均通过。正常、pending、失败及两类清理故障覆盖通过。
- `pnpm test:suites` 默认全仓并发中的 foreground 通过，耗时 11.22 秒，低于原有 20 秒总预算；三次 CTRL_C_EVENT 为 0/null，关闭 340/1456/305 ms，最终状态及兄弟组件断言均执行。

仅执行 Windows 本地验证；macOS/Linux 未在本机运行。

## PR #183 评审修复

Jerry-Xin 指出本次新增的嵌套 TMPDIR 会让 macOS Unix socket 路径超长。仅修改两处 Playboard fixture：macOS 使用 `/tmp/ocp-*` 独占短目录，其余平台仍在测试 fixture 下分配；均注册清理，保留取消、终态、所属进程和空目录断言。SDK、产品代码和 CI 配置未修改。

Windows 三份完整相关文件复验为 33 通过、2 项原有跳过、0 失败（42.89 秒），Playboard 真实 CTRL_C_EVENT 返回 130/null，关闭 707 ms，后续调用成功。修改文件的 Prettier 与 `git diff --check` 通过；macOS 由更新后的 PR CI 验证，不以本机结果代替。

## 最新主线同步

评审修复提交 `5c2402c` 的[托管 CI](https://github.com/Mininglamp-OSS/octo-runtime/actions/runs/40280771279)六个平台组合与 CI Gate 均通过，包含原先失败的 macOS Node 24/26。

按用户要求 rebase 至 `main@79b11aadfb77ab1955d5f361d49d9615beb73414`，仅合并任务索引冲突并保留双方记录。本次产品与测试文件相对 rebase 前内容完全一致，没有新增 SDK 或产品改动。新基线 `pnpm typecheck`（含构建）通过；Windows 三份完整相关文件 33 通过、2 项原有跳过、0 失败（41.33 秒），`git diff --check` 通过。rebase 后的托管 CI 单独核对。

交付核对期间 main 再次更新，最终同步至 `a3be719cb189dffedf615fd34a7851e703f5038d`。冲突解决保留主线的 IPC 短路径实现、临时目录创建顺序、两项长 Unicode TMPDIR 测试及取消用例的长 TMPDIR；合并 #58 的主结果保留逻辑与严格取消断言，不修改上层 SDK 或主线端点策略。新基线构建与类型检查、冲突涉及文件的 ESLint/Prettier、`git diff --check` 通过；Windows 三份完整文件共 37 项，35 通过、2 项原有跳过、0 失败（48.76 秒），真实 Ctrl+C 返回 130/null、关闭 567 ms，后续调用成功。最终托管 CI 以本次推送重新运行的结果为准。
