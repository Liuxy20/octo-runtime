---
type: Journal
title: 单一工作树统一修复安全告警
description: 五条 Dependabot 与六条 CodeQL 告警的处置依据和验证证据。
tags: [security, dependencies, testing]
---

先以 origin/main@3f83ecf4 为基线，在原 fast-uri worktree 统一修复。
实施期间 PR #336 已被合并，fast-uri 四条告警已关闭；将剩余修复移至同一 worktree 内
基于最新 origin/main@a8685437 的 fix/security-alerts-unified 分支，创建后续 main PR。
两者源代码内容一致，仅更新交付记录。此前两个 worktree 的分开交付安排由本记录取代。

## 告警处置

CodeQL 托管分析版本 2.27.4，来源为 .github/workflows/codeql.yml:analyze，
分析提交 3f83ecf4607c658fba7664caa6ccb2787ab92baa，security-extended 查询集。

| 告警 | 来源与风险 | 修复 |
| --- | --- | --- |
| Dependabot #3-6 | AJV/DSH 的 fast-uri 3.1.8 | 定向 override 到 3.1.9 |
| Dependabot #9 | lint 工具链 minimatch 10.2.6 | 定向 override 到 11.0.1 |
| CodeQL #61 | npm 发行元数据 URL 只替换第一个斜杠 | 对 name 和 version 完整 encodeURIComponent |
| CodeQL #54 | 故障控制文件先 lstat 再打开 | 先以 NOFOLLOW/NONBLOCK 打开，再对同一 fd 校验权限、类型、大小并读取；缺 NOFOLLOW 时打开后核对入口身份；保留符号链接拒绝和错误语义 |
| CodeQL #53 | 原生 launchd 专项的 stat/后续读取被识别为检查后使用 | 直接用实际 readFile 的 ENOENT 验证卸载结果 |
| CodeQL #51 | 不可信诊断正文的 key 正则可多次回溯长后缀 | 完整消费 key，再单向扫描分隔符，保持原有脱敏和最终展示长度 |
| CodeQL #45 | Git 入口先 stat 再 readFile | 直接读取 gitdir 文件；EISDIR 分支检查 checkout HEAD |
| CodeQL #44 | 故障夹具将 gate 路径拼入 Node -e 源码 | 固定源码，通过 argv 单独传路径 |

全部实际修改 source/sink；没有 dismissal、整目录排除或扫描规则豁免。
文件描述符约束保护读取目标，不声称可写父目录构成跨同账号应用沙箱。
脱敏不截断输入来规避扫描，最终输出仍按原合同截取 200 个 Unicode 字符。

## 本地结果

macOS arm64，Node 24.22.2、pnpm 11.19.0；源码为本次未提交修复。

- `pnpm install --frozen-lockfile --ignore-scripts`、`pnpm build`、`pnpm lint`、`pnpm exec tsc -p tsconfig.json --noEmit` 均通过。
- `pnpm audit --json`：0 info/low/moderate/high/critical；两个定向 override 一起生效。
- 手动 security-alerts-unified、既有 recovery-live-probe、name-lint、release-build-time、kernel-spawn-isolation 共 32 项通过。
- 手动专项覆盖 20 万字符恶意诊断正文、敏感正文脱敏、完整 URL 组件编码、Git 两种入口、带引号及代码片段的 gate 路径按数据传递。
- `pnpm test:suites`：1607 项，1546 通过、61 条件跳过、0 失败。
- `OCTO_LAUNCHD_OWNERSHIP_NATIVE=1 node --test test/manual/launchd-query-ownership-native.mjs`：1 项真实 macOS 原生验证通过；query 故障保留定义，stop/uninstall 与重复卸载成功，post-bootout 故障不报成功；所属进程退出、原生 label 及独占目录清理确认。

新增专项仅放 test/manual，未改变默认测试选择、workflow、job、矩阵、触发条件或 CI Gate。
唯一既有默认测试调整是 npm URL 编码的预期字符串，保持原有测试范围。
首次手动 gate 路径用例因样本包含路径斜杠而创建失败，修正为合法的带引号路径后通过。
未在本地运行 Windows、Node 26 或真实 Provider。托管 CodeQL 通过既有 workflow 的
workflow_dispatch 在修复分支手动执行，结果以本次后续 main PR 中附上的实际 run 与分支分析为准；
main 告警状态需合并后重新分析确认，未授权合并。
