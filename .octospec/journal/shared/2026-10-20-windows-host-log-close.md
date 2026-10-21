---
type: Journal
title: Windows Host 正常关闭与日志排空验证
description: Issue #38 的关闭顺序修复、原生 Windows 复现与回归、SDK 兼容证据。
tags: [windows, lifecycle, ipc, logging, testing]
timestamp: 2026-10-20T09:05:00Z
source: self
---

# Windows Host 正常关闭与日志排空验证

## 当前 rebase 范围

当前基线为 main d44f5cd42694b5f8cb7c8c18daa65eff0265ba8e（已含 #76）。#61 已把 launcher 迁入 Executor Kernel，并删除 daemon；#73 提供 KernelClient.invoke；#72 明确公共层的 Node-only 约束；#74/#71 把 Kernel 服务改为调用进程直接构造。产品修改限于 [process.ts](../../../packages/octo-runtime-executor-kernel/src/process.ts) 与 [serve.ts](../../../packages/octo-runtime-executor-kernel/src/serve.ts)：保留 EOF、4 秒宽限、整段关闭 Promise 和 finally 管道释放，并在排空后保留 worker leader，由 launcher 继续执行现有树清理。保留当前 onSpawn、IPC、进程树 cleanup 和启动失败回滚。旧 supervisor 的 7 秒补丁及 daemon 日志 fixture 已随上游架构删除，不向新 Host SDK 迁移旧预算。

对应回归改走当前 createKernelService→Kernel→worker，检查健康日志、ServiceCleanupResult.complete、phase/closed、worker 退出和再次构造。Kernel PID 等于调用进程，SDK 不退出宿主。cleanup 错误回归只拒绝本次 PID 的 taskkill；断言当前 PROCESS_TREE_CLEANUP_INCOMPLETE 原样传播，管道释放不等于 worker 已退出。本次新架构的检查结果在文末单列，以下旧架构证据不代表当前版本已验证。

## 历史结果与实现（#61 之前）

[Issue #38](https://github.com/Mininglamp-OSS/octo-runtime/issues/38) 的正常关闭日志缺陷已完成本地修复，原 F31 的失败用例修复后通过。Windows Host launcher 在原 close 内部先结束 stdin，让 serve.ts 执行已有 shutdown/logging.close，最多等待 4 秒再进入既有 cleanup；整个关闭过程共用同一个 Promise。公开调用方无需改动，POSIX 组清理、启动失败回滚和日志的有界可丢弃语义保持原样。范围见[brief](../../tasks/windows-host-log-close/brief.md)。

当时产品修改在 [process.ts](https://github.com/Mininglamp-OSS/octo-runtime/blob/3c46dea3bbe8b8ceca927145e6056734c7811a0f/packages/octo-runtime-adapter-host/src/process.ts) 和 [supervisor.ts](https://github.com/Mininglamp-OSS/octo-runtime/blob/3c46dea3bbe8b8ceca927145e6056734c7811a0f/packages/octo-runtime-daemon/src/runtime/supervisor.ts)：Windows supervisor 首次等待 daemon 退出从 5 秒调整为 7 秒，给本次新增 Host 宽限之后的 daemon 日志留出收尾机会。新增 [关闭回归](../../../test/host-process-close.test.js)和 [fixture](../../../test-support/fake-host-close.mjs)。没有修改共享 process-cleanup、日志 Worker、协议、Provider 实现或 CI 配置。

## 环境与隔离

Windows 11 10.0.22621、x64、PowerShell 5.1，Node 24.22.0、pnpm 11.19.0，非 WSL。初始基线 main 7fb81e930675c62897e436828b5a1fcdc8c99f40，已含 #37；独立 worktree、Home 和 temp，子进程采用 OS/工具链环境白名单。全部执行验证使用 fake Provider，未调用真实模型、业务 API 或 Bot，未构建或重启日常 Runtime。

原始命令、时间、退出码及完整脱敏错误保留在本机忽略目录 .cache/issue38/，不随 PR 提交。仓库测试可以独立运行。

## 修复前后证据

修复前运行 node --test --test-name-pattern="F31 Host logging requires an explicit directory" test/runtime-debug.test.js：disabled 通过，enabled 在 invocation 完成且 close 返回后失败；没有增加调用方 sleep。日志 baseline-2026-10-20T03-06-08.979Z.log 的错误为：

~~~text
F31 Host logging requires an explicit directory (enabled=true)
Error: ENOENT: no such file or directory, scandir '<isolated temp>/oh-metadata-1iWNHW/logs'
    at async readdir (node:internal/fs/promises:1668:18)
    at async logPath (test/runtime-debug.test.js:15:6)
    at async TestContext.<anonymous> (test/runtime-debug.test.js:53:22)
errno: -4058, code: ENOENT, syscall: scandir
~~~

修复后的原 F31 enabled/disabled 及不可用目录 3 项通过。健康日志包含 rpc.invoke_received 和 completed 的 invoke.finished，保留隐私断言；禁用不创建日志目录，目录故障不妨碍执行。

新增 9 项 Windows 回归覆盖立即关闭、完成后关闭、并发/重复 Promise、再次启动、独立 Host、慢关闭、EOF 不响应 fallback、Worker 不确认超时、已退出/损坏 stdin、readiness 超时直接回滚及活动调用合作取消。关闭后检查真实 Host 退出；合作取消用例另行确认其创建的工具停止，仅用于验证已有关闭行为。

SDK 测试走真实 createDaemonRuntime→daemon 子进程→Host 子进程，fixture 给原 shutdown 增加 2400 ms、给原 logging.close 增加 800 ms。两轮 startAccount→invoke→stop→再次启动均检查 Host 正常退出、daemon PID 消失、健康完成日志完整。整合 PR #45 后采样为 3454/3391 ms；这是具体场景证据，不以 4.6 < 5 推导所有关闭都兼容。

## 检查记录

| 命令/检查 | 实际结果 | 本机日志 |
| --- | --- | --- |
| pnpm typecheck（含构建） | 退出 0 | build-2026-10-20T03-07-00.202Z |
| 原 F31 enabled/disabled、不可用目录 | 3/3 通过 | logging-2026-10-20T03-42-41.824Z |
| host-process-close、runtime-logging、host-spawn-error、process-group-cleanup、host 五个测试文件 | 35 通过、0 失败、10 POSIX skip | focused-2026-10-20T03-22-43.529Z |
| 整合 #45 后 name-lint、host-process-close、runtime-logging | 19/19 通过 | pr45tests-2026-10-20T03-42-20.595Z |
| pnpm lint、pnpm lint:names、pnpm format:check | 均退出 0 | lint 03:33:51、names 03:42:42、format 03:42:44 |
| pnpm test:suites | WebUI 35/35；Node 1258 项：1175 通过、53 失败、30 skip | suites-2026-10-20T03-10-01.085Z |
| OKF lint | 14 个已有跨仓库链接目标缺失，本次知识文件无报错 | spec-2026-10-20T03-46-26.707Z |

完整 Windows 套件未通过。为对照失败，在同一工作树仅将 process.ts 编译产物暂换为基线版本，运行既有 Node 套件后恢复修复产物：1249 项中 1165 通过、54 失败、30 skip。修复后 53 个失败名称中有 52 个与基线重合；原 F31 enabled 由失败转为通过。

另外两个差异分别是 daemon 的 HostFrame 上限测试和 SDK Extra 取消测试，错误均涉及 invocations.json 的 rename EPERM。独立对照时两者在基线和修复版均通过，但双方仍输出该文件错误。因此保留全量失败与不稳定结果，不能把一次定向通过写成修复了它们。其余错误主要涉及 Windows 上的 Unix socket、POSIX 权限/路径、symlink、shell fixture、WebUI 响应及 Node 原生断言；这些不加入本次 #38 修复。

## 兼容性与交付

公开 process.d.ts 修复前后的 SHA-256 均为 2101EF4670AC49C0D458599316937D7EC147713A50750B3FAC1D53B2CF84FFA9。公共入口、package exports、协议 schema/生成类型、锁文件没有变更。原调用代码、错误传播、启动回滚和 POSIX 进程组路径保持原合同。

开发分支曾整合 PR #45 的 3a9e164cdf4269520f414b1ccdb0d66210872021，相关命名、关闭和日志验证通过。#45 于 2026-10-20T05:56:02Z 合并为 main 83afae46e49023856c08f8645a453e17ef8802f3；两个版本的源码树相同（18fcc8b6df695238cb19f58423c3b0607dc8ff27）。本修复已对齐正式 main 并恢复全部 #38 改动，无冲突；PR 不重复包含 #45 提交。macOS/Linux 和远端 CI 的最终结果以 PR 检查为准，不将本机跳过写成通过。

## #45 合并后的历史复核

基线 83afae46e49023856c08f8645a453e17ef8802f3。收敛 #38 范围后重新构建和验证：typecheck、lint、lint:names、format:check 全部通过；关闭/日志/lifecycle 定向 35 通过、10 POSIX skip，原 F31 三项通过。SDK 两次慢关闭为 3603/3469 ms。完整 Windows Node 套件 1261 项：1179 通过、52 失败、30 跳过，WebUI 35/35；失败名称均在此前基线/修复验证中出现，未声称全量通过。OKF 仍为原 14 个跨仓库链接缺失。

最终日志：build-2026-10-20T06-07-36.953Z.log、focused-2026-10-20T06-09-11.887Z.log、logging-2026-10-20T06-09-33.699Z.log、suites-2026-10-20T06-09-34.949Z.log、lint-2026-10-20T06-11-33.243Z.log、names-2026-10-20T06-11-57.666Z.log、format-2026-10-20T06-11-59.457Z.log、spec-2026-10-20T06-12-07.828Z.log（本机 .cache/issue38/）。公开声明哈希与基线一致，差异仅含 Host close、对应 fixture/回归和本次知识记录。

## #52 rebase 与关闭预算评审修正

本次最终基线为合并 #52 后的 main 6fb8ca5364cd885f5617878e5ea4901f903de3ff，rebase 无冲突。慢关闭 fixture 透传上游新增的 shutdown 清理结果。原 PR head 60b884f 的评审指出 Host 新增 4 秒宽限可能挤占 supervisor 5 秒退出等待；按真实 SDK→daemon→Host 链路验证后，确认该预算冲突成立。

独立受控验证只让 Host 忽略 EOF，并将真实 daemon 日志 Worker 最后一条测试记录的处理延迟 900 ms，保留原 Worker 和 1 秒 close 预算。5 秒 supervisor 下，Host 已回收、manifest 已移除，但 daemon 仍在排空日志时触发 taskkill，尾部记录缺失；换回 #38 之前的 launcher、保持同样 Worker 延迟，则正常退出并落盘。日志 boundary-2026-10-20T07-52-28.382Z.log 中：当前 launcher/正常日志 stop 4640 ms，无 taskkill；当前 launcher/慢日志 5335 ms，触发 taskkill、尾部缺失；旧 launcher/慢日志 1481 ms，无 taskkill且尾部完整。三者均可再次启动；该证据没有复现重启失败，也不代表健康 Host invocation 日志被截断。

最小产品修正仅将 Windows supervisor 第一次 waitForExit 从 5 秒改为 7 秒，覆盖 500 ms 轮询、4 秒 Host 宽限、600 ms cleanup、1 秒 daemon 日志和调度余量。正常退出立即返回；完全卡住的 Windows daemon 最多比原来多等待 2 秒再进入既有强制回收。Host 4 秒、POSIX 5 秒、强制回收后的 5 秒及公共 API 均不改变。

新增可独立运行的回归：`node --test --test-name-pattern="Windows SDK EOF fallback" test/host-process-close.test.js`。真实 SDK 使用同一 Home 连续启动/停止两轮；fixture 观察原 500 ms 控制轮询以对齐相位，不修改周期，实际日志仍由原 Worker 写入。断言 daemon 自主 exit(0)、logging.close 完成、尾部记录落盘、Host/daemon PID 消失及 manifest 移除。

| 验证 | 实际结果 | 本机日志 |
| --- | --- | --- |
| 新回归，原 5 秒预算 | 失败，stop 5383 ms；缺少 daemon 自主退出事件，`daemon must exit itself after draining logs` 断言失败 | boundarytest-2026-10-20T08-06-54.559Z.log |
| 同一回归，7 秒预算 | 两轮通过，stop 5476/5466 ms；自主退出及尾部落盘断言通过 | focused-2026-10-20T08-08-39.053Z.log |
| 原 SDK 正常慢关闭 | 两轮通过，stop 3510/3542 ms | 同上 |
| 五个关闭/日志/Host 专项文件 | 36 通过、0 失败、10 POSIX skip，含 10 项新增 Windows 用例 | 同上 |
| 原 F31 enabled/disabled、不可用目录 | 3/3 通过 | logging-2026-10-20T08-08-56.988Z.log |
| pnpm typecheck（含构建） | 退出 0 | build-2026-10-20T08-07-34.045Z.log |
| pnpm lint / lint:names / format:check | 均退出 0 | lint 08:09:44、names 08:09:44、format 08:08:55 |
| pnpm test:suites | WebUI 35/35；Node 1322 项：1239 通过、53 失败、30 skip；新增边界回归通过，stop 5532/5644 ms | suites-2026-10-20T08-10-14.521Z.log |
| OKF lint | 14 个已有跨仓库链接目标缺失，本次文件无报错 | spec-2026-10-20T08-12-23.906Z.log |

最新全量结果中 52 个失败名称与 #45 合并后的验证一致。额外 1 个为 release-manifest 扫描遇到 rebase 前残留的 `packages/octo-runtime-core/node_modules`，该旧包目录仅含已忽略的依赖、没有受 Git 管理的源码或 package.json；将它移入本次忽略缓存后，`node --test --test-name-pattern="发行源码清单保持" test/release-manifest.test.js` 单独复测通过。未修改清单测试或发行代码，未重跑整套，也未宣称整套全绿。

公开 process.d.ts SHA-256 仍为上述基线值。日志关闭提供既有有界排空机会，不提高为必达保证；超过 Worker 预算或写入故障仍按原可丢弃语义处理。

## cleanup 拒绝时的管道收尾

基于 PR 提交 5226dfd，评审指出 cleanup 抛错会跳过本层管道释放。原生 Windows 隔离对照确认：向测试创建的 Host 注入终止失败时，main 基线也存在未释放管道；因此该对照不把它认定为本次新增的自然 Windows 回收故障。仅补齐当前 close 的错误路径：将已有 Windows stdio.destroy 放入 cleanup 的 finally，保留原始拒绝、cause 和同一关闭 Promise。管道释放不代表 Host 已退出；不增加 unref、不改变回收算法、预算、POSIX 或公共 API。

新增回归只替换本次测试 ChildProcess.kill，让 TERM/KILL 抛出同一 EPERM，真实 cleanup 仍运行原预算。断言三条管道释放、PROCESS_CLEANUP_TIMEOUT 及原始 cause 保留、重复关闭复用同一个 Promise/错误且不重复发信号，同时确认测试 Host 仍存活。测试随后用保存的真实 kill 回收自身 Host；该测试清理不作为产品回收成功的证据。

| 验证 | 实际结果 | 本机日志 |
| --- | --- | --- |
| 新回归，finally 修改前 | 失败：`stdout must be released after cleanup rejection` | cleanuprejection-2026-10-20T08-56-07.680Z.log |
| 新回归，finally 修改后 | 通过，约 4711 ms；管道、错误和重复关闭断言通过 | focused-2026-10-20T09-03-48.095Z.log |
| 五个关闭/日志/Host 专项文件 | 37 通过、0 失败、10 POSIX skip；含 11 项 Windows 回归 | 同上 |
| 真实 SDK 正常慢关闭 / EOF fallback 与慢日志 | 分别 3483/3428 ms、5474/5436 ms，两轮均通过 | 同上 |
| 原 F31 enabled/disabled、不可用目录 | 3/3 通过 | logging-2026-10-20T09-03-50.142Z.log |
| typecheck（含构建）、lint、命名、格式 | 全部退出 0 | build 08:57:21、lint 09:00:01、names 08:59:59、format 08:59:58 |
| OKF lint | 仍为 14 个已有跨仓库链接缺失，本次文件无报错 | spec-2026-10-20T09-07-51.422Z.log |

公开 process.d.ts 哈希仍与上述基线一致。本次局部收尾后未重跑整套 Windows 套件，前节全量结果属于 5226dfd；已知失败继续保留，不声称全量通过。

## #61 / #73 之后的 rebase 验证

PR 原 head 为 3c46dea，当前 main 为 e82a2f0。产品 diff 只保留新的 executor-kernel/src/process.ts 中的 #38 关闭逻辑；没有恢复 daemon、修改 SDK 预算、共享进程回收、协议、Provider 或 CI。上游的 onSpawn、IPC 监督、进程树回收及 startup rollback 保留。冻结依赖安装通过；旧包仅含忽略的 dist/node_modules 的残留目录经核实后移入本次缓存，不删除源码或用户数据。

原 F31 enabled/disabled 在当前 main launcher 的一次采样中均通过（kernelred-2026-10-20T15-04-16.177Z.log）；不能把旧版本 ENOENT 复现写成新 main 的每次结果。新的受控慢关闭回归使用同一 fixture（执行器 shutdown 延迟 2400 ms、logging.close 延迟 800 ms）：main launcher 在预算完成前结束 close，断言失败；#38 launcher 等待健康收尾，断言通过。对照使用仅在测试中加载 main launcher 的 hook，未修改产品源码，日志 kernelslowred-2026-10-20T15-07-41.917Z.log。fae6333 与最终 e82a2f0 的 launcher 相同。

新 SDK 测试经 startOwnedKernel 与 KernelClient.invoke 完成调用后停止。最终全量中的两轮慢关闭为 4042/4108 ms，健康完成日志完整且 worker 自主 exit(0)；两轮 EOF 不合作 fallback 为 6245/6216 ms，均确认 CleanupResult.complete、processExited、清单移除及 Kernel/worker PID 消失，并可再次启动。这是整条实际链路的采样，不用超时常量或 PID 单项推导所有情况都能完成回收。合作工具退出仍由 fixture Provider 执行；不合作资源或未确认清理不属于已通过的全量工具回收保证。

cleanup 拒绝回归跟随当前 Windows processTree 路径，只让本次 worker PID 的 taskkill 报错；验证三条管道释放、原 PROCESS_TREE_CLEANUP_INCOMPLETE 及相同 Promise/错误保留、不重复 taskkill，同时确认 worker 仍活着。随后由测试独立回收本次进程，该动作不记为产品清理成功。日志 Worker 超时和写入故障保留原可丢弃语义。

| 本次检查 | 结果 | 本机 .cache/issue38 日志 |
| --- | --- | --- |
| 冻结依赖安装 | 退出 0 | install-2026-10-20T14-53-07.599Z |
| 最终 typecheck（含构建） | 退出 0 | build-2026-10-20T15-10-46.977Z |
| #61 后关闭/日志/Host 专项 | 37 通过、10 POSIX skip | focused-2026-10-20T15-04-15.123Z |
| #61 后 SDK/worker supervision 专项 | 7 通过、1 skip | lifecycle-2026-10-20T15-04-17.010Z |
| #73 后最终 Windows 全量 | WebUI 35/35；Node 1340 项：1283 通过、19 失败、38 skip；11 项 #38 回归和原 F31 三项均通过 | suites-2026-10-20T15-14-32.712Z |
| 最终 lint、lint:names | 均退出 0 | lint-2026-10-20T15-14-34.369Z、names-2026-10-20T15-14-33.927Z |
| 最终 OKF 检查 | 258 个单元、20 条规则、1621 个本地链接通过 | spec-2026-10-20T15-26-47.075Z |
| 相对当前 main 的公开 process.d.ts | 声明文本一致 | preparebaseline-2026-10-20T15-14-20.941Z |

全量失败不扩入 #38：包括 POSIX 权限/路径/服务 fixture、缺少 Go 编译工具及其他 Windows 集成结果，具体归属以同环境 main 对照记录为准。格式初检的额外告警来自 Git checkout 的 CRLF；对照 main 原始 blob 确认其格式正确，仅恢复原 LF，未产生其他受跟踪差异。日志 mainformat-2026-10-20T15-18-14.275Z。

同环境对照仅把编译产物 process.js 暂换为 e82a2f0 的 launcher，运行既有 Node 套件后在 finally 恢复修复产物。main 对照为 1329 项：1273 通过、18 失败、38 skip（kernelbaseline-2026-10-20T15-17-23.567Z.log）；18 个失败名称全部与修复版重合。修复版多出的 owner-exit/readiness 测试在尚未就绪时出现清单 rename EPERM，尚未返回本次修改的正常 close；它在修复版和 main 独立重跑均通过（startup-2026-10-20T15-24-18.991Z、startupbaseline-2026-10-20T15-24-59.143Z）。保留该全量不稳定结果，不声称已修复它或全量通过。最终 format:check 退出 0（format-2026-10-20T15-18-46.955Z），当前构建产物已恢复 #38 版本。

## 2026-10-21：yujiawei 的父先退评审与最小修正（main 70f0247）

本轮只处理 PR #53，用户明确 #58 的 CLI 方案不进入本轮。main 70f0247 的 process.ts 冲突仅为关闭注释重叠，保留上游中文说明及当前 Node-only 边界后完成 rebase。原生环境复核为 Windows build 22621、x64、PowerShell 5.1、普通用户，Node 24.22.0 / pnpm 11.19.0；全部为隔离的 fake Provider/本地进程。

评审指出的回归成立，但不能从父 PID 消失直接推断每个工具都会残留：普通 Node 子进程在本机未残留；可独立生存的 detached 工具在 EOF 先退路径中仍存活，而同场景使用 main launcher 时被树清理终止。父退出后额外调用 taskkill 返回 128，工具仍存活，证明仅移除 exited guard 不足。日志 leaderfirst-2026-10-21T01-49-00.646Z、leaderfirstdetached-2026-10-21T01-49-34.928Z、leaderfirstbaseline-2026-10-21T01-50-18.341Z、leaderfirsttaskkill-2026-10-21T01-50-19.003Z。探测只回收本次创建的 PID，事后测试清理不算产品成功。

修正保留已有 EOF 和 shutdown/logging.close，在 Windows 且连接着父进程的 EOF 收尾中，通过现有私有 IPC 发送 worker.drained 后保持 leader 存活；launcher 收到结果立即执行现有 taskkill /T /F，不再等待 leader 先退出。4 秒未通知仍走原 fallback；宽限内已退出则拒绝 PROCESS_TREE_CLEANUP_INCOMPLETE，执行器报告 incomplete 则拒绝 EXECUTOR_CLEANUP_INCOMPLETE。共享回收算法、SDK、CLI、公共方法/类型/导出/schema 不变，未增加通用 helper、系统进程扫描或原生 broker。Node 24 的 process.send 回调、process.connected、channel.ref 与 disconnect 语义通过官方文档核对。

Windows 正常物理退出由 launcher 在排空通知后执行，测试不再将自主 exit(0) 当作此实现的验收依据；保留并加强为 logging.close 完成 → 排空通知 → 真实进程退出，健康记录完整、所属工具停止、再次启动和错误保真。提前退出样例仍明确检查 exitCode=0 但 close 必须拒绝，以防把一个零退出码误当树已清空。SDK 失败回归要求 complete=false、进程已退出、身份清单保留、restart 拒绝；没有通过吞错误或删除资源断言放宽通过条件。

新增四项回归：提前退出且 detached 工具残留必须拒绝；真实 worker 排空后回收 detached 工具；执行器 incomplete 在树清理后保持同一错误/Promise；该失败到达真实 SDK 并阻止替换。前两项在修正前分别以 Missing expected rejection 和 tool must be reaped 失败（detachedregression-2026-10-21T01-53-35.839Z），修正后两项通过（detachedregression-2026-10-21T02-08-02.738Z）。四项均在最终专项通过。

| 验证 | 实际结果 | 本机 .cache/issue38 日志 |
| --- | --- | --- |
| typecheck（含构建） | 退出 0 | build-2026-10-21T02-07-17.966Z |
| 关闭/日志/Host 专项 | 41 通过、0 失败、10 POSIX skip；共 15 项 Windows 关闭回归 | focused-2026-10-21T02-09-40.638Z |
| 真实 SDK 慢关闭 / EOF fallback | 两轮 3823/3863 ms、4614/4565 ms；日志、退出、清单及再次启动断言通过 | 同上 |
| 原 F31 enabled/disabled、目录故障 | 3/3 通过 | logging-2026-10-21T02-11-51.087Z |
| lint / lint:names / format:check | 均退出 0 | lint 02:11:50、names 02:11:48、format 02:11:47 |
| process / serveWorker 公开声明 | 与 main 70f0247 一致 | preparebaseline-2026-10-21T02-13-45.372Z |

该修正不宣称修复 Runtime 被强杀、事件循环失效或进入 close 前已退出的 Windows 全部后代归属；那些共享机制限制继续按当前 main 记录。macOS/Linux 原生及最终远端门禁以更新提交的 CI 为准。

## #74/#71 之后的最终 rebase 验证

main 在本轮合入 0c1d1c9，删除 startOwnedKernel，改由 createKernelService 在调用进程构造。重新 rebase 后保留上游本地执行文档；产品 process.ts/serve.ts 没有新增上游冲突。三个 SDK 回归迁到 initialize/close/status/closed：确认 Kernel PID 等于调用进程、真实 worker 退出、健康日志完整、清单移除、同配置再次构造。失败用例要求 KERNEL_CLEANUP_INCOMPLETE、complete=false、phase=failed、closed/重复 close 保留同一结果，保留的 invocation manifest 以 kernel_alive 拒绝替换实例。未修改 SDK、CLI 或共享回收组件。

旧 Core incomplete 测试直接发送 EOF 后等自主退出，与本次保留 leader 的 Windows 路径冲突；02:11 的全量在此停住，确认测试进程树后只终止该树（该轮未完成，不计通过）。Windows 测试改用 close，明确要求 EXECUTOR_CLEANUP_INCOMPLETE 和 exitCode=1；POSIX 路径保持。另两个 Core 帧一致性用例本来就注入失败，Core shutdown 也为 incomplete；测试新增两侧失败一致及 worker 非零退出断言，不吞 launcher 的错误，原帧/终态断言全部保留。最终 Core 38/38。

| 最终检查 | 结果 | 本机 .cache/issue38 日志 |
| --- | --- | --- |
| typecheck（含构建） | 退出 0 | build-2026-10-21T02-21-48.745Z |
| 原 F31 enabled/disabled、不可用目录 | 3/3 通过 | logging-2026-10-21T02-24-21.790Z |
| SDK lifecycle / worker supervision | 11 通过、1 平台 skip | lifecycle-2026-10-21T02-24-21.075Z |
| Core | 38/38 通过 | core-2026-10-21T02-34-26.339Z |
| 关闭/日志/Host 专项 | 41 通过、0 失败、10 POSIX skip；15 项 Windows 关闭回归全部通过 | focused-2026-10-21T02-34-25.295Z |
| 专项 SDK 慢关闭 / EOF fallback | 两轮 3570/3539 ms、4266/4280 ms；5 秒、日志、worker/清单及再次构造断言均通过 | 同上 |
| 最终 Windows 全量 | WebUI 35/35；Node 1392 项：1338 通过、17 失败、37 skip；15 项 #38、原 F31 与 Core 均通过 | suites-2026-10-21T02-35-54.376Z |
| 全量 SDK 慢关闭 / EOF fallback | 两轮 4143/4018 ms、4466/4339 ms，保留同样断言 | 同上 |
| 同环境 main worker 对照 | 1377 项：1323 通过、17 失败、37 skip；17 个失败名称与最终修复版完全相同 | kernelbaseline-2026-10-21T02-27-59.494Z |
| lint / lint:names / format:check | 均退出 0 | lint 02:26:23、names 02:26:19、format 02:26:25 |
| process / serveWorker 公开声明 | 与 main 0c1d1c9 文本一致 | preparebaseline-2026-10-21T02-27-30.723Z |
| 最终 OKF / 格式 | 275 个单元、20 条规则、1740 个链接通过；格式退出 0 | spec-2026-10-21T02-42-05.294Z、format-2026-10-21T02-42-39.553Z |

对照只将编译后的 process.js/serve.js 和有行为适配的 Core 测试临时换回 main 原文，排除新增 host-process-close 测试，完成后在 finally 恢复；没有将基线产物发布。17 个共同失败包括平台 fixture、权限/路径、未安装 Go 及既有 Windows 集成结果，不扩入 #38，不宣称全量通过。

保留非最终成功样本：02:23 专项因测试预期端点错误而失败，实际已由 manifest 正确拒绝替换；随后按实际 kernel_alive 原因收紧断言。02:25 全量为 1334 通过、21 失败、37 skip：除上述 Core 两项外，SDK EOF fallback 有一次耗时 5007 ms，超过保留的 5 秒断言；另有 CLI 旋转配置用例波动。该轮还并发运行 lint/格式检查，不能仅由此确定超时根因。未延长 SDK/worker 预算、删除断言或把超时算成功；独立专项及最终全量在同一实现下通过，超时样本仍是已知时序风险，不代表任意负载下必然完成清理。日志维持有界可丢弃语义，Windows 异常退出和未验证的真实 Provider 场景继续保留原边界。

## #76 之后的 rebase

用户本轮只要求同步远端。main 的 #76 为 Gateway 宿主会话存储改动，没有修改本次 worker 两个文件；补读架构/无状态规则增量后无冲突 rebase。range-diff 确认原两条提交补丁相同，产品代码与五个实现/测试文件与 739eb1c 逐文件无差异；仅更新基线和验证记录。

原生 Windows 重新验证：构建/typecheck 通过（build-2026-10-21T03-38-28.801Z）；关闭/日志/Host 专项 41 通过、10 POSIX skip，含全部 15 项 Windows 关闭回归（focused-2026-10-21T03-39-33.933Z）；原 F31 3/3（logging-2026-10-21T03-39-36.840Z）；Core 38/38（core-2026-10-21T03-39-35.434Z）；SDK 生命周期/监督 11 通过、1 skip（lifecycle-2026-10-21T03-39-34.960Z）。本轮 SDK 慢关闭 3524/3497 ms、EOF fallback 4302/4317 ms，原 5 秒及资源断言均通过。

本轮未重复全量；前节全量、main 对照及一次预算超时样本仍保留其原基线与限制，不改称本轮全量结果。

## Windows 关闭预算与通知退出窗口

基于 d44f5cd、前一 head 01dbcae，新增三项回归在修改前全部失败：真实服务使用 1500 ms 成功回收模型，taskkill 在 4012 ms 开始，服务在 5014 ms 返回时 worker 仍存活；心跳恢复超过检测后 2 秒的断言；真实 worker 发排空通知后退出，延迟启动真实 taskkill 时 close 错报成功且 detached 工具仍活着（reviewregressions-2026-10-21T04-47-11.705Z）。这确认固定宽限存在组合预算缺陷，旧 5007 ms 样本不能只作为风险说明留置。

修正只在 Kernel 内部传递同一个截止时间。服务仍为 5 秒，server 为后续清单/端点留 100 ms，worker 为树回收留 1600 ms；taskkill 及退出确认共用余下截止时间。正常 SDK 的 EOF 上限约为 3300 ms，前序关闭耗时继续从中扣除。私有 Windows 清理要求本次 taskkill 成功且 leader 退出；命令失败不能因为 leader 已退出而被忽略。故障恢复直接清理活 worker。公开 SDK 方法/参数/返回类型/导出、共享 Adapter 清理接口、Provider 和 CLI 保持原样。

最终专项进一步给 socket 关闭回调加 300 ms 延迟，验证截止时间确实跨层传递，而不是每层重开预算。该场景仅 taskkill 使用 1500 ms 的成功模型，不能称为真实 taskkill 耗时测量。超时场景用真实不退出的 Node 子进程替代本次 taskkill，验证命令实际被超时终止；其 worker 仍存活、清单保留，fixture 另行回收，不计为产品成功。

| 当前验证 | 结果 | 本机 .cache/issue38 日志 |
| --- | --- | --- |
| 构建与类型 | typecheck 退出 0；最后的 Kernel 简化另执行 tsc -p packages/octo-runtime-executor-kernel/tsconfig.json，退出 0 | build-2026-10-21T04-51-22.517Z |
| 关闭/日志/Host 专项 | 45 通过、10 POSIX skip、0 失败；19 项 Windows 关闭用例全通过 | focused-2026-10-21T04-53-13.700Z |
| 前序关闭 + 延迟成功回收 | 3312 ms 开始回收、命令预算 1588 ms、4848 ms 返回；worker 已退出，清单删除，再构造成功 | 同上 |
| 回收命令超时 | 4919 ms 返回失败前命令已结束；worker 仍存活、清单保留 | 同上 |
| 心跳恢复 | 检测后 612 ms 完成替换，旧 worker 已退出 | 同上 |
| 健康 SDK 慢关闭 | 两轮 3534/3508 ms，原日志完整、worker 退出、清单删除、重建断言全部保留 | 同上 |
| SDK EOF fallback | 两轮 3581/3570 ms，小于 5 秒且可重建 | 同上 |
| 通知后退出 / incomplete / 终止失败 | 全部保留真实失败和资源断言 | 同上 |
| Core | 38/38，通过原终态与 incomplete 断言 | core-2026-10-21T04-55-05.785Z |
| SDK 生命周期与监督 | 11 通过、1 平台 skip | lifecycle-2026-10-21T04-55-06.979Z |
| 原 F31 | enabled/disabled、目录故障 3/3 | logging-2026-10-21T04-55-06.367Z |

环境仍为 Windows 11 build 22621、Node 24.22.0、pnpm 11.19.0，fake Provider。新增专项和原 F31 已接入现有 Windows CI。当前未重跑全量；前述 17 个同基线失败保留其历史版本。正常关闭只提供有界日志排空机会；预算耗尽或回收失败继续返回真实失败。

最终静态检查：lint（04:56:54）、lint:names（04:56:56）、format:check（04:56:56）均退出 0；OKF 为 285 个单元、20 条规则、1812 个本地链接（spec-2026-10-21T04-56-55.662Z）。使用 TypeScript transpileDeclaration 对比 01dbcae 的 process/serve/service：公开声明相同；新增 closeWorker 只由 Kernel 内部模块导入，不进入 package exports。git diff 同时确认 Host SDK、Adapter SDK、协议和 Kernel 包入口未改动。

## 接近完整日志排空预算的修正

基于 6cd9fd8，给既有 fixture 增加 2490 ms 执行器关闭延迟，并在真实日志线程的 HourlyLogWriter.write 中仅延迟尾记录 950 ms。真实服务、worker 和日志线程保持；taskkill 建模为立即成功终止本次 PID，排除命令启动延迟掩盖提前终止的可能。06:18 的首次探针在测试注入 API 处失败，不计为产品证据；修正注入后，drainboundary-2026-10-21T06-20-23.205Z 的两项均复现：3308/3300 ms 开始回收，尾记录丢失，健康与执行器 incomplete 场景都返回 complete=true。

修正仅增加私有 worker.stopping 进度通知。未响应 EOF 时提前回收，为树清理留 1900 ms；确认开始关闭后，在原共享截止内给日志较长排空机会，仍为回收保留 1000 ms。server 收尾预留改为 200 ms。通常 SDK 路径的两种宽限约为 2.9/3.8 秒；进度通知不表示成功，不重置截止时间。原日志线程 1 秒预算、服务 5 秒预算、公开 SDK 接口和失败保留合同不变。EOF fallback 测试的下限随提前回收调整；原健康慢关闭 3200 ms 下限、全部 5 秒上限、日志及资源断言保持。

关闭前 leader 已退出的恢复路径与 d44f5cd 基线相同，其 detached 后代归属缺口保留；必要英文注释和 PR 明确范围，规则中的“排空前后”收紧为本次 EOF 关闭窗口。此处没有引入新的进程治理机制，也没有将已知执行器失败改成成功。

| 本轮验证 | 结果 | 本机 .cache/issue38 日志 |
| --- | --- | --- |
| 构建/typecheck | 退出 0 | build-2026-10-21T06-29-10.903Z |
| 关闭/日志/Host 专项 | 48 通过、10 POSIX skip；22 项 Windows 关闭回归全部通过 | focused-2026-10-21T06-32-09.668Z |
| 接近排空上限 | 两项 3479/3493 ms，尾记录均完整；健康 complete=true，执行器 incomplete 仍为 complete=false | 同上 |
| 已开始但卡住的 shutdown | 4091 ms；仍按原 fallback 回收，worker 退出，清单删除 | 同上 |
| 延迟成功回收 / 命令超时 | 4429 ms 成功且 worker 退出 / 4826 ms 返回前命令已结束、失败及清单保留 | 同上 |
| 原 SDK 慢关闭 / EOF fallback | 3563/3528 ms、3233/3187 ms，原日志/清单/重建断言通过 | 同上 |
| Core / F31 / 生命周期监督 | 38/38、3/3、11 pass/1 skip | core 06:33:50、logging 06:33:51、lifecycle 06:33:51 |
| lint / lint:names / format:check | 均退出 0 | lint 06:36:04、names 06:36:04、format 06:36:03 |
| OKF | 285 个单元、20 条规则、1812 个本地链接 | spec-2026-10-21T06-35-37.420Z |
| 公共 API | process/serve/service 声明与 d44f5cd 相同；Host SDK、Adapter SDK、协议及公共导出无差异 | check-public-api.mjs |

本轮仍为 Windows 11 build 22621、Node 24.22.0、pnpm 11.19.0、fake Provider；本地没有重跑全量。新提交的远端 CI 结果单独记录在 PR 中。
