---
type: Validation
title: "Issue 240：Windows Grok 真实断流验收"
description: "记录 e6809e92 基线、真实管道 EOF 时序与 Node24/26 连续回归。"
tags: [testing, adapter, stream, windows]
timestamp: 2026-11-03T02:07:00Z
---

# 版本与隔离

- 正式独立 Git checkout，分支 fix/windows-grok-disconnect-240；起始及本次 PR 准备时 fetch 的 origin/main 均为 e6809e92b6ea88eb00106e236584fbfb1c9ce6e1，包含 #295/#297/#299。首轮本地验收用交付 patch 与源码 SHA-256 绑定 dirty 工作树；用户后续授权提交、推送和创建 PR，测试代码与该次已验收版本一致。
- 原生 Windows 11 Enterprise 10.0.22621 x64，普通用户 Administrator=False，PowerShell7.6.5；Git2.55.0.windows.5，Codex CLI0.163.0，pnpm11.19.0；Node24.19.0 与26.13.0。系统 Node22 未用于测试。
- 运行器使用所选 Node 的绝对 process.execPath，PATH 前置同版目录。每条命令 HOME、USERPROFILE、OCTO_RUNTIME_HOME、TEMP、TMP 分别位于 checkout 外本聊天 work/state/<label>；均为 fake Provider，无真实模型、凭据或 IM。
- frozen/offline/ignore-scripts 安装817包成功，未改锁文件或全局配置；命令级关闭 pnpm 自动版本管理与重复依赖检查，本次 work/bin shim 支持递归构建。缺少 PyYAML 后仅在本聊天 work/python-deps 安装缓存的6.0.3，不改用户 Python。
- Git 初始 autocrlf=true。仅此 checkout 设为 false，文本恢复既有 LF blob，并重新读取索引以刷新旧 CRLF stat；最终差异仅为任务文件，不含批量换行或 workflow 改动。构建生成的 build-info 按实际记录 dirty=true，不伪称干净发行物。

# 真实失败基线

最新 main 完整原文件命令：`node --unhandled-rejections=strict --test --test-reporter=tap --test-concurrency=1 test/grok-build-adapter.test.js`，Node24.19.0。

原28项中26项通过，disconnect 与 disconnect_diagnostic 均报告 `test timed out after 5000ms`、failureType=testTimeoutFailure；没有完整文件终结摘要，自然退出未发生。15秒及65秒记录测试树，仍有两个 fixture。65秒外层先保存真实 PID/父PID/创建时间/命令，再对本次 leader 执行 taskkill /T /F，成功回收两个 fixture 和所属测试进程；exit1、timedOut=true。该外部干预不计验收通过。没有终止兄弟进程。

独立 Node24/26 探测中，end、destroy 和 closeSync(1) 调用后观察1秒均无父端 EOF、PID仍存活；随后探测 disposer 终止该独占进程才收到 EOF。额外 Node24 探测显示自建 fd1 Socket/file stream 仍不能解决 stdio 句柄保护。所有结果与清理前后事件独立保存，不把调用返回当作 EOF。

# 根因与最小修复

Node 对 process.stdout 的 destroy 做特殊保护；Windows libuv 的标准 fd0–2 也不是普通可关闭 fd。只替换 end/destroy/closeSync 都不能建立原测试前提。上游核对入口：[Node24 stdio 实现](https://github.com/nodejs/node/blob/v24.19.0/lib/internal/bootstrap/switches/is_main_thread.js)、[libuv Windows fs close](https://github.com/libuv/libuv/blob/v1.x/src/win/fs.c)、[libuv Windows pipe open](https://github.com/libuv/libuv/blob/v1.x/src/win/pipe.c)。

修复只在测试基础设施：同步的 withGrokOutputPipe 拦截本次 fixture spawn，真实启动 Node，stdin/stderr 保持普通管道，物理 fd1 忽略，额外 fd3 为唯一 ACP 输出。父端将真实 child.stdio[3] 接到 child.stdout，随后生产客户端安装原有监听；不 emit('end')，不替换 Readable，不关闭父端 reader，不修改客户端错误处理。

夹具用自有 Socket 写 fd3，在 prompt 时销毁这个自有句柄；进程仍由 readline 和 interval 保持存活。无后代、无输出代理进程或外部二进制。同步创建成功或抛错后立即还原 spawn 并同步 ESM 导出；不跨 await 保留拦截，不污染后续并行 Bot/标准 ACP 用例。

这里验证的是接到 child.stdout 的真实 ACP 输出 OS 管道，**不宣称物理 fd1 被关闭**。该拓扑避开标准句柄保护，保留“进程还活着，执行输出已 EOF”的目标条件。原两个正则、零成功终态、5000ms、取消、并行隔离、安全脱敏及清理失败断言均保留；没有发现正确 EOF 下需要生产修改的独立 Adapter 缺陷。

# 时序与重复结果

完整原文件两项现各增加父端观测：真实 stdout end 回调中 process.kill(pid,0) 成功，exitCode/signalCode=null；EOF先于 exit 和 invocation-rejected；exit先于close；close 后stdin/stdout/stderr均destroyed，PID探测为ESRCH。after hook 只作有界兜底并由同一 disposer 先确认进程/管道关闭再删除目录；通过轮均在原断言主体已确认 close，未由 after hook 触发初次终止。

例如 Node24 第一轮 disconnect：EOF68.03ms（alive=true）→ exit85.89ms → close85.96ms → 原诊断拒绝96.45ms；diagnostic：EOF77.50ms（alive=true）→ exit97.78ms → close97.89ms → 原诊断拒绝106.32ms。退出由既有 Adapter 的 EOF 清理发起（SIGTERM），不是外层测试运行器强制结束；“自然结束”指完整测试命令无需外层干预，不表示 Provider 从未收到其 owner 的清理信号。

| 文件集 | Node24.19.0 | Node26.13.0 |
| --- | --- | --- |
| 完整 grok-build-adapter.test.js，连续三轮 | 每轮28 pass /0 fail /0 cancelled /0 skip | 每轮28 pass /0 fail /0 cancelled /0 skip |
| 显式 manual/grok-disconnect-240.test.mjs | 3 pass /0 fail /0 skip | 3 pass /0 fail /0 skip |
| ACP/生命周期扩展13文件 | 69 pass /0 fail /0 skip | 69 pass /0 fail /0 skip |

全部修复后命令 exit0、timedOut=false，完整文件约4.4–5.2秒结束。两个断流用例确实执行；没有 skip/cancelled，也没有外层 taskkill。手动专项先不用 Adapter 完成初始化/认证/会话的真实逐请求响应，再触发 EOF；经过一个事件循环仍能探测到原PID，此后才由所属测试 disposer 使用现有清理工具结束夹具。另验证同步构造抛错仍恢复 spawn。

手动命令：`node --unhandled-rejections=strict --test --test-reporter=tap --test-concurrency=1 test/manual/grok-disconnect-240.test.mjs`。不加入默认测试脚本、workflow、矩阵或 CI Gate。

扩展实际文件：acp-transport-failure、acp-message-segments、acp-approval、adapter-tool-lifecycle、executor-cleanup-budget、cleanup-budget、native-cleanup、spawn-json-lines-errors、host-sdk-lifecycle、component-startup、invocation-manifest、manual/acp-cleanup-236、manual/kernel-startup-237，均按 test 下实际后缀执行；69项以TAP实际数量为准，包含迁移占位文件不按文件数推算覆盖。

# 检查与范围

- 初始及最终 Node24 pnpm typecheck（含完整workspace build）通过，最终格式、ESLint、命名通过。Node26复用该构建执行根tsc --noEmit通过，未声称另做Node26全workspace构建。OKF检查通过（622单元、20规则、3867本地链接），git diff --check通过；初次缺少PyYAML已在独占目录补齐后重验。
- 逐一核对1845个原始tracked文件blob，只有engineering规则及原Grok测试/fixture三个tracked文件有内容变化；其余七个新文件是本任务治理记录和测试基础设施。patch在HEAD的独占Git index上执行git apply --cached --check通过，未暂存当前checkout。最终CIM按本checkout完整fixture路径核对，remainingCount=0。
- Windows10、macOS/Linux、本轮全仓默认套件、发行安装、真实Grok/IM均未运行。没有POSIX执行环境，不用Windows通过代替POSIX回归；共享测试拓扑仍需后续macOS/Linux实测。
- 首轮本地交付后用户授权创建 PR：提交前在 Node24/26 各补跑完整原文件与手动专项组合，均31 pass、0 fail、0 cancelled、0 skip，exit0、timedOut=false；没有外层终止。PR 使用 Closes #240、Refs #14，Issue 在合并前保持 OPEN；没有直接关闭或合并。#14总验收保持OPEN；不并入#238/#241/#242。
- 原始TAP、逐轮JSON、基线进程现场、运行器、源码hash、patch和检查日志保存在本聊天交付证据包；开发中手动专项先后暴露缺少根依赖导入和流水线过早关闭未刷完响应，均已在测试基础设施中修正，失败日志保留，未算最终通过。
