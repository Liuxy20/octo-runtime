---
type: Validation
title: Issue 242 Windows 符号链接测试验证
description: 最新 main 的复现、能力缺失修复验证及真实正向环境缺口。
tags: [testing, windows, security, delivery]
timestamp: 2026-11-03T04:12:00Z
---

# 验证结论

本地修复已完成。普通用户 Windows 缺少 symlink 能力时，八个相关叶子用例明确报告 skip 及未执行原因；非能力相关断言继续运行。未取得具备 symlink 能力的 Windows 环境，八项真实正向保护验收仍未验证，**#242 尚不满足关闭条件**。本项不修改产品实现，不证明产品保护已失效，也不关闭 Windows 总单 #14。

## 环境与基线

- 原生 Windows 11 Enterprise 22H2，build 22621.1848，x64，普通用户（管理员组令牌检查 false）；PowerShell 7.6.5，Codex CLI 0.163.0。
- Node 24.19.0 / 26.13.0，pnpm 11.19.0，Python 3.12.14；治理 lint 的 PyYAML 6.0.3 仅安装到本聊天工作目录。
- 独立 clone，origin 为 Mininglamp-OSS/octo-runtime，分支 `fix/windows-symlink-prerequisites-242`。开工及收尾复核 main 均为 `e6809e92b6ea88eb00106e236584fbfb1c9ce6e1`；#242 OPEN，时间线未见关联 PR。
- 先以 frozen lockfile、offline、ignore-scripts 安装，复用 pnpm store；随后显式 typecheck 完成 workspace 构建。第一次因子进程找不到 pnpm 启动失败，在本聊天 work/tools 放置临时启动器并修正本次 PATH 后通过；没有修改全局配置或锁文件。
- 构建时源为上述 SHA + 任务文档 dirty；`build-info.json` 的 buildTime 为 `2026-11-03T04:05:50.759Z`。测试修改不涉及生产源码，全部复用该构建；生成协议文件仅出现行尾变化，确认无内容 diff 后恢复。
- TEMP/TMP 均指向 checkout 外的本次独占 work/state。测试不接触真实 Bot、Provider、Home、身份、凭据或配置。

## 完整文件结果

四文件命令为 `node --test --test-reporter=tap test/extra-status-logs.test.js test/hourly-log.test.js test/im-artifact-delivery.test.js test/security-remediation.test.js`；覆盖率由 `NODE_V8_COVERAGE` 写入本次证据目录。

| 执行 | tests | pass | fail | skip | 退出码 |
| --- | ---: | ---: | ---: | ---: | ---: |
| main 原始源码 / Node 24 | 140 | 132 | 6 | 2 | 1 |
| main 原始源码 / Node 26 | 140 | 132 | 6 | 2 | 1 |
| 最终修复 / Node 24 | 146 | 136 | 0 | 10 | 0 |
| 最终修复 / Node 26，增加 `--test-concurrency=1` | 146 | 136 | 0 | 10 | 0 |

八项新增能力 skip 与原有 FIFO、WeCom POSIX 两项 skip 分别记录；原有 POSIX chmod 条件分支在 Windows 也没有执行，不计为 Windows 权限正向通过。新增的六项计数来自拆分普通断言与能力场景，不代表原 symlink 断言通过。

最终 Node 26 首次并行运行发生 `spawn UNKNOWN`、V8 `Zone Allocation failed` 及进程退出异常；该轮仅执行 20 项，14 pass / 3 fail / 3 skip，不能计为通过。同轮系统可用提交内存约 3 GB；记录内存压力事实，不认定根因已被完全证实。在静态检查结束后用文件并发 1 重跑完整四文件通过，没有增加超时、修改断言或吞掉错误。原始失败日志保留。

## 逐项保护断言

| 原场景 | 保留的无能力依赖覆盖 | 原生 symlink 覆盖 |
| --- | --- | --- |
| 状态日志读取 | 空日志、超长记录、允许状态内容与脱敏 | 独立子用例 skip；目标不变及不泄露断言未执行 |
| hourly cleanup/write | legacy、其他类别和用户文件保留 | 文件 symlink cleanup/write skip；目标不变断言未执行 |
| hourly 日志目录 | 其他普通目录用例照常 | 真实 dir symlink skip；拒绝写入及保留目标目录断言未执行 |
| Markdown 多类别附件 | 原始 Markdown、MIME、上传数量、普通路径重复引用 | symlink alias 场景 skip；真实路径去重断言未执行 |
| 附件部分失败 | 成功 URL、缺失文件、越界普通路径、非普通文件、无效 file URL | symlink 越界场景 skip；拒绝上传与目标不变断言未执行 |
| 原生文件卡 | 图片 inline、普通下载链接、单次上传及文件类别/大小 | symlink alias 场景 skip；真实路径共享上传断言未执行 |
| Extra config | ENOENT、普通读取、容量、目录拒绝 | 新独立 symlink 用例 skip；拒绝读取与目标不变断言未执行 |
| OpenClaw dotenv | 其他安全用例保持执行 | 原 symlink 用例显式 skip；拒绝同步与目标不变断言未执行 |

直接原生能力探测在两版 Node、file/dir、同步/异步四种组合均报告 `EPERM` / `syscall: symlink`；未修改系统开发者模式或权限。当前可用执行宿主仅本机；未获得其他具备能力的 Windows 主机。WSL 查询未得到已安装分发版，不作为 Windows 正向替代。

## 覆盖率与受控回归

- 两版基线 V8 均确认 security-remediation 第 93、115 行提前返回各 count=1；第 96、118 行保护断言 count=0，TAP 却为 pass。
- 最终两版 V8 确认新 Extra 普通断言第 75、77、84、87 行 count=1；symlink 前提第 97、114 行 count=1，其后第 98、99、115、132 行保护断言 count=0，同时 TAP 为明确能力 skip。其他文件的逐行计数、完整源码快照及所选 V8 原始范围一并归档；校验源码长度与 V8 endOffset 一致，保存 SHA-256。
- 显式手动 helper 注入：每版 Node 各 48 个组合检查通过（Windows/Linux 分支、file/dir、同步/异步、EPERM/EACCES/ENOENT/EEXIST/ENOSPC/成功）。只有 Windows EPERM 被记为能力缺失；错误对象原样传播。受控成功继续进入依赖操作，该操作的 EPERM 仍拒绝且没有 skip。
- 四个完整文件额外预载 EACCES：135 pass / 9 fail / 2 skip、退出 1。八个依赖叶子均真实失败，状态日志父用例随子用例失败，故 TAP 计九项失败；没有能力 skip。这是受控注入，不是原生正向保护验收。
- 首轮拆分使附件用例执行到被历史夹具失败遮住的 POSIX 断言：Windows 盘符合法，缺失文件应报 file-unavailable，不能据此期待 path-unavailable。保留盘符引用，额外用确定非法的编码分隔符 file URL 覆盖 path-unavailable；生产实现不变。修正前两版各 135 pass / 1 fail / 10 skip 的中间日志保留。

## 工程检查与边界

- `pnpm typecheck`（含全 workspace build）通过；`pnpm lint`、`pnpm lint:names` 通过。
- `pnpm format:check` 退出 1：711 个未修改文件使用 checkout 的 CRLF。逐一验证警告文件都没有本次 diff，且仅在内存规范化为 LF 后全部通过同一 Prettier 检查。五个修改的 JS/MJS 文件单独 Prettier check 通过；不重写全仓格式、不改 Git 全局配置。
- `.octospec/scripts/lint.py` 通过；diff/元数据复核见 [review](review.md)。任务 brief、validation、review、journal 均有要求的元数据，context.yaml 按仓库豁免。
- 没有运行全仓 `test:suites`、其他平台、Windows 10、发行安装、真实 Provider/IM。此变更只修改四个测试与一个测试 helper，不涉及跨包生产合同；没有重跑其他聊天处理的 Grok 专项或 ACL 超时。
- workflow、job、矩阵、默认专项开关、required checks、CI Gate 无改动。手动注入与能力探测脚本只在本聊天 work/，不加入默认测试。
- 完整证据、命令/退出码、构建记录、所选 V8 数据、可应用 patch 已在本聊天 outputs 交付。用户随后明确授权提交 PR；PR 交付阶段沿用本轮证据，向 main 提交草稿 PR，以 Refs #242 / #14 关联，不关闭 Issue 或合并。

## 关闭条件

缺失能力分支已满足；目标文件保护、越界和文件类别等原有合同仍保留在测试源码。仍须在具备真实 file/dir symlink 创建能力的普通用户 Windows 环境，用 Node 24/26 运行同四个完整文件并归档八场景的断言/覆盖率证据。不得用普通文件、junction、helper 受控成功或其他平台结果勾选该条件。
