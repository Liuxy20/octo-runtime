---
type: Validation
title: Issue 157：Windows 本地验证
description: 记录独立 clone、原生 shell 与 normalizer 出口证据、仓库检查及实际限制。
tags: [validation, adapter, canonical, windows, testing]
---

# 环境与来源

- 源码：`upstream/main@780cd7cd5e67e4868df895a2e74a826097f349fd`，独立 clone、`fix/157-ripgrep-command-status`，初始干净；clone 与本仓局部 `core.autocrlf=false`，未改全局设置。
- Windows 11 Enterprise `10.0.22621` x64，普通用户；原生 PowerShell `7.6.5`。此结果不代表原报告的 Windows Server 2022。
- Node `24.19.0`（Codex runtime 缓存独立可执行入口）和 `26.13.0`（独立验证工具）；pnpm `11.19.0`；rg `15.2.0`；Codex CLI `0.163.0` 仅查询版本，未发模型 turn；Git `2.55.0.windows.5`；gh `2.103.3`。
- 依赖安装在本 clone 内；使用 `pnpm install --frozen-lockfile --ignore-scripts --config.trust-lockfile=true`，随后显式 typecheck/build。未借用其他 checkout 的 node_modules。
- 测试 USERPROFILE/HOME/TEMP/TMP/TMPDIR/XDG_CONFIG_HOME 均在本会话独占 `work/test-state-157-01a1aa4e/`，位于所有 Git checkout 之外。未操作日常 Home、身份或其他会话进程。新增 shell 夹具只执行有界有限命令，并由 after hook 删除本次独占目录。
- Issue 开始时 OPEN、无评论，时间线无关联修复；最新 40 个 PR 与 ripgrep/157 搜索未找到覆盖项。#316/#317 已在基线内。#13/#30 仍 open、#20 closed，仅作历史线索。

详细可执行路径、命令、原始退出码与日志存于本会话 outputs；不将本机绝对路径写入公共仓库记录。

## 支持边界

| 命令形态 | failed + exit 1 + 显式空输出时的结果 |
| --- | --- |
| `rg ...`、`rg.exe ...` | completed |
| `/usr/bin/rg ...`、`C:/tools/rg.exe ...` 等未加引号的正斜杠路径 | completed；路径形态为确定性事件测试，未在 POSIX 实机执行 |
| 不含特殊语法的完整单/双引号参数，如 `rg "two words" file.txt` | completed |
| `&&`、`||`、管道、`&`、分号、CR/LF、重定向、注释、变量/命令展开、反斜杠/caret 转义 | failed |
| 引号内的 `TODO|FIXME`、`&&`、`;` 等运算符文本 | failed；无法从无 shell 类型的 command 字符串可靠解释所有 shell 引号 |
| sh/bash/zsh 的 `-c/-lc`、cmd `/c`、PowerShell `-Command`，以及 command/env 包装 | failed；本次不解析包装 |
| 反斜杠路径、带引号的可执行路径、PowerShell `&` 调用、rg.cmd、其他命令或未闭合引号 | failed |

`commandActions` 是展示分类，不能证明子命令运行或归属退出码。哪怕真实前置命令成功、rg 实际执行，复合命令仍不使用例外。用户原命令、Provider 状态输入、退出码、输出及事件身份均不被修改。

## 修复前后

同一真实 cmd.exe `/d /s /c` 结果送入实际 `normalizeCodexEvent`，不调用模型：

| 命令 | 真实 exit/output | 基线终态 | 修复终态 |
| --- | --- | --- | --- |
| `exit /b 1 && rg TODO missing-dir` | 1 / 空；前置退出，rg 未执行 | completed（错误） | failed |
| `rg absent fixture.txt` | 1 / 空；真实无匹配 | completed | completed |
| `rg TODO missing-dir` | 2 / 真实缺失输入诊断 | failed | failed |

独立缺失输入对照证明真实运行 rg 会报错；未将“跳过的 rg”当作执行成功。修复同时保留原始 exitCode 和 output。JSON 前后证据分别为 outputs 的 `repro-baseline.json` 与 `repro-fixed.json`。

## 已执行检查

| 检查 | 实际结果 |
| --- | --- |
| Node 24 baseline `pnpm typecheck` | 通过，未修改生产逻辑的构建 |
| Node 24 baseline `pnpm test:suites` | 2401 total，2314 pass，8 fail，79 skip；未通过 |
| Node 24 baseline 新专项 | 原始版本 23 项，7 pass/16 fail；包含预期产品失败，也包含一处测试断言错误和一次 shell 超时，不能全部归为产品缺陷 |
| Node 24 `pnpm lint` | 初次与全量并发时内存不足退出 134；独占串行重跑通过 |
| Node 24 `pnpm lint:names` | 通过 |
| Node 24 修复后 `pnpm typecheck` | 通过 |
| Node 26 修复后 `pnpm typecheck` | 通过 |
| Node 24 修复后 `pnpm test:suites` | 2401 total，2316 pass，6 fail，79 skip；未通过 |
| Node 24/26 手动 `node --test test/manual/codex-ripgrep-command-status.test.mjs` | 各 26 pass / 0 fail / 0 skip，含 20 个真实 cmd/PowerShell 子场景和 5 组纯出口断言 |
| Node 24 Codex app-server、ripgrep、native-host | 51 total，50 pass / 0 fail / 1 平台 skip |
| Node 26 同上及 tool-event-contract、adapter-tool-lifecycle、run-protocol | 71 total，70 pass / 0 fail / 1 平台 skip |
| Node 24 最终相同扩展范围串行复验 | 71 total，70 pass / 0 fail / 1 平台 skip；全量后执行 |
| Node 24 `pnpm format:check` | 通过 |
| Node 24 `pnpm docs:check` | 文档类型/检查及 4 个公开示例测试通过 |
| OKF lint（规则更新后） | 671 单元、20 规则、4067 链接通过；收尾后再次执行 |
| `git diff --check`、生成协议/锁/CI 范围 diff | 通过；workflow、package.json、scripts、协议包及锁文件无差异 |

Node 24 首次 related 命令误多传了不存在的 `test/canonical-event.test.js`，Node 实际执行 51 项；不将该名称计作已覆盖文件，后续 Node 26 使用实际存在的事件/协议测试，Node 24 最终补跑相同扩展范围并通过。

## 基线失败与范围

1. `channel-tool-environment` F24：ACL PowerShell 10 秒探针超时；`extra-commands` 配置命令返回 1。
2. `kernel-spawn-isolation` sibling 终态为 failed；`module-loading` Windows 文件 rename EPERM。
3. `openclaw-runtime-connection` typed/untyped 两项：启动时 ORPHAN_CLEANUP_INCOMPLETE，保留原资源记录。
4. `playboard` 临时 IPC fake Codex 测试 15 秒未退出；`windows-command-launch` fake Codex npm shim 进程退出 ESRCH 断言未满足。

上述八项发生在基线构建，未改其业务/清理断言，也未以本缺陷修复它们。测试名称含 real Codex adapter 仍使用 fake Provider，不代表真实模型验收。

修复后全量为 2316 pass / 6 fail / 79 skip：OpenClaw typed/untyped、Playboard 和 npm shim 四项与基线重叠（Playboard 此次报告 COMPONENT_CLEANUP_INCOMPLETE）；另有 native-host 的 explicit canonical、native unknown 两项在 afterEach 清理钩子得到 incomplete。两项在 Node 24/26 串行专项均通过，fixture 不发 rg commandExecution，失败位置不在本次状态例外。此处仅确认失败路径及串行/全量差异，未诊断并发清理的完整根因，不将它们伪装为已解决或默认门禁通过。

## Non-gating live acceptance 与未验证

真实 Windows cmd/PowerShell + rg、确定性 commandExecution 输入及 normalizer 出口已验证。未运行真实 Codex Provider/模型 turn、IM、Electron、Windows Server 2022、macOS/Linux 原生或 POSIX shell；未运行发行打包/安装矩阵，未声明全量 Node 26 suites 通过。纯跨平台字符串用例和 Windows 原生证据不能替代这些范围。

保守支持范围会使包装或复杂引号下真实 rg 无匹配继续显示 failed。这是保留失败事实的边界，不增加自动重试或改变用户命令。需要扩展支持时必须先提供该实际形态的可归因证据。

## 后续 PR 交付

用户在知悉专项通过、全量仍有六项失败后明确要求创建关联 #157 的 PR。提交前重新 fetch，main 仍为 `780cd7cd5e67e4868df895a2e74a826097f349fd`，无需 rebase；查重无现有同分支或关联 #157 的 PR。通过当前账号的既有个人 fork 提交到上游 main，正文保留本地全量失败、平台和真实 Provider 未验范围。仅更新交付记录，没有生产代码或测试语义改动，不重复已有完整构建与全量运行。Project/Sprint 自动化未配置，不虚构元数据；实际托管检查状态与此前本地结果分开记录。
