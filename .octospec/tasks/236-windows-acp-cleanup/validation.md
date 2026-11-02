---
type: Validation
title: "Issue 236：Windows 本地验证"
description: "记录基线、ACP 清理修复、Node 24/26 重复验证与关联失败。"
tags: [windows, adapter, lifecycle, testing]
timestamp: 2026-11-02T08:53:00Z
---

# 当前验证：rebase 至 f06546e9

用户授权将 PR #297 rebase 至已合入 #295 的 main，并补充一个提交。旧远端 head 为 `eded521ce1d9a13fb74326e39bd4fb3012267754`，新基线为 `f06546e915b155224a402703e5dae123daf854a5`；推送需使用绑定上述旧 SHA 的 force-with-lease，不能覆盖并发更新。

## 冲突与迁移

- 唯一文本冲突是 local-execution.md：保留 main 的原生 owner 清单收尾规则与全部原生装配合同，再加入本 PR 的 ACP spawn 失败终态规则，没有恢复 worker 监督/回收约定。
- 生产文件与 rebase 前完全相同，仍是 ACP 成功 close 后发布 native spawn 失败终态的22行；不改 Core、Kernel、公共签名、依赖、锁文件或 CI。
- main 的 ACP 原文件已由 worker fixture 改为原生 Kernel/RPC，并为未修复的缺陷暂时预期 close incomplete。本 PR 保留并行、后续调用、execution_ready 和原超时，改为要求完整 ServiceCleanupResult，再执行原宿主清理；这是对修复结果的更强断言。
- 手动专项删除已不存在的 spawnWorker、worker PID 和 drain 消息断言。当前直接注入 Adapter，验证真实失败 spawn 未创建 PID、ChildProcess close/管道关闭、原生 owner 清单释放、宿主仍存活及端点复用；拒绝/延迟清理和 Core 遗留 owner 检查继续保留。

## 当前基线对照与重复验证

普通用户原生 Windows 11 build 22621、PowerShell 7.6.5、pnpm11.19.0、Node24.19.0/26.13.0，继续使用 checkout 外隔离 Home/TEMP/TMP 和 fake Provider。先 frozen 安装新 main 锁文件，再完整构建/类型检查，保证没有运行旧 worker 产物。

仅在有界对照期间，将 ACP 源文件替换为 `origin/main@f06546e9` 的原实现并构建；当前两个回归文件在 Node24 为7 pass / 5 fail，分别捕获 Kernel/Core 清理不完整或 spawn 错误 reject。对照结束恢复修复源码与构建产物；不修改 Core 清理保护。

| 当前命令文件 | Node24.19.0，三轮 | Node26.13.0，三轮 |
| --- | --- | --- |
| acp-transport-failure + manual/acp-cleanup-236 | 每轮12 pass、0 fail、0 skip | 每轮12 pass、0 fail、0 skip |
| invocation-manifest + component-startup | 每轮5 pass、0 fail、0 skip | 每轮5 pass、0 fail、0 skip |

第二行是 main 已迁移的原生 owner/启动取消场景；不把新夹具通过表述为旧 worker、旧 manifest rename EPERM 或历史 #237 根因已修复。#237 和 #14 继续只关联。

当前扩展回归在两版 Node 均为149 pass、0 fail、0 skip，覆盖 ACP approval/message segments、Core、cleanup budget、原生装配、Kernel clients、Host SDK 生命周期、native Host 和 CodeBuddy model-selection/outcomes。全部自然结束，未触发运行器超时或强制终止。

当前 `pnpm typecheck`（含全 workspace build）、ESLint、命名、全范围格式检查和 diff 空白检查通过；知识元数据/链接校验通过（614个单元、20条规则、3860个本地链接）。安装、构建、门禁与逐轮 TAP 均以 `rebase` 前缀保存在本次隔离证据目录。没有全仓默认套件、真实 Provider/IM、Windows10 或 macOS/Linux 的本轮实测；旧完整默认套件失败仅绑定下节旧基线，不据此宣称当前全仓通过或失败。

# 历史验证：58332b3（rebase 前）

## 版本与环境

- 验证基线：`origin/main@58332b3bcf5651f58e674fa236184dc6a0d927ca`；独立正式 Git checkout，分支 `fix/windows-acp-cleanup-236`。下列测试在该基线加本次未提交修复上执行；PR 准备时重新 fetch，main 未变化。
- Windows 11 Enterprise 10.0.22621 x64，普通用户（管理员角色 false），PowerShell 7.6.5，Git 2.55.0.windows.5，Codex CLI 0.163.0。
- 实际测试 Node 24.19.0 与 26.13.0；pnpm 11.19.0。系统 Node 22 未用于测试。运行器用实际 `process.execPath`，对子进程 PATH 前置同版本目录。
- TEMP/TMP、测试 Home、OCTO_RUNTIME_HOME 在 checkout 外的本次 `work/state/<label>` 下隔离。只用 fake Provider，没有读取或改写在线 Bot 配置、身份和日常 Home。
- frozen lockfile 安装复用已有 pnpm store；使用 `--offline --ignore-scripts`，依赖策略检查仍有 registry 访问。构建与类型检查成功。复用外部本地 pnpm shim，命令级关闭自动依赖状态检查，未修改全局设置或锁文件。
- Windows Git 的全局 autocrlf=true 使首次 format 检查出现 739 个 CRLF 文件问题；仅本 checkout 改为 autocrlf=false、归一到既有 LF blob，刷新 index 后最终 diff 无无关文件。没有改变 workflow 或默认测试脚本。

## 基线与根因

两版 Node 的完整 `test/acp-transport-failure.test.js` 均为 5 pass / 1 fail，失败在原第 98 行 `host.close()`，为 `WORKER_CLEANUP_INCOMPLETE` / `EXECUTOR_CLEANUP_INCOMPLETE`。调用阶段的并行隔离和后续调用断言已执行通过。

直接 Core 诊断显示原 ACP native spawn ENOENT 已经过 client.close，但迭代器最终 reject。Core 的 nextFailed 防护因此保留 `invoke-test` 在 unresolved/failedCleanup 两个集合；worker 发送 `worker.drained cleanup=incomplete`，launcher 执行 taskkill 后 PID 已消失，仍诚实抛 incomplete。因此这里是缺失执行错误与已确认传输清理的区分，不能从 AggregateError 推断进程泄漏。

修复后同一诊断保留 ENOENT/message 和 `OH-ADP-3002`；Core shutdown 为 complete、两列表为空，worker drain=complete、PID 已消失。原生 Windows taskkill 后 worker 数字 exitCode=1 不代表 graceful drain 失败；排空消息、树清理命令和退出确认分别成立才可认为当前观测范围 complete。

修复仅覆盖同时具备字符串 code 和原生 `spawn ` syscall 的启动拒绝，且只在 client.close 成功后发布 canonical run.failed。AcpInvocationError、非 spawn 结构化错误、Core 的未确认清理保护保持原合同。不宣称 Windows 父先退出后的所有后代均有强回收保证。

## 原文件重复矩阵

所有命令使用 `--unhandled-rejections=strict --test --test-reporter=tap --test-concurrency=1`。

| 场景 | Node 24.19.0 | Node 26.13.0 |
| --- | --- | --- |
| #236 原完整文件，修复前 | 5 pass / 1 fail | 5 pass / 1 fail |
| #236 原完整文件，修复后第 1/2/3 轮 | 每轮 6 pass / 0 fail / 0 skip | 每轮 6 pass / 0 fail / 0 skip |
| #237 原组合，修复后第 1/2/3 轮 | 前两轮 8 pass / 2 skip；第三轮 7 pass / 1 fail / 2 skip | 每轮 8 pass / 0 fail / 2 skip |
| 新增显式手动专项 | 6 pass / 0 fail / 0 skip | 6 pass / 0 fail / 0 skip |

#237 原组合是 `test/invocation-manifest.test.js test/component-startup.test.js`。Node24 第三轮仍在启动取消回滚断言（第87行）发现 cleanup.complete=false、resource kernel / KERNEL_CLEANUP_INCOMPLETE。该路径未进入 ACP 调用，不能归到本次 spawn 终态分支。

额外只增加诊断输出、无源码行为修改的原组合复测，另在 replacement.close（第101行，initialize 已通过）复现 EPERM：InvocationManifest.setWorker(undefined) → writeManifest → rename 临时文件覆盖 kernel-invocations.json 失败。该记录不证明历史 replacement.initialize 失败或本轮第87行失败均为同一根因；占用者与权限来源尚未确认。诊断仅改 ignored dist，结束后已还原。#237 未修复、未关闭。

## 专项与扩展回归

显式命令：`node --unhandled-rejections=strict --test --test-reporter=tap --test-concurrency=1 test/manual/acp-cleanup-236.test.mjs`。

六项覆盖真实缺失命令与原始错误分类、close 实际完成前不发布终态、close 拒绝仍保留 Core owner 与重复 shutdown 的 incomplete、非 spawn 结构化错误对象不变、真实 worker drain/PID/管道释放、原生 Kernel manifest/endpoint/lease 清理与相同端点 replacement initialize。两版全部通过。

Node24 初次聚焦组合（ACP transport/approval、Core、cleanup budget、OpenCode 与初版五项专项）73 pass、20 个既有 POSIX skip、0 fail。最终六项专项另行完整通过。

Node26 扩展组合（ACP transport/approval/message segments、Core、cleanup budget、OpenCode、CodeBuddy outcomes/model selection）125 pass、20 个既有 POSIX skip、1 fail；唯一失败为 CodeBuddy model-selection 的 Gateway → Kernel 既有 fixture close incomplete。以 HEAD 原 ACP 源码临时构建对照后，未修改的 model-selection 文件同样 12 pass / 1 fail，随后恢复当前源码与构建产物。该非 spawn 模型失败未纳入 #236，不能称扩展组合全绿。

全仓阶段出现的 worker close 时限失败随后独立复测：Node24 完整 `test/host-process-close.test.js` 22 pass、0 fail、0 skip，约77秒自然结束。未修改该测试的断言、超时或实现；单文件通过不抹去全仓的失败，也不据此断言具体系统调度原因。

专项开发期曾因测试把 KernelClient 当作 WorkerRpcClient，新增 Kernel 检查报 invokeFrames 不存在；已改为真实公共 client.invoke，最终两版六项全量通过，保留开发期失败日志。

## 检查

- `pnpm typecheck`：通过，包含全 workspace 构建及根 strict noEmit。
- `pnpm lint`、`pnpm lint:names`：通过。
- `pnpm format:check`：纠正本 checkout CRLF 环境后通过。
- `.octospec/scripts/lint.py`：通过；PyYAML 仅安装于 checkout 外的本次 work/python-deps，PYTHONPATH 只在命令进程内使用。
- `git diff --check`：通过；生产代码仅 ACP 文件增加 22 行，另含显式手动专项与知识记录。
- 完整 `pnpm test:suites`：未通过，结果及外层干预边界见下节。

## 完整默认套件最终结果

Node24 完整默认入口先完成 WebUI 35 pass；Node 最终报告 2481 tests、2387 pass、10 fail、2 cancelled、82 skip，命令 exit=1。运行约 539 秒，未自然收尾；外层按当前父子创建时间和 PID/启动时间核对，逐个终止 3 个本次所属的残留进程后才结束。记录的所属 PID 均已消失，不能称该命令自然清理成功；运行器自己的 600 秒 timer 未触发，外部干预另有 JSON 记录，不将 timedOut=false 当作无干预。

失败/取消覆盖已知 Grok disconnect、普通用户 symlink EPERM、provider.exe 删除 EBUSY、原 HEAD 已对照的 CodeBuddy cleanup；还出现 CLI DSH 的 PATH 路由断言和 Windows SDK worker 停止时限失败。本次未修复这些路径，也未预设其具体底层根因。完整默认套件未通过，Node26 未执行完整默认入口。20 个 OpenCode POSIX skip 与 #237 的两个 POSIX skip 不计 Windows 通过。

进程观察一开始仅按 PPID 关联，会遇到 Windows 复用 PID 的历史进程；收尾前已增加子进程创建时间不得早于父进程的校验，并重新建立可信观测集合。实际停止只针对该集合中再次匹配创建时间的 PID，旧进程未触碰。进程消失证据仅限已观察、已登记的本次测试树，不增加 Windows 父先退出后的强回收保证。

## 未验证边界

未执行 Windows 10、macOS/Linux、真实 Provider/模型/IM、Electron 实机与发行包安装验收。#14 仍是完整 Windows 总验收，不能由本项修复关闭。初次验证阶段未执行 GitHub 写入；用户后续授权提交、推送来源分支并创建 PR，以 Closes #236、Refs #237 和 Refs #14 关联，不直接关闭 Issue 或合并 PR。
