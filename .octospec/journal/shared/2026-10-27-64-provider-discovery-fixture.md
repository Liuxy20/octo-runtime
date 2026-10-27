---
type: Journal
title: "Issue 64：Windows discovery 夹具修复与验证"
description: "替换 POSIX-only 测试夹具，保留真实 probe 路径与 SDK 合同。"
tags: [testing, adapter]
timestamp: 2026-10-27T09:00:00Z
source: self
---

# Issue 64：Windows discovery 夹具修复与验证

## 变更与范围

基线 main `f421f0ecbff80f3bec44302caba641d62a1bc6ac`，分支 `fix/64-windows-discovery-fixture`；见[任务](../../tasks/64-provider-discovery-fixture/brief.md)。Windows 使用系统 C# 编译器构建测试专用可执行程序，缓存只在忽略的 `.cache/test-support`；实际执行临时目录副本。POSIX 保留 shell fixture。两种夹具均仅接受一个 --version 参数。

原有 probe/describe、负向探测和元数据形状断言全部保留；新增真实 stdout、多余参数拒绝和空格中文路径验证。finally 仍严格删除测试临时目录，删除错误不会被忽略。未修改产品源码、公共签名、导出、配置、依赖和发行文件集合。#83/#84 不在本次范围。

## 原生 Windows 验证

Windows 11 企业版 10.0.22621 x64，PowerShell 5.1、普通用户；明确使用本机 Node 24.22.0 与 pnpm 11.19.0。依赖冻结安装和同提交构建成功；Home/profile/temp/cache 与真实实例隔离。未调用真实 Provider 或 Bot，未安装系统服务。

- 修复前：Issue focused 命令失败，原整文件 1 通过、1 失败；version 为 null。直接启动原 shell 夹具返回 ENOENT。
- 修复后：Issue focused 命令通过；`node --test test/provider-discovery.test.js` 为 2 通过、0 失败、0 跳过。
- `node --test test/provider-discovery.test.js test/windows-review-regressions.test.js`：22 通过、0 失败、0 跳过。
- `pnpm format:check`、`pnpm lint`、`pnpm lint:names` 通过；复用冻结安装 prepare 已完成的 workspace 构建，根 `tsc -p tsconfig.json --noEmit` 通过。
- 测试临时目录无 Provider 夹具残留；仅测试构建缓存保留编译产物。

原始日志保留在本机仓库外 `issue64-diagnostics-20261027`：`full-file.log`、`fixed-focused.log`、`fixed-full-file.log`、`fixed-related.log`、`fixed-format-all.log`、`fixed-lint.log`、`fixed-names.log`、`fixed-types.log`。源码原测试与修复后测试分别记录，不将仓库外诊断对照称为修复。

## 限制与规则

用户要求逐条复核 Issue 正文和补充评论后，重新运行原 focused、整文件和相关 Windows 回归：分别通过、2/2 通过、22/22 通过，均无跳过。临时夹具目录残留为 0；`git diff --exit-code -- packages apps public package.json pnpm-lock.yaml` 为 0，确认产品实现、SDK 接口、schema、依赖和发行集合无差异。日志为 `reverify-focused.log`、`reverify-full-file.log`、`reverify-related.log`，脚本为 `reverify.ps1`，均位于上述仓库外证据目录。

Issue 正文 F23 与补充评论 F-031 指向同一个 Windows 夹具根因，本地修复及 Windows 场景已满足。用户随后确认本任务只修复 Windows，macOS/Linux 本地实测不作为交付前置条件；POSIX 分支保留，不宣称已有对应平台的运行证据。

macOS/Linux 原生执行及全量测试未运行，不以 Windows 结果替代跨平台验收。测试原生夹具和产品依赖隔离已有工程规则覆盖，本次无需新增规则。用户已授权提交、推送并创建关联 #64 的 PR；使用 Closes #64 与 Refs #14，保留总验收 Issue。

## PR 207 更新基线

按用户要求 rebase 到 `main@ae7835c168e1e138287c012a6c87517dd2874a5d`。唯一冲突位于 `.octospec/index.md` 的当前任务目录，同时保留 main 新增的 CLI/Extra 命令任务与本 Issue 64 条目；测试夹具实现没有冲突或行为变更。

新基线执行冻结依赖安装与 workspace 构建、根类型检查、全仓格式、lint 和命名检查通过；`node --test test/provider-discovery.test.js test/windows-review-regressions.test.js` 再次 22 通过、0 失败、0 跳过。日志为仓库外同一证据目录的 `rebase-install.log`、`rebase-types.log`、`rebase-format.log`、`rebase-lint.log`、`rebase-names.log`、`rebase-related.log`。
