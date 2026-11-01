---
type: Task
title: CLI Extra 测试使用平台临时目录
description: 修复硬编码 /tmp 使 Windows 在执行业务断言前失败的问题，保留 Home 隔离和清理合同。
tags: [testing, extra]
slug: 161-extra-platform-temp
source: self
upstream: https://github.com/Mininglamp-OSS/octo-runtime/issues/161
---

# 目标

让 `test/cli-extra-directory.test.js` 在系统临时目录下创建独占夹具，不依赖盘根存在 `tmp` 目录，使支持平台能够执行既有 CLI Extra Home 隔离断言。

任务为 Loop `ORT-59` / GitHub #161。本规格依据分诊评论 `7d648174-9835-4531-94b6-2d7273fa42cc` 及用户「开始写 spec」请求；用户随后以「开始实施」认可该规格，当前实现及验证结果见[验证记录](validation.md)。

## 基线与开发位置

- 规格初始基线：`f7384fcbc63b3392af6972c0da6e756bee80ac60`；首次实施基线：`c35b261b31573bc2f08a16eeced12f18705b2560`；最终交付复验基线：`28c3ffa2ef685e14ac58d57c2788c9d07b92471c`。
- 分支：`fix/161-extra-platform-temp`。
- Worktree：`/Users/lvsijia/github.com/Mininglamp-OSS/octo-runtime-issue-161`。
- 当前开发环境为 macOS，分诊时 Node 为 `v24.22.2`；实现时记录实际版本。
- 实施时 fetch 并快进到最新主线，合入 6 个提交；目标测试在这些提交中无变化。
- 用户随后要求更新最新 main，专用分支再快进 5 个提交至 `88fe84ef`，保留本地修复并重新构建验证；目标测试在本轮上游提交中仍无变化。
- 用户再次要求最新代码实施，继续快进一个提交至 `42102c60`，目标修复无变化；构建、类型、lint、定向测试与清理验证重新通过。
- 用户「更新代码 提交PR」明确授权提交、推送及创建 PR；同步 2 个主线提交至 `28c3ffa2` 后重跑本地检查及两轴审查，结果见验证记录。Windows 未验限制继续明确记录于 PR，不自动合并。

## 产品意图与责任边界

- 业务目标：恢复有效的跨平台测试覆盖，避免机器目录布局影响测试启动。
- 决定权：测试维护方选择夹具位置；Node `tmpdir()` 解析当前平台临时目录。
- 显式输入：测试为两个独立 Home 分别写入 `value: 1` 和 `value: 2`，通过 `--home` 调用现有 CLI。
- 合同内动作：创建独占临时根目录、调用现有 `extraset` / `extraget`、断言配置、删除所属夹具。
- 越界动作：改变 CLI 配置存储规则、SDK 接入方式、Extra 生命周期，或创建机器级 `/tmp` 规避问题。
- 其他接入产品：无接口、默认值或依赖变化。

## 关键合同与实现范围

1. 从 `node:os` 引入 `tmpdir`，复用现有 `node:path` 的 `join`，将创建语句改为 `await mkdtemp(join(tmpdir(), "extra-home-"))`。
2. 不手动拼接路径分隔符，不把临时根目录写成固定 POSIX 或 Windows 路径。系统临时父目录需存在且可写；无权限或无效环境配置的 IO 错误如实失败，不自动创建机器目录。
3. `mkdtemp` 成功后立即保留现有 `t.after(() => rm(home, { recursive: true, force: true }))`。其 Promise 交给测试框架等待；断言失败也执行清理，清理失败不得吞掉。创建失败时尚无本测试取得的目录，无需清理不存在的夹具。
4. 保留测试名称、两个不同子 Home、现有 CLI 调用与 `assert.deepEqual(saved.config, { value })`。不得跳过测试、mock 掉 CLI 配置读写或降低断言来取得通过。
5. 代码改动限于 `test/cli-extra-directory.test.js` 的临时路径；本任务可增补规格、读取清单和实际验证记录。无关未使用 import 和历史变量无需顺手清理。

## 范围外

- #63 的模拟 Unix 后端路径问题及其他文件的夹具批量改造。
- 产品存储实现、公开 API、Schema、依赖或包管理器版本变更。
- 新增 workflow、job、矩阵、触发条件、必需状态、CI Gate 或默认专项测试开关。
- 规格命令不授权实现、提交、推送、创建 PR、合并或发布；后续仍按阶段和已有授权执行。GitHub issue/PR 与 commit message 按用户 OSS 约定使用英文。

## 验收标准

| 编号 | 场景 | 可观察的通过条件 |
| --- | --- | --- |
| A1 | 源码路径 | 使用 `join(tmpdir(), "extra-home-")`，目标测试不再硬编码 `/tmp`，无新依赖或跳过条件。 |
| A2 | macOS/POSIX 业务回归 | 当前源码构建后运行目标测试，报告 1 个测试通过、0 失败、0 跳过，两轮原有配置断言正常执行。 |
| A3 | 临时父目录与正常清理 | 在本次独占、已存在且可写的临时父目录下启动子进程运行同一目标测试；仅对子进程设置 `TMPDIR`，运行后父目录为空。成功创建及空目录检查均需记录。 |
| A4 | 失败清理 | 在仓库外的临时副本中仅注入一次断言失败，仍引用当前构建产物，并沿用目标测试的创建和 after 清理；子进程返回非零且独占临时父目录为空。副本与父目录最终由验证程序回收，不提交该探针。 |
| A5 | Windows 原生 | 在现有 Windows 环境确认当前盘根 `tmp` 不存在、系统 TEMP 存在且可写；构建同一源码后运行目标测试并检查清理，通过且无跳过。不删除已有机器目录来制造环境。 |
| A6 | 范围与证据 | 记录源码 SHA/dirty、平台、Node/pnpm 版本、命令、退出码与清理事实；相对目标分支的 `.github` diff 为空，无新增必需检查。 |

### 实现阶段验证顺序

1. 核对当前 worktree、基线和目标测试；依赖缺失时使用锁文件安装（`pnpm install --frozen-lockfile --ignore-scripts`），然后 `pnpm build`。
2. 执行 `node --test test/cli-extra-directory.test.js`，完成 A2；通过独立子进程验证程序执行 A3/A4，不修改父进程的环境或真实用户 Home。
3. 按仓库约定执行 `pnpm lint`、`pnpm typecheck`；检查目标测试格式：`pnpm exec prettier --check test/cli-extra-directory.test.js`。验证记录区分已通过、本次失败和环境阻塞，不把旧结果沿用到新代码。
4. 运行 `git diff --check` 并核对代码范围及 `.github` diff。无跨包合同变更，不要求增加 CI 或默认专项任务；完整 `pnpm test` 可按实际风险另行显式运行。
5. Windows 有可用原生环境时执行 A5；没有时明确记为「未执行：缺 Windows 原生环境」，不可用 macOS、路径模拟或 API 选择代替 Windows 通过证据。

功能或所需本地检查失败时，修复后重验受影响项，按实现失败路径记录。缺 Windows 环境不阻止在 macOS 完成修复及本地验证，但 A5 保持未验收；进入验证审查后由用户决定补测安排及交付时是否接受该限制，不自行将全部验收标为通过。

## 已选方案与待审查事项

- 采用 Node 平台临时目录 API，并保留 `t.after`。原 Issue 的 finally 建议旨在保证清理；现有测试框架钩子可满足相同目的，避免重复两套清理机制。
- 无阻塞实现的产品决策。用户「开始实施」认可保留 `t.after`、分别报告 macOS 本地证据与 Windows 原生待验项的方案。
- Windows 补测的执行环境与执行人尚未确定，不推断用户已有可用 Windows 机器或远端访问授权。

## 可执行性自检

规格自评 **96/100**，并非运行通过率。路径、改动范围、清理所有权、业务断言、失败条件和本地验证步骤均明确；剩余 4 分为 Windows 原生环境及补测安排待落实。实现可在当前 macOS 环境开始，跨平台最终验收仍按 A5 单独判断。
