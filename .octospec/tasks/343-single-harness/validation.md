---
type: Validation
title: Issue 343：单实例复用验收
description: 记录本地离线回归、并发专项、真实 Codex 线程与模型验证，以及未覆盖范围。
tags: [architecture, adapter, lifecycle, envs, mcp, testing]
---

# 基线与环境

2026-11-09，初始基线 origin/main@4d7e272d1bb30957c815410f68758a9d2445d708；当前已 rebase 到 origin/main@bf665881095690fdfe3d2aca5796ca9f18e53bd0，分支 fix/343-single-harness，managed worktree 为 `/Users/lvsijia/.codex/worktrees/issue-343-single-harness/octo-runtime`。本机 macOS arm64、Node.js 24.22.2、codex-cli 0.164.0。

依赖通过 pnpm install --frozen-lockfile --ignore-scripts 准备，lockfile 无变化。所有专项均显式手动运行，不增加 GitHub CI 或默认测试选择范围。

# 初始基线检查

| 命令 | 结果 |
| --- | --- |
| pnpm typecheck | 通过，包含全部包构建与顶层类型检查 |
| pnpm lint | 通过 |
| pnpm lint:names | 通过，无新增命名问题 |
| pnpm test:suites | 1609 项，1548 通过、61 跳过、0 失败 |
| node --test test/manual/343-single-harness.test.mjs test/manual/339-engine-lifecycle.test.mjs test/manual/codex-service-lifecycle-313.test.mjs | 53 项全部通过 |
| pnpm docs:check | 通过，含 4 项可运行示例检查 |
| 本次代码与测试的 Prettier 检查 | 通过 |
| .octospec/scripts/lint.py 与本次知识 Markdown 必填元数据检查 | 通过 |
| git diff --check | 通过 |

执行日志位于本机 `/tmp/octo-343-typecheck.log`、`/tmp/octo-343-lint.log`、`/tmp/octo-343-names.log`、`/tmp/octo-343-full.log`、`/tmp/octo-343-final-manual.log`、`/tmp/octo-343-final-docs.log`、`/tmp/octo-343-format.log` 和 `/tmp/octo-343-spec.log`。日志仅为本机证据，复现使用表中的命令及下述专项入口。

# 专项证据

343 专项启动真实 Node 子进程模拟原生协议。100 个请求分别具有独立 cwd、模型、环境、MCP header、stdio env、容量和流设置；Provider 屏障确认全部 100 个 turn/start 到达后才完成任何 turn。断言单次 spawn、单 PID、单 initialize、100 个独立 thread、逐调用完整输出文本和配置隔离。

同一专项验证 100 路独立审批、错误 owner 拒绝、100 个活动 turn 同时取消后服务仍 ready、2200 个并发 lease 共用一次启动、CLI 重复类型在工厂前拒绝，以及显式独立 owner 的 PID 隔离。

313/339 回归验证同进程累计 5000 个 thread 后仍保持原 PID 和 incarnation，借用 Core 关闭不停止共享 owner、最终回收、恢复不重放、清理未确认保留事实、初始化失败回滚及 doctor 同源诊断。无 turnId 的交互仅在当前调用新建的 thread 上可投递；相同 owner 已结束后续接、外部 owner 续接均明确拒绝，不依赖已结束 thread 历史。

# 真实 Codex

显式执行 `node test/manual/343-single-harness-live.mjs --live`。使用本次独占临时 CODEX_HOME、默认 ownedSpawn、loopback HTTP MCP 和本地 stdio MCP，全部凭据值为合成 UUID。100 个原生 thread 并存，分别收到 100 组独立 HTTP header 和 stdio 环境；服务只启动一次、incarnation 为 1，最终 owner 清理完成。

初始基线原生结果：concurrentThreads=100、appServerSpawns=1、distinctHttpHeaders=100、isolatedStdioEnvironments=100、modelTurns=0、ownerCleanup=true。日志为 `/tmp/octo-343-native.log`。

另显式执行既有 `node test/manual/339-engine-sharing-live.mjs --live`，使用本机原生认证完成 3 次真实模型 turn：两个 Core 并发执行，关闭 Core A 后 Core B 再执行一次，共用同一个 app-server PID，最终 ownerCleanup=true。日志为 `/tmp/octo-343-model.log`。后续删除 Adapter 接纳配额及已结束 thread 集合后，受影响的离线专项已重跑；三轮真实模型专项未重复执行。

# Rebase 后检查

本节结果属于 bf665881 加当前未提交改动，前述旧日志保留原基线归属。main #344 已删除旧配置投影；本次调用方使用 AgentEnv 直传、Adapter 读取 bean，没有 agentConfig 兼容层。`pnpm install --frozen-lockfile --ignore-scripts` 完成，依赖与 lockfile 无新增差异。

| 命令 | 本轮结果 |
| --- | --- |
| pnpm build、pnpm typecheck | 完成全部 workspace 构建和类型检查 |
| pnpm lint、pnpm lint:names | 通过 |
| pnpm test:suites | 1516 项，1455 通过、61 跳过、0 失败 |
| node --test test/manual/343-single-harness.test.mjs test/manual/339-engine-lifecycle.test.mjs test/manual/codex-service-lifecycle-313.test.mjs test/manual/agentenv-direct-341.test.mjs test/manual/adapter-preparation-341.test.mjs | 120 项全部通过 |
| pnpm docs:check | 通过，含 4 项可运行示例 |
| node test/manual/343-single-harness-live.mjs --live | 100 个并存原生 thread、单次 spawn、100 组 HTTP header/stdio 环境隔离、0 模型 turn，ownerCleanup=true |
| 本次代码/测试 Prettier 检查与 git diff --check | 通过 |
| .octospec/scripts/lint.py 与本次知识元数据检查 | 通过，735 个 OKF 单元、20 条规则、3407 个链接；本次 9 个知识 Markdown 的 type/title/description/tags 完整 |

本轮日志前缀为 `/tmp/octo343-review-`，分别为 `build.log`、`typecheck.log`、`lint.log`、`names.log`、`full.log`、`manual.log`、`docs.log`、`native.log`、`format.log`、`spec.log`。系统 Python 缺少 PyYAML，使用独占 `/tmp/octo343-review-venv` 安装依赖后运行知识检查，未修改项目依赖。测试总数按当前 main 的选择器实际输出记录，未改默认选择范围。

两个 medium finding 均先复现再修复：早到孤立通知耗尽下一次调用缓冲，和原生验收回执非原子发布。修复前失败、修复后通过及同类扫描见 [review](review.md)。零模型原生 resume 探针中初始 MCP 正常连接；已加载和退订后 resume 都返回 -32600 no rollout found，无法证明 resume 更换/移除环境和 MCP 的真实效果，不报告为确认缺陷。该探针单 PID/incarnation 1、ownerCleanup=true，无 channel 清理失败，独占临时 Home 与进程已清理。

# CI 范围与限制

单实例阶段相对 origin/main 核对 `.github`、package.json、scripts、pnpm-lock.yaml，无差异。后续源码接入阶段 package.json 只删除两条 Adapter exports，scripts/verify-release.mjs 迁移既有 DSH 入口及现有文档编译/执行位置。`.github`、package scripts、lockfile、默认选择器和实际检查项未增加；新专项及真实验收仍为手动运行，没有新增自动触发、job、matrix、必需状态或 Gate 依赖。

100 路真实原生验证没有发送模型请求，不证明 100 路真实模型吞吐；真实模型仅验证上述三轮共享。没有执行 Windows/Linux 原生进程验证、账户切换、内存耗尽或长达一天的压力测试；5000 个 thread 的累计执行使用可控协议子进程。未安装发行包、重启用户已有服务、修改用户认证或清理用户 Home。

实现复核见 [review](review.md)。本次保留未提交的 worktree，尚未 commit、push 或创建 PR。

# 源码接入与文档追加验证

仍基于 bf665881；重新 fetch origin/main 后未发生基线变化。用户授权删除 Adapter 聚合入口、纯原生统一源码 workspace 按需依赖与加载，并要求中英文 docs 明确 CLI + 独立 client 场景。本节结果属于该最终实现；前述真实模型/原生专项的基线与限制保持原记录。

| 命令或检查 | 结果 |
| --- | --- |
| pnpm build（含既有 prebuild clean）、pnpm exec tsc -p tsconfig.json --noEmit | 全 workspace 构建与类型检查通过，旧 public Adapter 产物随 clean 移除 |
| pnpm lint、pnpm lint:names、目标文件 Prettier、git diff --check | 通过 |
| pnpm test:suites | 1516 项，1455 通过、61 跳过、0 失败 |
| 前述五组显式手动专项 | 120 项全部通过 |
| pnpm docs:check | 示例编译、双语一致性及 4 项运行验证通过 |
| node scripts/check-developer-docs.mjs --scope current | 161 文档、1650 链接、39 锚点，0 错误；157 外链未联网检查 |
| 提取私有 bean TS 示例并通过 TypeScript compiler API 严格检查 | 通过，不创建默认测试文件或修改 CI 选择器 |
| node scripts/pack-release.mjs | 生成 CLI/client 两份 0.0.0 本地测试归档 |
| node scripts/verify-release.mjs dist/release/mininglamp-oss-octo-runtime-0.0.0.tgz --expected-commit bf665881095690fdfe3d2aca5796ca9f18e53bd0 | 离线安装、公开类型、原生 Kernel、恢复探针、CLI Kernel、卸载保留 Home 全部通过 |
| node test/manual/codex-service-package-313.mjs dist/release/mininglamp-oss-octo-runtime-0.0.0.tgz | 归档无两条 Adapter exports；源码严格类型、3 轮 Core + 3 轮 IPC、PID 复用与 owner 清理通过 |
| OCTO_CLIENT_TEST_VERSION=0.0.0 node --test test/manual/runtime-client-309.test.mjs | 11 项全部通过，含独立 client 发行边界与消费者 |
| .octospec/scripts/lint.py 与本次知识元数据检查 | 通过：735 个 OKF 单元、20 条规则；修改的知识 Markdown 必填元数据完整 |

本节日志前缀 `/tmp/octo343-source-`：build、types、lint、names、format、full、manual、docs、current-docs、pack、release、package313、client。首次发行检查复现了旧检查位置无法解析源码 import；迁移现有检查位置后重验通过，详见 review。本次只在独占临时目录安装测试归档，未安装到用户全局或变更现有服务/认证/Home。

用户随后授权提交 PR 到 main、暂不自动合并。本次不扩大 CI、不修改默认验证范围，不以本地测试归档声称已发布 npm 版本。

# PR 345 CI 失败复现与修复

首轮提交 f85a7356、CI run 42626868888：六个矩阵失败。根因与修复见 review；日志下载到 `/tmp/octo345-ci-failed.log`。本机不存在 CODEX_HOME 时的 actmode/Playboard 复现命令退出 1，日志 `/tmp/octo345-before.log`。修复仅解除 managed spawn cwd 与数据目录的绑定，CODEX_HOME 默认 ~/.codex 保持；业务目录继续经 thread/turn RPC 传入。公开协议参考 [Codex App Server](https://developers.openai.com/codex/app-server/)。

按用户要求在提交修复前执行本地 CI 对应检查，平台为 macOS arm64 / Node 24.22.2 / pnpm 11.19.0，日志前缀 `/tmp/octo345-ci-`。`pnpm install --frozen-lockfile`、`pnpm lint`、`pnpm lint:names`、完整 `pnpm format:check`、`pnpm typecheck`、`pnpm docs:check` 全部通过；lockfile 与生成协议类型漂移检查无差异。lint 首次与 clean/build 并行导致构建产物类型暂缺，构建完成后串行重跑通过，没有据此改源码或关闭规则。

`CODEX_HOME=/tmp/octo345-absent-codex-home pnpm test:suites`：1516 项，1455 通过、61 跳过、0 失败；五组显式手动专项新增缺失 Home 回归后 121 项全部通过。`node scripts/pack-release.mjs` 生成双包；同一不存在 CODEX_HOME 下 `verify-release.mjs --expected-commit f85a735677bfe5839f3fc78ed9123abbf8ca6e5f` 的离线安装/公开 API/原生与 CLI Kernel/卸载保留 Home 全通过；独立 client 11 项通过。提交前归档正确标记 dirty，不冒充干净发行；远端继续运行原有 --require-clean 验证。OKF lint 735 单元/20 规则/3427 链接通过。

本机未模拟 Windows/Linux 或 Node 26。workflow、job、矩阵、默认测试选择及 Gate 不变；新增专项只手动运行。用户要求提交修复后等待远端全部 CI，暂不合并。
