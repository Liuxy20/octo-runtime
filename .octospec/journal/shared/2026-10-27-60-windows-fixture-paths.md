---
type: Journal
title: "Issue 60：Windows fixture 路径修复与复测"
description: "仅修正三个测试文件的 file URL 转换，记录真实通过项和剩余失败阶段。"
tags: [testing, windows]
timestamp: 2026-10-27T00:00:00Z
source: self
---

# Issue 60：Windows fixture 路径修复与复测

关联 [任务](../../tasks/60-windows-fixture-paths/brief.md) 和 [Issue #60](https://github.com/Mininglamp-OSS/octo-runtime/issues/60)。基线 main@f0bacb01590084523c21dc9996d05738c9a06a44，分支 fix/60-windows-fixture-paths。Windows 11 Enterprise build 22621、x64、普通用户、PowerShell 5.1、Node 24.18.0、pnpm 11.19.0。

## Change

ACP、ZCode、Grok 三个测试文件以 node:url 的 fileURLToPath 转换自己生成的 fixture URL。保留全部原有 argv、cwd、断言、容量和超时。产品源码、SDK、导出、配置和协议无变化；不增加依赖。

## Verification

- 修复前：正文 ACP 单项 1 失败、ZCode 四项全部失败；Grok 完整文件 3 通过/25 失败。三个完整文件合计 14 通过/30 失败，均发生在路径启动边界或其衍生断言。
- 初始相关构建：`pnpm --recursive --filter '@mininglamp-oss/octo-runtime-executor-kernel...' --filter '@mininglamp-oss/octo-runtime-adapter-grok-build...' --filter '@mininglamp-oss/octo-runtime-adapter-zcode-gui...' run build`，8 个包通过。
- 修复后直接运行源码：`node --test --test-reporter=tap --test-timeout=30000 test/acp-transport-failure.test.js test/provider-buffer-limits.test.js test/grok-build-adapter.test.js`，41 通过、1 失败、2 因原有 5000 ms 测试超时取消、0 跳过。
- 用户要求再次确认全部修复后，重新执行相同三个完整文件：仍为 41 通过、1 失败、2 超时取消、0 跳过，ZCode 四项明确通过，未再出现 MODULE_NOT_FOUND；ACP 关闭失败和 Grok 两项断流超时仍存在，不能宣称全部验收通过。本轮再次按所属父子 PID 清理两个已超时的 Grok fixture，未继续修改测试或生产代码。
- 特殊字符路径：将相同三个测试、runtime-fixture 和实际 fixture 放入包含中文、空格、#、% 的仓外测试目录，按原相对布局启动。三个测试的 SHA256 与工作树逐一相同；直接使用修改后的测试，不加载诊断转换 hook。复测同样 41 通过/1 失败/2 超时取消/0 跳过。ACP/Grok fixture 和 ZCode Provider 均已从实际特殊字符路径启动。
- 两次完整文件运行均需在 Grok 原有超时已经记录后，按父子 PID 和 fixture 路径确认所有权，回收本次两个存活的 Grok fixture，使测试 runner 退出；不能将人工清理记作测试自行完成或清理成功。
- `pnpm exec prettier --check test/acp-transport-failure.test.js test/provider-buffer-limits.test.js test/grok-build-adapter.test.js`：通过。
- `pnpm lint:names`：通过；`git diff --check`：通过。
- `pnpm lint`：构建停止后顺序重跑通过。首轮与构建重叠、生成类型暂时缺失的结果不作为基线缺陷证据。
- `pnpm exec tsc -p tsconfig.json --noEmit`：通过。
- `pnpm typecheck`：未完成。依赖安装时原生可选包下载失败，采用 frozen/offline/no-optional 安装；完整构建在 WebUI 的 rolldown 缺少 Windows native binding 处退出。不能将单独类型检查通过等同于全仓构建门禁通过。
- 未运行全仓 test:suites、真实模型/IM、macOS 或 Linux；不将本轮 Windows fake Provider 结果代替这些验收。

## Remaining failures

1. ACP 原有并发隔离、失败调用与后续成功调用断言在先前只加观察日志的定位实验中全部通过，最终 WorkerProcess.close 报 EXECUTOR_CLEANUP_INCOMPLETE。实际源码修复后的测试保留该失败；路径转换未使关闭阶段通过，根因未在本轮确定。
2. Grok 的 disconnect / disconnect_diagnostic fixture 成功启动后，两项原有测试仍各自达到 5000 ms 超时。fixture 进程继续存活，需本轮测试拥有者回收；尚不能断定是产品流关闭实现或 fixture 模拟方式导致。

以上是路径恢复后进入的新失败阶段，不能仅因追求小补丁而判定为测试问题，也不能放宽断言、跳过测试或延长超时掩盖。本轮只交付已确认的启动路径修复，不宣称全部测试已通过，不关闭 Issue。

## 后续范围核验：独立根因

用户要求只修 Issue 范围内的剩余问题后，补做不改变仓库代码的独立实验，而非直接根据失败名称排除范围：

1. 直接 spawnAcpClient 启动同一个不存在的命令：initialize 保留 ENOENT，client.close 正常完成。
2. 去掉 worker、IPC 和 fixture 入口，只在进程内 AgentExecutor 注册原 createAcpAdapter 并执行相同缺命令调用：仍产生 run.failed，shutdown 仍报告 cleanup=incomplete，failedCleanupInvocationIds 保留该调用。另一个完全没有文件路径或子进程的生成器，在 finally 已执行后抛执行错误，也得到同样结果。
3. 源码对应 Core 的 owner.close：readNext 拒绝即记录 nextFailed；后续 iterator.return 即使 done=true 仍按 EXECUTOR_CLEANUP_UNVERIFIED 保留 owner，shutdown 如实返回 incomplete。这是共享 Core 对异常生成器的清理确认策略，与 file URL 或 fixture 启动无关。本轮不改变此承重合同。
4. 直接以正确原生路径启动原 Grok fixture，设置 disconnect_diagnostic，发送 session/prompt：500 ms 后已读到该分支的 CONFIG_INVALID 诊断，但父进程 stdout 的 end 未发生，fixture 仍存活。独立 Node 子进程仅调用 process.stdout.end 并保持事件循环，也不会让本机父进程观察到 EOF。原 fixture 使用 stdout.end 后 setInterval，未在 Windows 实际制造所声称的断流；路径修复无法使这个模拟成立。

由此确认剩余三项属于独立的 Core 清理确认和 fixture 断流模拟问题，不属于 #60 明确限定的 file URL 到原生启动路径转换。此次不增加生产代码改动，不顺带修断流 fixture；不删除原有断言、不把仍失败的完整测试标为通过。独立实验产生的进程均由创建者等待退出并清理。

## Rule impact

沿用现有“在产生错误输入的边界修复”和“保留真实失败证据”规则，无新公共合同或规则变更。

## PR 交付范围

用户后续明确授权提交、通过已有 SSH 身份普通 push，并创建关联 #60 的 PR。目标 Mininglamp-OSS/octo-runtime，base=main，head=fix/60-windows-fixture-paths；不合并或发布安装包。交付前 origin/main=596e28c39219064040200ab0d30ce15e28ff4e8b，相比验证基线仅新增无关 Gateway 重连提交，未修改本次三个测试或其 ACP/ZCode/Grok/Core/Kernel 依赖。PR 使用共同祖先的三点差异核对，避免将目标分支新增内容误当成本分支删除。

本地最后一次三个完整文件复测仍为 41 通过、1 失败、2 超时取消。重复验证和独立范围核验没有修改生产代码，已确认三处路径缺陷消失。所有未通过项和完整构建限制均须保留在 PR Validation，不宣称全仓或跨平台通过。远端分支 SHA 和 CI/冲突状态以提交后实际查询为准。

修复提交 1d4468b955e305bd5f84ab1e68e5260bd82d9084 已通过 SSH 普通 push 到 Liuxy20/octo-runtime 的同名分支，git ls-remote 与 GitHub 分支 ref 两次核对均与本地完全一致。[PR #200](https://github.com/Mininglamp-OSS/octo-runtime/pull/200) 已创建，Fixes #60、Refs #14，正文与 body-file 核对一致。上游仅有读取权限，沿用现有 fork 的管理权限和已登录身份，不要求新增 workflow scope。

GitHub 核对发现任务目录索引与 main@596e28c 同位置插入导致文档冲突。通过普通 merge 保留 Issue 60 与 Issue 198 两条记录，不 rebase 或改写已推送提交；主线合入的 Gateway 变化不属于 PR 相对 main 的差异，最终仍只交付三处测试路径与本任务记录。相关测试和 ACP/ZCode/Grok/Core/Kernel 依赖均未被此次主线更新修改，保留既有验证结果；CI 状态单独查询，不冒称合并后的全仓检查已通过。
