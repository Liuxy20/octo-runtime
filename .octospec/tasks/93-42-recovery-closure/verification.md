---
type: Review
title: 恢复规划的 verified-review 与本轮验证
description: 固定审查基线和文档覆盖，记录当前主线受控回归及真实现场未验边界。
tags: [testing, documentation, channel, ipc, lifecycle]
timestamp: 2026-10-26T00:00:00Z
---

# 审查范围与方法

本文件记录首轮规划验证。该轮最终基线：`8af836068780ebb76581225254ad7bef18cc8170`，分支`codex/93-42-recovery-plan`。初始从当时最新的`a35aeae3a3b5708449bb6ebd77a9094cff705e33`创建，新建时clean；收尾发现主线新增DSH集成，已快进到最终基线。当时dirty仅包含本任务知识文件。环境为Darwin/arm64，Node.js `24.19.0`，pnpm `11.19.0`。日期为2026-10-26，Asia/Shanghai。随后用户授权的真实测试及新增验证工具另见[live记录](live-verification.md)；两轮均没有产品逻辑差异。

按 `/Users/lvsijia/.agents/skills/verified-review/SKILL.md` 串行执行Track A与Track B。范围为`git diff HEAD --`及全部未跟踪文件；新增文件全文计入。适用规则为用户要求、仓库AGENTS与context中的规则，再用技能通用五维度。没有仓库`.opencodereview/rule.json`；没有委派子Agent。

审查计划：核对本次新增规划是否误把PR96当作未实现、是否越过原生服务/owner/旧Run边界、是否使用失效工具作证、是否将受控结果替代真机/SDK/Provider结果，并逐一核对计时、依赖、命令、链接和授权。

# 逐文件覆盖

| 文件 | 独立核查内容 |
| --- | --- |
| brief.md | 双issue目标、合入状态、独立worktree、产品意图/拓扑、授权范围与非目标 |
| design.md | F01-F11对应当前源码；reason12三分支、健康归属、接口、旧Run与容量限制 |
| plan.md | M0-M6依赖、文件、退出/失败条件；现有与拟新增命令；现场保留与清理 |
| acceptance.md | G01-G12、R1-R7、原S01-S14，双模式证据、180秒计时及Retry-After |
| assessment.md | E01-E20的实际依据、19项准备与1项缺失；不替代验收 |
| context.yaml | 本轮读取范围、九条规则指纹、baseline/issue元数据与当前授权 |
| verification.md | 基线、命令、结果及证据边界；不使用历史测试数冒充本轮 |
| ../../index.md | 新任务可发现，旧#93状态改为已合入而保留现场门槛 |
| ../../log.md | 只记录本轮文档交付和实际检查 |
| ../../journal/shared/2026-10-26-93-42-recovery-plan.md | 复用结论、实际验证、尚缺证据与后续入口 |

审查范围为10个文件、508行变更（跟踪文件增删行加未跟踪文件全文），覆盖10/10个文件，无跳过。源码搜索用于核对文档陈述，不构成对整个仓库的逐行审查。过滤环节只接受源码反证，不把未知项改写成已证实缺陷；无medium及以上新增问题。

复核后已修正规划中的M5/M6依赖：M5收集现场证据，G12工程交付由M6执行，避免循环退出条件。恢复计时同时明确等待ready/online仍计入180秒，并把重新online前发送的消息单列为离线投递试验。

# 本轮执行

| 命令/检查 | 实际结果 | 范围和限制 |
| --- | --- | --- |
| `git fetch origin main`、新建worktree | PASS；基线为上述完整SHA | 原main checkout未改动；未commit/push/PR |
| `pnpm install --frozen-lockfile --ignore-scripts` | PASS | 使用锁定依赖，不修改lockfile；显式build在随后执行 |
| `pnpm build` | PASS，exit 0 | 全workspace构建；Vite有既有use-client与chunk大小提示，不是构建失败 |
| 下方七文件命令 | PASS，46通过、0失败、0跳过，约36.5秒 | fake Provider、loopback加密IM、临时Home及真实本地进程；不是线上服务或OS睡眠 |
| 内部及发行公共namespace检查 | PASS，见下方命令 | 内部spawnWorker及WorkerRpcClient.invokeFrames存在，主包公共入口不导出spawnWorker |
| 仓库知识校验前后比较 | FAIL，均为相同4份旧文档缺少frontmatter | 不能声称全仓知识lint通过；新增OKF及本地链接无新增错误 |
| 任务格式/规则指纹/编号与文本检查 | PASS | 10个变更文件、7个新增OKF单元、九条SHA-256、G/R/S/E唯一完整、链接及空白 |

```sh
node --unhandled-rejections=strict --test test/im-connection-state-machine.test.js test/kernel-heartbeat.test.js test/kernel-worker-supervision.test.js test/kernel-worker-recovery.test.js test/kernel-recovery-matrix.test.js test/recovery-dual-mode.test.js test/extra-status-logs.test.js
```

上表记录最终`8af8360`基线的重跑：冻结安装、完整build、七文件测试及公共namespace检查均重新执行；测试总耗时36472.5毫秒。初始`a35aeae`上也曾46项通过、约36.4秒，该轮不代替最终基线证据。

这46项的exit 0表示现有受控断言通过。其中CLI trial约14.9秒、SDK trial约14.7秒，分别覆盖首次503离线、WS断线、活动worker丢失后的新IM完成、同Kernel的新direct调用和唯一接纳。该计时包含fixture等待，不是生产恢复上界。现有四组direct矩阵走低层submit；M1/M4仍需补高层invoke及真实Provider session checkpoint。

接口反证命令：

```sh
node --input-type=module -e 'import assert from "node:assert/strict"; import * as internal from "./packages/octo-runtime-executor-kernel/dist/index.js"; import * as published from "@mininglamp-oss/octo-runtime/executor-kernel"; assert.equal(typeof internal.spawnWorker, "function"); assert.equal(typeof internal.WorkerRpcClient.prototype.invokeFrames, "function"); assert.equal(typeof published.attachKernel, "function"); assert.equal("spawnWorker" in published, false); console.log("PASS: internal and public exports distinguished");'
```

探索时两次“内部spawnWorker或invokeFrames已不存在”的假设检查均exit 1，实际接口反证该假设。上方命令改为检查真实合同，不是放宽产品断言。文档F08已明确：旧host绑定是问题，内部导出仍存在。这两次失败不计为产品缺陷或恢复测试失败。

知识检查：`uv run --with pyyaml python .octospec/scripts/lint.py`。在任何文档编辑前即exit 1，诊断为：

```text
.octospec/tasks/systemd-directive-paths/brief.md: 缺少完整 YAML frontmatter
.octospec/tasks/systemd-directive-paths/review.md: 缺少完整 YAML frontmatter
.octospec/journal/shared/2026-10-22-systemd-directive-paths.md: 缺少完整 YAML frontmatter
.octospec/journal/shared/2026-10-24-124-sass-build-fix.md: 缺少完整 YAML frontmatter
```

# 验证边界

未运行完整`pnpm test`、跨平台CI、真实Provider/IM、实际合盖/断网、登录自启、系统重启、Bot竞争owner或服务端取证。未实现M1新runner或修改现有live工具；本轮只定位其当前合同缺口。理由分别是本轮纯规划范围，以及缺少专用目标、部署合同和现场执行条件；真机格保持NOT_RUN/BLOCKED。

verified-review对本次规划的验证完成；产品恢复的G01-G12尚未执行完毕，#93/#42保持开放。下一步可直接从M1工具开始，M2部署合同同时由对应维护角色准备。
