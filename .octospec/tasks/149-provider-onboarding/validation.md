---
type: Validation
title: Issue 149 文档实现与本地验收
description: 记录示例、会话、图片、权限和清理专项的当前版本证据与限制。
tags: [documentation, adapter, testing]
timestamp: 2026-11-01T00:00:00Z
---

历史验证数量沿用当时完整范围，不表示当前支持范围。

# 当前验证版本

最新合入基线为 `7fd022cd`，本轮工作区继承 PR 提交 `76ac6856` 后合并 main，冲突处保留上游更完整的公共/内部模式说明。下方各次验证只适用于各自标明的版本，不将不同版本的计数视为同一次结果。未重跑的构建和专项仍只引用历史版本。

| 被测版本 | main 基线 | OKF 结果 |
| --- | --- | --- |
| `338c0e47` | `a5a32835` | 535 单元、20 规则、3437 链接，通过 |
| `76ac6856` | `8510fc9b` | 537 单元、20 规则、3442 链接，通过 |
| 本轮合并工作区（`76ac6856` + main） | `7fd022cd` | 545 单元、20 规则、3462 链接，通过 |

本轮 `pnpm docs:check` 通过（4 个执行示例）；无未解决冲突，`git diff --cached --check` 通过。相对最新 main 的 workflow、依赖和 lockfile diff 为空；15 个变更文件只含文档与一条 TypeScript 注释。

PR `76ac6856` 的 GitHub 构建矩阵与 CI Gate 已通过；code-review 状态为失败，存在一条请求修改和一条批准意见。请求修改中的验证计数歧义在本轮修正；所谓 Gateway 功能超范围经 `git diff origin/main...HEAD` 核对不成立，该实现来自上游 #271，不是本 PR 相对目标分支的改动。

# 首次交付验证（历史：338c0e47）

用户追加授权修复 OKF 问题、提交并创建 PR。该次交付基线为 `a5a32835882deab5e2364b559dd06bf1675c1335`，产出提交 `338c0e47`；以下检查和计数仅对应这一版本。

原四个格式问题由上游 #270 修复。同步后又发现 #267 的 brief、validation 和 journal 缺少 frontmatter，本轮仅补三处元数据，保留历史正文。知识目录冲突合并后同时保留 #263 与 #149 入口。

在新基线及最终文档修改上重跑：

- `pnpm install --frozen-lockfile --ignore-scripts`、`pnpm build`：通过，无依赖或锁文件差异。
- `pnpm docs:check`：通过，4 个执行示例测试通过。
- 上述六文件专项：89 项中 88 通过、1 真实 Codex opt-in 跳过，0 失败/取消。
- `node /tmp/ort50-verify.mjs`：30 个双语 README 输入片段、实际 Core fresh/fresh/continue、完整扩展 binding、旧字段拒绝、Context 映射通过；源码去注释转译与新基线相同，workflow diff 为空。
- `uv run --no-project --with pyyaml python .octospec/scripts/lint.py`：全仓通过，535 个 OKF 单元、20 条规则、3437 个本地链接。
- `git diff HEAD --check`：通过。Standards 与 Spec 在新基线上复核，剩余发现均为 0。

本轮日志分别为 `/tmp/ort50-delivery-install.log`、`/tmp/ort50-delivery-build.log`、`/tmp/ort50-delivery-docs.log`、`/tmp/ort50-delivery-tests.log`、`/tmp/ort50-delivery-probe.log`、`/tmp/ort50-delivery-okf.log`。记录编写时为提交前 dirty 工作区，最终提交与 PR 引用由 Loop 结果评论绑定；仅收尾文档随后更新，不影响已测可执行代码。

本轮所需本地验证全部通过；真实 Provider/IM、Windows/Linux 真机和全量测试仍未执行。未扩大 GitHub CI，无本轮托管检查通过承诺；创建 PR 后由平台运行既有检查。不自动合并。

# 首轮历史验证（已被上方结果取代）

## 代码版本与范围

源码基线 `0bcd89c528018ffd508ca8099c8ac9c6b88de35d`，分支 `docs/149-provider-onboarding`，本轮文档与注释为未提交工作区。主机 `lvsijiaMacBook-Pro.local`，macOS，Node `v24.22.2`，pnpm `11.19.0`。

已 fetch 并核对 `origin/main@a5a32835882deab5e2364b559dd06bf1675c1335` 相对基线的 #268、#270、#269。保留已审查基线，不把上游 CLI、文档检查和七天预算实现混入本轮。未修改依赖、锁文件、测试实现或 CI；未提交、推送、创建 PR。

变更包括 Codex/Claude 双语 README、双语输入参考、Adapter 编写/Provider 指南，以及 Codex 一条会话注释。Provider 指南还存在公共 `protocolMode` 示例及 OpenClaw 每轮新建会话的旧说明，已改为当前 `protocol_mode` 和显式句柄续接。已正确的会话指南和图片格式/容量说明复用链接，不重复改写。

# 验收结果

| 验收项 | 证据与结果 |
| --- | --- |
| A1 当前配置示例 | 30 个双语 Provider README 输入片段通过 `InvokeInput.check`、实际 `prepareInvokeInput` 与 `assertInvokeRequest`。Codex/Claude 示例确认默认 `ask` 且无 effort 覆盖。旧字段拒绝及 Context `assisted`/`high` 映射受控校验通过。 |
| A2 完整会话 binding | 实际 `AgentExecutor` 加 fake Adapter 连续三次调用；同一业务 ID、不传 binding 为 fresh/fresh，显式回传完整 binding 后为 continue；嵌套 Provider 扩展字段完整保留，三轮均收到 `run.completed`，shutdown 为 complete。 |
| A3 Codex 图片 | 既有专项通过混合顺序、resume fallback 及纯图片用例；原生 image data URL 与文案一致。真实 Codex 图片测试跳过，未声称真实模型可用。 |
| A4 清理边界 | Codex canonical/native 的取消、完成、EOF 和暂停消费组清理，以及共享 NDJSON 组清理、升级和确认用例通过。源码逐项核对 POSIX 独立组、Windows 未启用 processTree 和注入 child 不拥有组。 |
| A5 当前入口与历史 | 定向扫描 Provider 双语 README、公共 docs、`.octospec/guides`：未发现继续推荐旧 Runtime 权限/推理字段或 `pnpm daemon`；OpenCode 的原生 `--thinking` 保留。现有输出参考已区分终态、ACK、清理和投递，README 改为链接该共同说明，无需新建终态图。历史 issue/journal 中固定版本字段保留。 |
| A6 文档与范围 | `pnpm docs:check` 和工作区 whitespace 检查通过；额外 Markdown AST 检查变更文档本地链接；新增 OKF frontmatter/context 定向检查。源码经 TypeScript 去注释转译与基线输出完全一致，确认无执行行为改动；相对 origin/main workflow diff 为空。 |

## 命令与计数

- `pnpm install --frozen-lockfile --ignore-scripts`：通过，仅准备 worktree 本地依赖，无锁文件变更。
- `pnpm build`：通过；日志 `/tmp/ort50-build.log`。WebUI 依赖的 module directive 提示未阻止构建。
- `pnpm docs:check`：通过。18 对双语页、37 个 Markdown 文件、22 个 JSON 示例、16 个 Mermaid 块、12 种 Context；示例测试 4 通过、0 失败。文案审查修正后已重跑，日志 `/tmp/ort50-docs-final.log`。
- `node --test test/adapter-multimodal.test.js test/codex-process-cleanup.test.js test/process-group-cleanup.test.js test/adapter-permission-modes.test.js test/reasoning-levels.test.js test/invoke-input.test.js`：89 项，88 通过、1 跳过、0 失败/取消。唯一跳过为真实 Codex 图片识别 opt-in。日志 `/tmp/ort50-tests.log`。
- `node /tmp/ort50-verify.mjs`：临时本地校验，未加入仓库或默认测试。校验 30 个 README 输入片段、实际 Core 三轮连续性、旧字段拒绝、Context 映射、Markdown 本地链接、去注释转译一致及 workflow 范围。日志 `/tmp/ort50-probe.log`；脚本 SHA-256 `4afcb29cbb2ab52a1377267f6e652de5350c1805753d1382088e526b624e4305`。
- `git diff --check`：通过；新建文件另用定向检查校验 frontmatter 和尾随空白。

README 片段覆盖 ACP、Antigravity、Claude Code、CodeBuddy、Codex、DSH、Grok Build、Hermes、Kimi Code、MCode、OpenClaw、OpenCode、Qoder CLI、Qoder CN 的英文与中文文件各 1 个。DSH 示例的宿主路径变量在临时校验中注入本机绝对路径，仅验证请求准备，不启动 Provider 或验证该安装可用性。Adapter SDK 的 authoring 示例不属于公共 InvokeInput 片段。

## 已知基线检查问题

`uv run --no-project --with pyyaml python .octospec/scripts/lint.py` 返回 1：#137 的 brief/review/journal 与 #246 validation 共四个既有文件缺少 frontmatter，与规格阶段相同。本轮未修改这些文件；新增任务文件的定向格式检查通过。全仓 OKF lint **未通过**，不写成全仓绿色；这些已有问题在上游 #270 已有修复，合入目标分支时须重新确认。

临时校验脚本调试中先后修正了缺少 DSH 宿主变量和 TypeScript scanner 对模板上下文的误判，最终使用实际编译器去注释转译比较。没有为让验证通过而改动产品代码或放宽断言目标。

## 托管检查与未验范围

本分支未推送，没有本轮托管检查结果。读取基线 GitHub check-runs：`CI Gate`、Build/test/package 的 ubuntu/macOS × Node 24/26、Windows release Node 24/26、Secret Scan、welcome label 和 release draft 均已完成成功；这是基线历史结果，不作为本轮通过证据。现有 workflow、矩阵、触发条件及必需依赖未变，未新增或启用专项 CI。

未运行全量测试、真实 Provider/IM、Windows/Linux 真机或系统服务安装。纯文档与注释修改不需真实模型调用；本机 POSIX fake Provider 测试不能证明其他平台或模型行为。Windows 进程树能力按源码调用路径确认，宿主崩溃及逃逸进程不作回收保证。

最终审查与处置见[双轴审查](review.md)，规格见[brief](brief.md)。

首轮流程结果为实现完成、全仓 lint 未通过并返回规格审查；用户后续授权修复与交付，已按文首结果解除该阻塞。
