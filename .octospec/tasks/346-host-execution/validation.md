---
type: Validation
title: Issue 346：实施与本地验收
description: 记录主线整合、离线回归、真实执行、包外交付与未验平台，区分方案评分和运行证据。
tags: [architecture, adapter, validation]
---

# 基线与范围

2026-11-09，从 main@bf665881 新建 managed worktree，后按用户要求 fetch/rebase 至 `c7ae0256222fe0956ed6789e552e36aa6a61edf6`（#345）。分支 `plan/issue-346-host-execution`；本记录对应该基线加当前未提交改动。原 checkout 及其未跟踪文件未修改。

环境为 macOS arm64、Node.js 24.22.2。`pnpm install --frozen-lockfile --ignore-scripts` 准备依赖，lockfile 无变化。用户授权 spec、实施和 code review，并明确不要兼容层、CLI 负责 executable 发现；未授权 commit/push/PR。

## 最终检查

| 命令 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过，包含全 workspace 构建与顶层类型检查 |
| `pnpm lint`、`pnpm lint:names` | 通过，无新增命名 finding |
| `pnpm test:suites` | 1516 项：1455 通过、61 平台/环境跳过、0 失败 |
| `node --test test/manual/host-execution-346.test.mjs test/manual/343-single-harness.test.mjs test/manual/339-engine-lifecycle.test.mjs test/manual/codex-service-lifecycle-313.test.mjs` | 65 项全部通过，其中 #346 新专项 12 项 |
| `pnpm docs:check` | 类型、37 对双语页面及 4 个执行示例通过 |
| 本次代码/测试 Prettier 与语法检查 | 通过；真实 fixture 单独 node --check |
| `node scripts/pack-release.mjs` | 生成完整 runtime 与独立 client 两个本地 tgz |
| `node scripts/verify-release.mjs dist/release/mininglamp-oss-octo-runtime-0.0.0.tgz` | 离线安装、公开类型、原生 Kernel、SDK 恢复、CLI Kernel 与保留 Home 的卸载通过 |
| OctoSpec lint、必填 YAML 元数据、`git diff --check` | 742 个知识单元、20 条规则、3449 个链接及本次 10 份知识文档元数据通过；未新增仓库 Python 依赖 |

最终日志位于 `/tmp/issue-346-typecheck-final.log`、`/tmp/issue-346-lint-final.log`、`/tmp/issue-346-names.log`、`/tmp/issue-346-tests-final-2.log`、`/tmp/issue-346-manual-final-2.log`、`/tmp/issue-346-docs-final.log`、`/tmp/issue-346-pack-final.log` 和 `/tmp/issue-346-release-final.log`。日志属于本机证据；复现使用表中命令。

## 专项证据

#346 隔离 A/B 安装、只修改局部环境副本，验证裸命令/相对路径/NUL 在构造前拒绝，CLI 选定 Node 和入口，probe 使用 Provider 版本而非 Node 版本；改变请求 PATH/cwd 或构造后修改 args/env 不改变绑定。OpenCode JSON/ACP 两路均传递 Run envs、宿主 overrides 与内联配置，参数中的空格、中文及 shell 字符保持边界。

缺文件、权限不足、损坏首个安装和版本探针失败均不回退。无扩展名 Node shebang 固定运行器；execute-only 原生程序保留直接执行。复杂 Node shebang 参数要求宿主显式给出运行器及 argv。远程 ACP 结构 client 没有 ChildProcess，probe 不进行本地 IO，调用完成并幂等关闭。

CLI 缺安装保留失败目标、原因和 ENOENT/EACCES；11 个命令 Adapter 可全部以 unavailable 状态装配。通过 Core 验证 canonical/native 与 ask/full_access 四种受支持组合均报告依赖失败且最终 cleanup complete，不产生审批误报。Codex probe/共享服务使用捕获的前缀和环境；关闭 lease 后 PID 不变。

重跑 #343 的 100 个并发 turn、审批和取消，以及 #339/#313 的 owner 借用、恢复、5000 次累计 thread 和清理验证。安装替换的旧专项改由宿主先解析相对路径，owner 不再接受相对 command。

## 真实执行

- `node test/manual/339-engine-sharing-live.mjs --live`：使用已安装 codex-cli 0.164.0 与本机原生认证，两个 Core 完成 3 次模型 turn，共用一个 app-server PID；关闭 A 后 B 再调用成功，最终 ownerCleanup=true。日志 `/tmp/issue-346-codex-live.log`。
- `node test/manual/host-execution-346-live.mjs --live`：OpenCode 2.1.3，deepseek/deepseek-flash；full_access JSON 与 ask ACP 各完成一轮 marker 对话，均 run.completed，最终 cleanup complete。日志 `/tmp/issue-346-opencode-live-final.log`。
- 首次 ACP 真实执行暴露基线已有的 session-name diagnostic severity=info 与协议要求 warning 不符。修正这一行，专项给出 sessionName 并对全部输出执行 assertCanonicalEvent；重跑真实 ACP 通过。

## Review 与 CI 范围

独立 Standards、Spec 双轴审查发现的问题已修复并复核；当前均 0 项未关闭 finding，见 [review](review.md)。方案准备度保留初始 96/100 自评，不替代运行结果。

`git diff origin/main -- .github package.json pnpm-lock.yaml` 为空。既有默认 selector 仍为 `test/*.test.js` 与协议包 `test/*.test.js`，新专项仅在 `test/manual/*.mjs`，没有接入 workflow 或默认开关。既有 verify-release 只迁移 Grok manifest 构造断言，没有增加执行场景或 Gate。实际 GitHub 检查列表与 Gate 依赖未变，未触发远端 CI。

核对既有 CI 的 check（Build, test and package）、verify-windows-release（Verify release package）和 CI Gate 三个 job；工作流内容、原矩阵和 gate needs 均与目标分支相同。Windows 已有的原生 executable selection 步骤只迁移原测试断言，没有加入 #346 新专项。

## 未验与交付边界

原生 Windows/npm shim、Electron 实机尚未执行；Electron PATH 分支仅有独立进程模拟验证，不能代替实机。Claude、CodeBuddy、Grok、Hermes、Kimi、MCode、Qoder/CN、Antigravity 的真实模型/账号未验；它们的构造、协议及清理使用离线回归。DSH/OpenClaw 保持既有边界，仅覆盖离线回归。未新增远程执行平台，也未验证真实远程 client。

未创建 commit、push、PR、合并或正式发布；tgz 仅为本地验证产物。rebase 使用的自动保留 stash 仍是本轮备份，不改变原 checkout。

## PR 交付授权

2026-11-10 用户追加授权提交、推送及创建目标为 main 的 PR，明确禁止自动合并。提交前重新 fetch，origin/main 仍为 c7ae0256，无新增主线提交；diff whitespace 与 CI 范围检查通过。继续采用前述已完成的运行验证，后续仅修改本节等交付文档，不把旧实测表述为重新执行。commit/PR 使用英文，保留配置作者，commit 添加一次 Codex co-author trailer。此次授权不包含合并、发布或扩大 CI。

## PR #347 修复与最新版本原则

提交 e657ac0c 后的 CI run 42653323639 中，Linux/macOS 的 Node 24/26 四项通过，Windows Node 24/26 失败于既有 mixed-case 环境测试向 probe 传入裸命令，Gate 随之失败。现改为测试宿主先解析，再 probe 绝对绑定，原场景与 selector 不变。PR Title Lint、PR Labeler 当次 startup_failure 且无 job，独立于测试失败，继续核对新提交的运行。

用户提供的 review 揭示两个此前遗漏：通用可选版本命令失败误报 unavailable，以及 actmode live 的默认导入失效。已修正通用 probe、脚本工厂装配与 owner 回收。OpenCode 初次本地重跑在版本探测阶段超时；Core received-config 用例单独通过，未复现 stdin end 本身故障。协议 fixture 改为宿主显式绑定 Node/入口，Core 核对具体失败码、文件回读和 cleanup，Grok 既有版本 fixture 同样消除 shell 启动延迟。

用户进一步明确 OpenCode 升级不应影响 Runtime。最终删除 OpenCode 版本范围、未知版本拒绝及 invoke 前 --version；现有六种版本用例实际验证 JSON/ACP 成功，且只有显式 probe 会查询版本。删除过时的 V1 拒绝验收脚本，更新双语文档和规范。真实协议、进程与回收错误继续报告，不承诺上游破坏协议后自动兼容。

本轮 macOS arm64、Node 24.22.2，源码为 e657ac0c 加本轮修复：

| 检查 | 结果 |
| --- | --- |
| `pnpm typecheck`、`pnpm lint`、`pnpm lint:names` | 全部通过 |
| `pnpm test:suites` | 1516 项：1455 通过、61 跳过、0 失败；默认检查范围未变 |
| OpenCode/Grok/discovery/Windows 既有定向 + #346 手动专项 | 88 项：85 通过、3 原生 Windows 跳过、0 失败；手动专项现有 16 项，未纳入默认测试 |
| `pnpm docs:check` | 类型、双语目录与 4 个执行示例通过 |
| Standards / Spec 独立复核 | 两轴各 0 项剩余 finding；撤销前轮将所有版本探针失败视为不可用的错误判断 |
| `node test/manual/host-execution-346-live.mjs --live` | OpenCode 2.1.3，deepseek/deepseek-flash；JSON 和 ACP 均 run.completed、markerObserved=true、cleanup complete |

日志为 `/tmp/issue-347-typecheck-final.log`、`/tmp/issue-347-lint-final.log`、`/tmp/issue-347-names-final.log`、`/tmp/issue-347-suites-final.log`、`/tmp/issue-347-targeted-final-2.log`、`/tmp/issue-347-docs-final.log` 和 `/tmp/issue-347-opencode-live.log`。早期失败日志保留，不将其视为最终通过证据。

`git diff origin/main -- .github package.json pnpm-lock.yaml` 仍为空；没有增加 workflow/job/matrix/trigger/status/Gate/default selector。本机没有原生 Windows/Electron；Windows 修复由原有远端矩阵复验。真实 Codex 和发行包的前轮结果仍仅对应 e657ac0c，本轮没有重跑那些场景。
