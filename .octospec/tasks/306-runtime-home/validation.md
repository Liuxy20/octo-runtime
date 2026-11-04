---
type: Validation
title: "Issue 306：验证记录"
description: "原生 Windows Home/IPC 专项、基线和回归结果；区分平台计算与实际运行。"
tags: [runtime, lifecycle, ipc, testing]
timestamp: 2026-11-04T06:00:00Z
source: self
---

# Issue 306 验证

基线 `e7958065a250e8ed0986715e4a3fb07a70d885e9`，独立 `fix/306-validated-runtime-home` checkout，`core.autocrlf=false`。Windows 11 Enterprise build 22621、x64、普通用户、PowerShell 7.6.5，pnpm 11.19.0；原生 Node 24.19.0 / 26.13.0。测试用户 Home、AppData 和 TEMP 均在 checkout 外的本任务独占目录。不使用真实 Bot、Provider 账号或用户身份。验收在基线上有未提交修改的工作树执行；PR 提交随后记录相同实现与验证资料。

## 原版本与根因

- 原公共 KernelService 不验证 Home：显式 stateDirectory 指向尚不存在的 Home 时，初始化成功、创建 run 并监听真实 Windows Pipe，close complete=true。空 Home 的 componentEndpoint 返回 cwd hash pipe。复现仅证明此入口，没有发现父目录回退。
- frozen lockfile 安装、原版本 typecheck 通过。
- 原版本 Node 24 全量：2401 项：2319 pass / 3 fail / 0 cancel / 79 skip；UI 35/35。失败为 OpenClaw typed/untyped restart 两项 ORPHAN_CLEANUP_INCOMPLETE，以及一项 WeCom configure 断言。
- 另外建立未修改的同 SHA worktree，串行复查六个相关文件：87 项：85 pass / 2 fail / 0 cancel / 0 skip。仅 OpenClaw 上述两项同样失败；Playboard、WeCom configure 等在该轮通过。

## 最终结果

| 检查 | Node 24 | Node 26 |
| --- | --- | --- |
| #306 + #237 + #302 显式专项 | 38 项：37 pass / 0 fail / 0 cancel / 1 skip | 38 项：37 pass / 0 fail / 0 cancel / 1 skip |
| 15 文件相关回归 | 157 项：151 pass / 2 fail / 0 cancel / 4 skip | 157 项：151 pass / 2 fail / 0 cancel / 4 skip |
| 其余 9 个前期失败文件串行复查 | 108 项：86 pass / 1 fail / 0 cancel / 21 skip | 108 项：86 pass / 1 fail / 0 cancel / 21 skip |
| 本地 tgz 包外严格类型和真实 Kernel/Extra 启停 | 通过 | 通过 |

相关回归的两项失败均为上述 OpenClaw restart/ORPHAN_CLEANUP_INCOMPLETE，与同 SHA 干净基线一致。4 项 skip 是本机符号链接权限前提未满足，未伪造通过。补充回归仅剩 Provider discovery 的 Windows provider.exe 清理 EBUSY。 其调用的 Core/Adapter SDK 和该测试源码均未被本次修改，不经过 Home 服务入口。未修改基线单文件复查：Node24 2 项：1 pass / 1 fail / 0 cancel / 0 skip；Node26 2 项：2 pass / 0 fail / 0 cancel / 0 skip。原错误保留，不扩大本次修复到 Provider 文件锁清理。 同 SHA 基线 Node24 也复现同一 EBUSY；Node26 基线本轮通过，保留其间歇性。

专项的 1 项 skip 是真实 Unix socket/getconf 验证，本机没有 Linux/macOS 执行环境。覆盖两个服务缺失/空/相对/~、不存在/非目录/真实 ACL 拒绝、中文空格、无根创建/替代目录/身份日志监听副作用、缓存路径不能补根、CLI 显式准备和旧环境覆盖退役、编码与追加名称预算、聚合 cause/cleanup 投影、Windows >260 真实路径及 256 UTF-16 单元真实 pipe bind。计算允许值不等于实际 bind 证明；本机裸 Node 还接受部分超出文档 256 的名称，SDK 使用文档支持合同，未宣称原生 257 必然失败，也未把所有 EACCES 猜为长度。

Node 24/26 源码构建/typecheck 已执行并通过；最后源码修正后重新编译 Kernel/Host/CLI/public/root，包外消费使用重新生成的本地 tgz。`pnpm lint` 修正后退出 0；`lint:names` 退出 0；最终 `format:check` 退出 0。`docs:check` 通过：35 对双语页、71 Markdown、4/4 行为测试。知识 lint 结果见本次交付记录。既有 `verify-release.mjs` 最终结果：独立进程复验通过；前两轮批处理 KERNEL_TIMEOUT 保留在日志；同 SHA 未修改基线也通过发行验收。本地批处理工具原先逐轮累加 PATH，已经修正为调用后恢复；该工具在 checkout 外。复验使用独立进程，不把这一观察当作所有早期超时的已证实根因。

## 全量执行历史与修正

初期改动后的 Node 24 全量：2401 项：2293 pass / 25 fail / 4 cancel / 79 skip；Node 26 全量（concurrency=2）：2401 项：2308 pass / 14 fail / 0 cancel / 79 skip；两版 UI 均 35/35。它们不是最终 diff 的全绿证据，也未被静默替换。发现并修正了真实调用迁移遗漏：旧 Playboard 测试依赖 OCTO_RUNTIME_HOME、文档检查 helper 未传 home、模拟 Windows 小时日志路径仍为 POSIX，以及 CLI 过早创建未知命令的根。最终通过显式串行相关/失败文件复查验证。没有重新把全量宣称为通过，没有为消除失败增加 skip 或修改默认 selector。

## 复核命令与日志

在独占 checkout 内，`../tools/run.ps1 -NodeMajor 24/26 -PnpmArgs @(...)` 设置本任务独占 HOME/USERPROFILE/AppData/TEMP，再调用 pnpm 11.19.0。Node 24 来自本机 bundled runtime，同一 exe 复制至任务 tools 并配套 npm；Node 26 使用本机已有 26.13.0 工具。工作脚本、原始日志保留在 checkout 同级 work，交付不打包原始配置或全量日志。

```text
pnpm typecheck
pnpm lint
pnpm format:check
pnpm lint:names
pnpm docs:check
node --test --test-concurrency=1 test/manual/runtime-home-306.test.mjs test/manual/kernel-startup-237.test.mjs test/manual/explicit-stop-302.test.mjs
node test/manual/packed-home-306.mjs dist/release/mininglamp-oss-octo-runtime-0.0.0.tgz
node scripts/verify-release.mjs dist/release/mininglamp-oss-octo-runtime-0.0.0.tgz --expected-commit e7958065a250e8ed0986715e4a3fb07a70d885e9
python .octospec/scripts/lint.py
```

15 文件回归：windows-command-launch、playboard、extra-commands、openclaw-runtime-connection、release-process、file-protection、cli-channel、hourly-log、cli-foreground、module-loading、native-module-selection、im-context-gap、host-sdk-lifecycle、service-bind-startup、runtime-endpoint（均 test/*.test.js）。补充 9 文件：channel-tool-environment、codex-app-server、context-mcp、cross-service-windows-native、opencode-v2、webui-session-store、windows-review-regressions、cli、provider-discovery。均使用 node --test --test-concurrency=1，各执行一轮。

最终日志：complete-manual24/26、complete-affected24/26、remaining-regressions24/26、complete-packed-home24/26、complete-release、repair-lint、complete-docs24、complete-format；命令退出码/耗时存 completion-checks.json、remaining-regressions.json。原始全量和基线日志另存 baseline-tests、fixed-tests-node24、full-node26、baseline-current-recheck。

## 平台与范围边界

本地首轮真实运行仅 Windows。Linux/macOS 参数化路径/IPC 是计算检查；该阶段真实 getconf、文件系统、权限和 socket bind 未验证，后续 PR CI 结果另列如下。没有运行真实 Electron 产品或在线 Provider/IM；Electron 仅提供宿主选目录/准备的接入示例。#303 端点布局和迁移保持独立，后续改布局须同步预算；#304 完整启动 catalog 不并入本次；#14 未关闭。没有扩展 CI workflow/job/matrix/trigger/gate/default test selector。

## PR 310 首轮 CI 与修复复核

PR head `0bb575dec96f53f52dc4d37004700c838a01b657`，Actions run `41795217323`：Windows Node 24/26 发行检查通过；Ubuntu Node24 为 2331 pass / 3 fail / 66 skip，Node26 为 2332 pass / 2 fail / 66 skip；macOS 两版均 2260 pass / 74 fail / 66 skip，总数均 2400。失败日志显示三类本次改动引入的边界问题：

- `runtimePaths.socket` 和 runCli 提前派生未使用的常驻端点，使 macOS 长 TMPDIR 下的配置、Playboard 和恢复等命令被 IPC 预算阻断。删除无人消费的内部 socket 字段，实际常驻 RPC/托管时才派生端点；合法服务测试选用短 Home，不放宽传输限制。
- 文件系统预算查询只沿 ENOENT 寻找目录，把可选日志路径中的 ENOTDIR 升级成 Home 失败。现在查询最近目录，标记可选日志的 IO 责任，保留 F31 best-effort 行为和真实 Home 根验证。
- 使用 PATH 查找 getconf 受 fake Provider 的私有 PATH 影响。固定使用 OS `/usr/bin/getconf`，与 Provider 发现环境分离。

修复后在本机 Windows Node24/26 各执行 runtime-debug、runtime-endpoint、cli-dsh、profile-layout、cli-home 及 #306 manual：58 项，54 pass、4 skip、0 fail/0 cancel。Kernel/Host/CLI/public/root 重新编译通过。新增长 Home 数据命令与 Unix 受限 PATH/日志专项仍放 manual，不扩展 CI/default selectors；新增 Unix native 用例在本机跳过。后续 CI 结果以 PR 当前 head 的检查为准。

评审还复现了 service 层用 `startsWith("..")` 把合法 `..hidden` 子目录误当作穿越路径。服务现在直接委托已按完整分量判断边界的 prepareHomeDirectory；补充显式 Unix 专项覆盖 normal、..hidden、未准备和已准备的 Home 外端点父目录。外部根仍由宿主准备，不补建替代 Home。补充后本机 Windows Node24/26 的 #306/#237/#302 专项各 41 项：38 pass、3 skip、0 fail/0 cancel；编译和受影响服务的 ESLint 通过。3 项 skip 均为新增或既有 Unix native 专项。

Actions run `41797963053`（8fd2550e）：Ubuntu Node24/26 完整任务通过；macOS Node26 的完整测试通过，随后全局 Extra 安装验收在读取 factory marker 时失败。该脚本用真实 macOS TMPDIR/realpath 生成安装根和常驻 Home，使实际服务的 socket 超预算、未执行 factory。验收夹具改用 macOS `/tmp` 下独占根并保留 realpath；不改变产品 Home 选择、传输限值、默认 selector 或 CI 配置。其余旧任务在新提交触发后由原工作流自动取消，不记为通过。

## 可选日志评论复核

Head `98a3cb84e3e77113b600057f9f6c83b5cbf94fca` 的 Actions run `41799060365` 六个矩阵任务与 CI Gate 均通过。随后核对 mochashanyao 的可选日志评论，确认现有 errno 白名单仍遗漏 ELOOP/EIO。使用实际编译 validator、VM 隔离的 Unix process 分支、真实本机临时目录和注入的 getconf 返回值/IO errno，修复前 stat/getconf × ELOOP/EIO 四例均得到 HOME_LIMIT_UNAVAILABLE；修复后四例均接受可选日志，Home 自身的 ELOOP/EIO 和静态文件名超限仍拒绝。该探针是 Windows 下的故障注入，不是原生 Unix 实机证据。

修复在可选资源查询调用处隔离 IO 失败，不再补充 errno 白名单；必要资源与字符串/静态长度检查不在隔离范围。公共服务显式回归新增循环日志链接、Home 根同类错误、Home EIO、可选日志长度及 Unix log-stat/getconf EIO。只处理本 PR 的日志启动边界，不修改 #237 历史断言，不扩充工作流或默认测试 selector。

本机 Windows Node24/26 各执行 #306 manual、runtime-debug、extra-startup、service-bind-startup：44 项，39 pass、5 skip、0 fail/0 cancel。真实自循环目录 junction 返回 ELOOP；日志使用该路径时 Kernel/Extra 均 ready、可 RPC 查询并 complete close，同一路径作为 Home 则拒绝。Home EIO 注入和可选日志长度拒绝也通过。编译、ESLint、文档 4/4 行为检查和知识 lint 通过。Unix 公共服务 EIO 专项在 Windows 跳过，不能把 VM 注入结果算作原生 Unix 验收。
