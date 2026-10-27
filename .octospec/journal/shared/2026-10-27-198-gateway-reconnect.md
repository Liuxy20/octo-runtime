---
type: Journal
title: Issue 198 Gateway 默认恢复策略与验证
description: 按单实例断网和服务 SLA 默认重试要求修正传输分类，记录独立 worktree 实施证据。
tags: [channel, lifecycle, testing]
timestamp: 2026-10-27T00:00:00Z
---

# 实施

从最新 origin/main@f0bacb0 建立独立 worktree，分支 `codex/198-gateway-reconnect`，未创建提交或发布。用户明确直接断网为触发，主要是单实例；不接受用假设的连接争抢阻断恢复，进一步要求服务 SLA 错误默认重试，仅明确永久拒绝停止。

已将该决定回写 [Channel 规则](../../rules/channel-integration.md)，并同步 SDK 指南和双语排障文档。[任务合同](../../tasks/198-gateway-reconnect/brief.md)与[同类检查](../../tasks/198-gateway-reconnect/analysis.md)记录完整分类、计时与范围。

共享 Gateway 的合法 DISCONNECT 和失败 CONNACK 改为明确终态集合外默认重试，含 reason 12、0、未知码。握手前 DISCONNECT 保留自身原因；HTTP 暂态与未知服务状态、未分类依赖异常默认恢复。明确认证、权限、配置/协议和资源所有权错误保留终态；HTTP 重定向不跟随，状态不再折叠成网络故障。断线日志包含目标 state。

继续沿原状态机先回收，再按 5/10/15 秒退避；主动停止和旧代次隔离保持。没有新进程、重连管理器、持久锁或公共 API；不重放旧执行。实际没有 20 秒连接成功保证，静默检测仍是 25 秒轮询、90 秒阈值。

# 验证

- 修复前新增原因码/HTTP 分类回归失败，保留于 `/tmp/octo-198-red.log`；其中 reason 12 与系统/查询/节点/限流握手、断开均证实被标为不可重试。
- 最新状态机/真实二进制协议、HTTP 和重定向回归 93 项通过；包括握手前、握手后 DISCONNECT、明确终态、未知码、初次离线、精确退避、Retry-After、重复关闭、迟到事件与半开超时。记录 `/tmp/octo-198-state-machine.log`。
- 中间版本 CLI/SDK 完整恢复链路各通过一次：普通断开、两轮 reason 12、0、255 后的新消息执行与回复正常，服务 PID/Kernel instance 保持，6 次连接对应初始加5次恢复，旧未知任务不重新接纳；重试四类事件存在。随后还修改了握手前处理与默认分类，最终回归结果在下文追加。
- 首轮并行 lint 与 typecheck 的 clean/build 相互干扰，出现依赖类型缺失；改为构建完成后执行 lint。该次失败不是主线已知问题，不作为最终验证结果。
- 本地真实 loopback socket 与加密报文属于 fixture；实际断网、合盖、线上滚动发布和真人 DM/群未验收，未更新操作者安装版本。

# 最终检查

- `node --test test/im-*.test.js test/recovery-dual-mode.test.js test/channel-packages.test.js test/extra-status-*.test.js`：402 项通过、0 失败、0 skip，约 71.7 秒。含最终代码的 CLI/SDK 五轮恢复与新消息闭环；日志 `/tmp/octo-198-regression.log`。
- `pnpm typecheck` 通过；最后的 HTTP 重定向分类修改后又执行 Gateway 包构建和根 `tsc --noEmit`，均通过。未把先前构建冒充最终变更的类型验证。
- 最终 `pnpm lint`、`pnpm lint:names`、`pnpm format:check`、`pnpm docs:check` 与 `git diff --check` 通过。开发文档检查含 4 项测试。
- 系统 Python 缺 PyYAML，改用 `uv run --with pyyaml python .octospec/scripts/lint.py`；结果仅 7 个已有 frontmatter 错误，逐文件与 HEAD 字节比较一致：dsh-upstream-sdk 的 brief/upstream-feedback、systemd-directive-paths 的 brief/review，以及 2026-10-22-systemd-directive-paths、2026-10-24-124-sass-build-fix、2026-10-26-dsh-upstream-sdk 三篇 journal。本次新增 OKF 单元、规则索引及本地链接未报错，不冒称全仓知识 lint 通过。
- 最终 diff 串行自查覆盖分类依据、旧状态机单连接所有权、真实 WS 原因传播、握手早退、主动停止、HTTP 不跟随跳转、凭据脱敏、两入口恢复和文档一致性。未使用独立 reviewer 或子 Agent。

实现与本地检查完成，未提交/推送/发布，真实网络和线上部署验收保持未完成；用户当前安装仍是原构建，不能据本分支通过宣称现场已经恢复。

# 用户追加的本地模拟

按用户要求增加 `OCTO_RECOVERY_OUTAGE=1` 长测入口，CLI 和 SDK 两个隔离进程并行运行，保留真实 90 秒阈值和 5/10/15 秒退避。各轮约 170 秒通过；普通断开、两次 reason 12、0/255、监听端口停机/重启和静默丢包后均可执行新消息并收到回复，不重启 Gateway，不重提旧未知任务。两模式各经历 8 次连接，恢复后仅 1 条活动连接，关闭/子进程退出及临时 Home 清理成功。

实测停机约 15 秒，恢复后约 15 秒上线并回复；静默丢包约 100 秒才发现，恢复流量后约 5 秒上线并回复。这明确验证了“默认重试修复有效”和“静默失联检测仍非 20 秒”的区别。相邻回归 95 项通过，格式/语法/diff 检查通过；详细毫秒级结果、命令与模拟边界见[本地模拟](../../tasks/198-gateway-reconnect/local-simulation.md)。未改变产品心跳参数或用户网络，未部署。


# PR 就绪复核

用户追加授权：达到提交标准后提交、推送并创建目标为 main 的 PR。此授权更新先前“未提交”的交付状态，不包含部署或外部 IM 消息。

- 基线：`f0bacb01590084523c21dc9996d05738c9a06a44`，复核时工作区含本任务修改；重新 fetch 确认与 origin/main 一致。环境为 Darwin arm64、Node v24.19.0、pnpm 11.19.0。
- 使用 verified-review 串行复核全部 18 个变更文件（含 5 个新增知识文件），无跳过文件；未发现中等级及以上问题。检查原因码与 HTTP 分类、明确终态、握手前断开、凭据不随重定向转发、回收后的单连接所有权、停止/迟到回调、执行不重放以及文档与实现一致性。补齐鉴权入口和归一入口的中文合同注释，修正模拟报告表格分隔。
- `pnpm test:suites`：UI 2 个文件、35 项通过；Node 共 2000 项，1946 通过、54 条件跳过、0 失败/取消，约 83 秒。日志 `/tmp/octo-198-full-suites.log`。跳过项不计为通过；真实 Provider 与平台专属条件仍受各测试入口控制。
- 最终注释改动的格式检查、`git diff --check` 通过；lockfile 和生成协议类型没有漂移。产品行为未在本次复核中进一步修改，复用前文类型、lint、文档及真实时间 CLI/SDK 故障试验证据。
- 知识校验仍仅报上述 7 个未变动的主线 frontmatter 问题，无本任务新错误；记录 `/tmp/octo-198-pr-spec-lint.log`。
- 结论：达到提交 PR 的本地检查标准。GitHub 的 CI Gate、至少一位审阅者批准、最新 main 基线及未解决讨论门禁独立生效；本地通过不代表远端已通过。PR 使用 Refs #198，保留现场故障原因、物理断网/睡眠和真实 DM/群验收，不能直接宣称 P0 全部关闭。
