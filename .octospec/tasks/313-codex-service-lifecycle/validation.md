---
type: Validation
title: Issue 313：实施与分层验证记录
description: 记录 macOS 上离线、真实 Codex、包外与回归结果，并区分未执行的 IM 和原生平台验收。
tags: [testing, documentation, lifecycle]
---

# 2026-11-05 实施验证

用户明确“开始实施”后，已在原独立 worktree 完成源码和文档改动。以下运行证据绑定执行时的 `de3ff37a86ee3cb8f6ab66148ceca817f6ae5240` 加未提交实现 diff；macOS arm64、Node `24.22.2`、Codex CLI `0.164.0`。后续仅更新交付文档、分支与 Git 提交，不将历史运行写成提交后的重复执行。本记录不表示所有 A01-A21 已通过，逐项结果见 [acceptance](acceptance.md)。

| 命令/检查 | 实际结果 |
| --- | --- |
| `pnpm install --frozen-lockfile --ignore-scripts` | pass，未修改依赖清单/锁文件；随后显式构建 |
| `pnpm typecheck` | pass，包含完整 build |
| `pnpm lint`、`pnpm lint:names` | pass |
| `pnpm format:check` | pass |
| `pnpm docs:check` | pass，文档类型/链接检查及 4 项示例运行 |
| `pnpm test:suites` | pass，2400 项：2334 pass、66 skip、0 fail；保留既有默认入口和用例数 |
| `node --test --test-timeout=20000 test/manual/codex-service-lifecycle-313.test.mjs` | pass，26 项，涵盖复用、路由、审批、nullable elicitation、取消隔离、真实 OS fake Provider 故障、关闭竞态、fallback 结果与清理分离、实际 CLI doctor 和四项审查回归 |
| `node test/manual/codex-service-protocol-313.mjs --run` | pass，真实 Codex stdio 单初始化、并发 thread、resume/unsubscribe；原生 PID 55700 |
| `node test/manual/codex-service-live-313.mjs --mode direct` | pass，五轮调用；复用 PID 41778，idle/active kill 后恢复到 incarnation 3、PID 43502；原活动轮 failed，显式续聊成功，ownerCleanup=true |
| `node test/manual/codex-service-live-313.mjs --mode ipc` | pass，五轮调用；复用 PID 45594，idle/active kill 后恢复到 incarnation 3、PID 46800；原活动轮 failed，显式续聊成功，ownerCleanup=true |
| `node test/manual/codex-service-elicitation-live-313.mjs --run` | pass，真实临时 MCP：run.completed、2 次 elicitation、1 个服务，scope 清理 complete；不保存原始问答 |
| `pnpm native:check` | pass，共享 Schema 输入与三份生成文件摘要一致 |
| `pnpm native:test` 的 Go 阶段 | pass，43 项，包括 434 份权威协议夹具 |
| `uv sync --project native/python` 后 `node native/tests/run.mjs --language python` | pass，43 项，包括 434 份权威协议夹具；仅建立忽略的本地环境 |
| `node scripts/pack-release.mjs` | pass，本地 0.0.0 tgz；无发布 |
| `node scripts/verify-release.mjs dist/release/mininglamp-oss-octo-runtime-0.0.0.tgz` | pass，既有离线包外安装、严格公共类型、文档示例、组件/Kernel/Extra 与清理验收 |
| `node test/manual/codex-service-package-313.mjs dist/release/mininglamp-oss-octo-runtime-0.0.0.tgz` | pass；仅安装主 tgz，strict/no skipLibCheck，公共 Codex/Core/Kernel 的 direct/IPC 各三轮 PID 复用及 owner 清理 |
| `uv run --with pyyaml python .octospec/scripts/lint.py` | pass，658 个 OKF 单元、20 条规则、3991 个本地文件链接 |
| 变更知识元数据及 whitespace | pass，12 份变更知识 Markdown frontmatter 和 context.yaml 解析；`git diff --check` 及新知识尾空白检查通过 |

真实脚本仅终止自身创建并从其 scope/Kernel status 取得的 PID；未扫描或终止当前 Codex App、其他用户进程或全局 daemon。真实 MCP 使用本专项临时 stdio server，不修改原生配置、认证或用户文件。实际输出只含受控诊断元数据；未存储模型 prompt/answer、tool args、env/header/凭据。

## 修复后重验

按用户要求完成 code-review 两轴及串行 verified-review，六个独立问题修复后无未关闭 finding；逐项规则、严重度和运行证据见[审查记录](review.md)。26 项手动专项、最终 tgz 包外 Codex 消费及既有发行验证已在生产代码修复后重跑通过。真实模型 direct/IPC/MCP 记录是此前执行结果，未声称在审查修复后重新调用模型。

最终全量重验发现 native-host 清理断言把 native RPC 错误/EOF 的 next() 拒绝误当成已确认清理；按 Core 原合同显式预期 incomplete，并先启动全部 owner shutdown 再断言。相关 19 项与最终默认全量 2400 项再次通过，服务清理 ID 均为空。初次断言失败阻断的全量运行已停止，未将其列为通过。

初次全量暴露旧测试仍直接调用描述对象、未关闭持有 Core 的 host、thread/unsubscribe 夹具缺响应，以及两份 status 夹具不符合共享 Schema。现有用例迁移为明确 scope/owner 并补齐原协议响应，用例数和默认选择器保持；修复后全量 0 fail。

一次构建并发执行 lint/native 时，clean-dist 导致读取暂时缺失的 dist 类型；改为构建完成后运行，最终 lint 通过。原生测试首轮 Go 通过、Python 因缺本地 .venv 失败；建立该项目环境后 Python 43 项通过。真实 elicitation 首次已完成两次往返，但测试错误要求恰好一次；改为至少一次后重新运行通过，未掩盖 Provider 失败。包外专属夹具首次将输入模式标成宽联合，strict 类型检查失败；收窄为显式 canonical 后重验；macOS 临时路径超过 IPC 预算时改用短路径并显式准备 Home，最终通过。

## 未验边界

Linux、Windows 原生运行和 Electron 外部宿主为 not run；im-test 未配置本专项账户/渠道，A16 为 not run。真实并发审批、完整恢复预算耗尽、所有容量/迟到 ID 组合仍为 partial。Windows 沿用系统 taskkill 的进程树可观测限制，未声称 leader-first 后全部后代可确认退出。没有托管 PR，因此托管 CI checks 为 not applicable。

未改 workflow、job、矩阵、触发器、Gate、默认测试选择器或脚本；新专项均在 `test/manual/` 显式执行。上述实施验证阶段没有 commit、push、PR、merge 或 publish。

## 后续 PR 交付授权

2026-11-05 用户在审查结束后明确“提交 PR -> Main”，授权 commit、push 和 PR 创建，目标为 `main`；不包含 merge 或 publish。再次 `git fetch origin main` 成功，远端仍是原完整基线，无需 rebase。按仓库约定将规划分支更名为 `feat/codex-service-lifecycle`，提交及公开 PR 文本使用英文，保留配置作者和 Codex trailer。

提交前再次核对相对 main 的 workflow、package.json、scripts、锁文件 diff 均为空，默认用例数保持 2400；知识与元数据检查通过。PR 创建后的实际托管检查以 GitHub 为准，不能把本地通过写成远端 CI 已通过；上述“无 PR / not applicable”描述的是运行验收当时状态。

## 外部 Review 修复后重验

PR 为 [#317](https://github.com/Mininglamp-OSS/octo-runtime/pull/317)，用户询问未通过的外部路径 review。整改基线为 `2515e7be6c82c3c6c6562bc868d8ea7f33d6c3e4` 加当前路径修复；macOS arm64、Node 24.22.2。远端原 head 的既有 CI 全绿，code-review 因 P2 为 failure；这不代表下面修复后的远端检查已完成。

| 命令/检查 | 结果 |
| --- | --- |
| `node --test --test-name-pattern='replacing .* selects a new service' --test-timeout=10000 test/manual/codex-service-lifecycle-313.test.mjs`（修复前） | 2 pass、2 fail；绝对 cwd 本来正确，相对 cwd 替换程序后错误复用旧服务；日志 `/tmp/octo-317-relative-command-before.log` |
| 同四项真实 POSIX 可执行夹具（修复后） | 4 pass；文件未变时复用，替换文件后服务 ID/PID 不同，旧服务仍 ready，owner 清理 complete |
| `node --test --test-timeout=20000 test/manual/codex-service-lifecycle-313.test.mjs` | 30 pass、0 skip、0 fail；四项新增用例仅手动运行，Windows 显式跳过 POSIX 可执行夹具 |
| `pnpm typecheck` | pass，完整构建及类型检查 |
| `pnpm lint`、`pnpm lint:names`、`pnpm format:check` | pass |
| `pnpm test:suites` | 2400 项，2334 pass、66 skip、0 fail；默认数量和入口保持 |
| code-review / verified-review | 两轴最终无未关闭项；主 agent 复现前后差异，Spec 实际运行四项回归，Standards 复核测试清理顺序 |

本轮未重新调用真实模型、IM 或执行原生 Windows/Linux 验收，不将 POSIX fake Provider 当成真实 Codex 升级实测。仅修路径计算，未更改旧任务、旧服务的生命周期、升级策略或默认验证范围。相对 main 的 workflow、package.json、scripts、锁文件仍无 diff。

# 规划阶段历史记录

以下记录发生在用户授权实施之前，其中“未实施/未执行”只描述当时状态；当前状态以上文为准。

本轮只规划，未改生产源码或测试脚本。基线 `de3ff37a86ee3cb8f6ab66148ceca817f6ae5240`，分支 `plan/issue-313-codex-service`。本机 macOS，Codex CLI `0.164.0`。

| 检查 | 实际结果 |
| --- | --- |
| `git fetch origin main` | pass，origin/main 更新到上述完整 SHA；原主 checkout 未切分支或改用户文件 |
| 独立 worktree | pass，`octo-runtime-issue-313` 从 origin/main 创建；原有用户未跟踪文件留在原 checkout |
| issue #313 与评论 | 已读取，包含 idle 自动恢复、双向交互、#307 回归和禁止 CI 扩围 |
| issue #307 与澄清评论 | 已读取，15 秒是合格答案后的清理 fallback，不是自动失败依据 |
| 最新源码核验 | Codex 仍逐轮 spawn/close；Core 无服务级清理 hook；#312 已合入 |
| `codex --version`、`codex app-server --help` | pass，0.164.0 提供 stdio 及 schema 生成；未执行 daemon/proxy/登录命令 |
| `codex app-server generate-json-schema --out /tmp/octo-313-codex-schema.RYLyXC` | pass，生成到独占临时目录；确认 thread/config/interrupt/unsubscribe 和 nullable elicitation 形状；不等于真实协议执行 |
| 官方文档 | 已读取 [App Server](https://developers.openai.com/codex/app-server/)，核对协议层边界，未据此宣称并发验收通过 |
| 基线知识检查 | pass，649 个 OKF 单元、20 条规则、3942 个本地文件链接 |
| 本次完整知识检查 | pass，`uv run --with pyyaml python .octospec/scripts/lint.py`：656 个 OKF 单元、20 条规则、3967 个本地文件链接（含常驻进程 doctor 规划）；首轮发现 6 个源码链接路径错误，修正后通过 |
| 本次元数据检查 | pass，单独解析 7 份新知识 Markdown 的 frontmatter，type/title/description 非空、tags 为列表；context.yaml 解析通过 |
| 本次 whitespace 检查 | pass，`git diff --check` 及新文件逐行尾空白检查 |
| CI 范围检查 | pass，`git diff origin/main -- .github/workflows package.json scripts test packages apps public` 输出为空；新文件均在 .octospec 内，默认测试入口未变化 |
| 托管 PR checks | not applicable，本轮没有创建 PR |

## 未执行

M0-M6 与 A01-A21 均为 not run。未执行真实 Codex turn、kill/recovery、模型请求、IM 投递、原生 Linux/Windows、包外运行、doctor 新视图和 Electron 集成。未执行 pnpm 构建/全量测试，因为本次仅修改规划文档；这不构成对实现可用性的证据。

本轮不修改 workflow、默认测试选择器、脚本、Gate 或必需状态。提交、推送、创建 PR 和发布未执行。

规划于 2026-11-04 开始，文档检查在 Asia/Shanghai 日期切换至 2026-11-05 后完成；journal 文件按任务开始日期归档。

2026-11-05 用户追加 doctor 范围：已只读核对 CLI doctor 的组件快照汇总、Kernel status 和共享 Schema 定义，将常驻 PID 视图、最小 status 字段扩展及 A21 加入规划。明确排除 turn/thread/Run、调用计数和临时工具进程，尚未实施。
