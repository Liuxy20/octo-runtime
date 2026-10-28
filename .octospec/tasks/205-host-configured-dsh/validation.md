---
type: Task
title: Issue 205 验证与评审
description: 分别记录本地回归、原生 DSH 和跨平台 CI 的验证证据。
tags: [adapter, testing, runtime]
---

# Issue 205 验证与评审

2026-10-28 用户要求撤除新增的 DSH/Electron 三平台 CI：删除 `verify-dsh` 及 CI Gate 的依赖，workflow 恢复目标分支原样。以下已执行的专项 CI 保留为历史证据，不再作为持续门禁；原生专项仅显式手动运行。

## 按提交核对的当前状态

- 已推送基线 `be855d56038bc3b845612968c82c0cc298116e3d` 的 [CI run 40640404210](https://github.com/Mininglamp-OSS/octo-runtime/actions/runs/40640404210) 已完成且成功，包含原有构建、测试、发行检查与 CI Gate。此前 `b623c40` 的 run 40639444839 因撤除 DSH job 后漏改发行测试断言而失败，已在该基线修正。
- 最新 yujiawei / Jerry-Xin review 针对上述基线，确认 `runCli → runPlayboard` 漏传 `dependencies.env`。此前测试仅直接调用 runPlayboard，未覆盖该调用边界；历史本地评审通过不代表此缺陷已覆盖。
- 本轮补传 env，并新增公共 runCli 路径回归：进程 PATH 指向不兼容的 fake DSH，注入 PATH 指向可用的 fake DSH，修复前返回 DSH_VERSION_UNSUPPORTED，修复后使用注入环境完成执行。两套安装均为 fixture，不调用真实 Provider。
- 本地 macOS 验证：完整 `pnpm test`（含 workspace 构建）通过，UI 35 项、Node 2,137 项通过，58 项条件跳过、0 失败。构建后根 TypeScript noEmit 检查、完整 lint、lint:names、format:check、docs:check、OKF 和 diff 校验全部通过。日志为 `/tmp/octo-runtime-219-playboard-env-{before,full-test,typecheck,lint,names,format,docs}.log`。本轮未改 workflow/action；相对 main 无 CI 配置差异。
- 本轮远端 CI 只能在推送新提交后核对；基线的成功不代表本轮已经通过。下文按实施阶段保留历史验证结果。

## 基线与范围

- 日期：2026-10-28；系统：macOS arm64；Node：24.19.0；pnpm：11.19.0。
- 基线：`59cb21a14259b6dc828f8791b8117ba1f3689f4c`，分支 `fix/205-host-configured-dsh-bin`，验证时包含本任务未提交修改。
- npm Provider 与官方 Client 均为 `0.2.1-rc.3`；Client/Protocol 未修改。
- 范围：本分支 25 个变更文件（源码、测试、CI、示例及文档）逐文件评审；无 lockfile、生成代码或二进制变更，无跳过文件。删除文件只核对引用与发行物清理。

## 执行结果

| 检查 | 结果 | 证据与边界 |
| --- | --- | --- |
| `pnpm typecheck` | PASS | 全 workspace 构建及严格类型检查 |
| `pnpm lint`、`pnpm lint:names` | PASS | 无 lint 或命名问题 |
| `pnpm format:check` | PASS | 完整格式检查；后续变更文件另行定向检查 |
| `pnpm docs:check` | PASS | 双语文档、公开示例严格编译及 4 项运行测试 |
| `pnpm test:suites` | PASS | 2,107 项 Node 测试通过、57 项条件跳过；35 项 UI 测试通过。复用已完成的 typecheck 构建，无需重复构建 |
| `node --test test/dsh-launch.test.js` | PASS | 最后新增的链接目标拒绝回归也通过；该文件 6 项通过 |
| `node scripts/pack-release.mjs` | PASS | 生成单包发行物；未打包 Provider 或 Desktop 桥接文件 |
| `node scripts/verify-release.mjs dist/release/mininglamp-oss-octo-runtime-0.0.0.tgz --expected-commit 59cb21a14259b6dc828f8791b8117ba1f3689f4c` | PASS | 包外离线安装、DSH 调用、公开类型、原生 Kernel/Extra、Home 保留与卸载 |
| 真实 npm DSH / Node | PASS | `OCTO_DSH_NATIVE_BIN=/tmp/octo-runtime-205-native/node_modules/@deepseek-ai/dsh/lib/bin.js node --test test/dsh-native.test.js`：公开 Kernel discovery、版本、官方 SDK 初始化、关闭通过，无模型请求 |
| 真实 npm DSH / Electron 39.8.10 | FAIL | 版本探针通过，初始化被上游原生加载器以 `unsupported Electron runtime fingerprint` 拒绝。fixture 不代表此版本可用；已写入双语兼容说明 |
| 真实 npm DSH / Electron 44.7.0 | PASS | `node scripts/verify-dsh-platform.mjs /tmp/octo-runtime-205-native`：Node 与 Electron 各 7 项检查全部通过。Electron 使用自带 Node 24.21.0；包含公开 Kernel discovery、官方 SDK 初始化和关闭，无模型请求 |
| Windows/Linux 原生平台 | NOT_RUN（本机） | 已加入 CI 三平台 Node/Electron 真实 npm 初始化检查及 CI Gate；远端结果单独记录 |
| 真实模型、IM 联调 | NOT_RUN | 本次只验证启动和 SDK 初始化，不触发消息投递或模型调用，无需读取用户提供的测试账号文件 |

运行日志保存在仓库外 `/tmp/octo-runtime-205-{tests-final,format,pack,release,platform}.log`，不包含认证材料。

## Verified Review

按 [review.md](review.md) 的计划检查正确性、安全、性能、维护性及测试。配置生产/消费、Kernel list/invoke、官方 SDK 子进程启动、环境隔离、缺失/版本/握手失败均已追踪到实际实现，并运行验证。

发现并修正：新增 CI Gate 依赖后旧测试断言未同步（执行复现，定向 20 项通过）；新增文档误写 CLI 配置文件为身份文件 runtime.json（源码确认，已改为 `<home>/<profile>/config.json`）。修正后没有中等级别及以上的未解决代码问题。

Electron 39 的上游原生 runtime 限制是实际验证失败，不作为本次 Adapter 修复已覆盖的能力。其他 Electron 构建、Windows/Linux 及真实模型执行均按对应实测结果报告。

## PR 219 后续修正

基线 `fcba1945672ea07445cd97f3790a2b7286cbea9b`，同一 worktree 与分支；macOS arm64、Node 24.19.0。首版遗漏 CLI 宿主自己的自动解析，已按用户反馈在 apps/cli 补齐。宿主显式配置优先，否则固定 PATH 首个 dsh，经 npm 包名和 bin 元数据解析入口，同时传给常驻 Kernel 和 playboard；不执行 shim、不回退其他安装，保留其他 providerOptions 和 streamLimits。

远端正式 review `5677604970`（yujiawei，2026-10-28）指出校验 realpath 却启动原链接的 P1；现已改为版本探针及 SDK 一致使用 physicalPath。新增测试在 stat 返回后、版本启动前确定性替换目录链接到 Desktop 哨兵。此测试覆盖原链接替换，不声称路径校验提供不可变 inode 或防止安装目录本身被任意改写。review 另提 CI 超时理由，已在 job 就近注明构建/下载预算及每 runtime 120 秒进程限制。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 原 CLI 回归复现 | EXPECTED_FAIL | 将基线 main.ts/playboard.ts 编译到本地生成目录后，新测试的前台 Kernel list 为不可用、playboard 返回 1；2 项失败。随后以当前源码完整重建，生成目录未提交 |
| 原链接替换回归复现 | EXPECTED_FAIL | 基线 launch 运行 Desktop 哨兵，返回 DSH_START_FAILED（version exit 1）；当前实现测试通过 |
| `pnpm typecheck`、lint、lint:names、format:check、docs:check | PASS | 完整构建、类型、代码规范、文档及示例检查通过；canonical path 后另行构建 DSH 并检查改动文件 |
| `pnpm test:suites` | PASS | CLI 修复后 2,120 项 Node 测试通过、58 项条件跳过，35 项 UI 测试通过；canonical path 修正后再次定向验证 DSH/CLI/Windows 文件 |
| 定向 DSH/CLI/Windows 回归 | PASS | `node --test test/cli-dsh.test.js test/dsh-launch.test.js test/dsh-adapter.test.js test/dsh-sdk-boundaries.test.js test/windows-review-regressions.test.js`：105 通过、4 项 Windows 原生条件跳过 |
| 真实 npm DSH / Node 与 Electron | PASS | `node scripts/verify-dsh-platform.mjs /tmp/octo-runtime-205-native`：两个 runtime 各 21 项通过；包括 CLI 自动解析真实 npm 安装、CLI worker discovery、SDK 初始化及链接替换回归，无模型调用 |
| 发行包 | PASS | 重新打包及 `verify-release.mjs --expected-commit fcba1945672ea07445cd97f3790a2b7286cbea9b` 通过，覆盖离线安装、公开类型、Kernel/Extra、CLI 及 Home 保留 |
| 当时基线远端 CI（历史） | 已检查并修正 | run 40628191508 的三平台 npm/Electron 检查全部成功；Windows Node 24/26 发行检查失败于旧测试仍传 command/args，已改成 dshBin 并保留混合大小写环境断言。后续基线结果见上方按提交核对的状态 |

本轮按 review 计划逐文件复核源码、调用点、测试、CI 和文档，无生成文件/锁文件/二进制变更及跳过文件。原 CLI 遗漏与远端 P1 均有修复前后执行证据；修正后没有中等级别及以上的未解决本地代码问题。远端已有 REQUEST_CHANGES 是基线评审，不冒充新提交已获批准。

本轮日志在 `/tmp/octo-runtime-205-cli-*.log` 与 `/tmp/octo-runtime-205-link-before.log`；未读取测试账号、调用模型或发送 IM。

## 首个 PATH 候选的不可用边界

基线 `25e46691d6d45e0568925fd96f13626b381db4c6`。远端 review 5677720476 把两种情况混为一谈：`return packageEntryForCommand(command)` 即使解析为 undefined 也终止整个发现函数，元数据失败不会继续外层循环；已有无关包名加有效第二安装的测试覆盖该行为。实际缺口在更早的 access/stat：损坏链接、不可执行文件或目录会被跳过。

本轮先增加回归，在基线生成代码上复现上述三类候选都选中第二安装（3 失败）；元数据无效和真正缺失命令的对照均通过（2 通过）。随后以 lstat 先确认候选是否存在，仅 ENOENT/ENOTDIR 继续扫描；已经存在的候选后续不可用直接终止。保留原有 terminal return，并将元数据测试扩展至损坏 JSON、无关包名、缺失 bin、空 bin 和越界 bin。

- `pnpm --filter @mininglamp-oss/octo-runtime-cli run build`：PASS。
- `node --test test/cli-dsh.test.js test/dsh-launch.test.js test/windows-review-regressions.test.js`：39 通过、4 项 Windows 原生条件跳过；CLI 常驻 list/invoke 与 playboard 均通过。
- `node scripts/verify-dsh-platform.mjs /tmp/octo-runtime-205-native`：Node 24.19 与 Electron 44.7 各 25 项通过，包括真实 npm 入口解析及 SDK 初始化，无模型请求。
- 改动源码 ESLint、源码/测试 Prettier 与 `git diff --check`：PASS。
- 按 review 计划复核本轮源码、测试和文档，未发现中等级别及以上未解决问题；Windows 的 chmod 可执行位测试明确跳过，损坏链接用 junction 覆盖。

日志：`/tmp/octo-runtime-205-first-candidate-{before,after,platform}.log`。这是该阶段的历史结果；后续基线 CI 见上方按提交核对的状态。
