---
type: Journal
title: Issue 150/171 Gateway 容量修复与文档验证
description: 满载排队修复、容量例子、连接恢复说明及本地 review 结果。
tags: [channel, session, testing, documentation, review]
---

# 基线与改动

- 基线：`0ca12a03a055ccb766e6126716c51bb6cc6efe1c`，分支 `fix/150-171-gateway-capacity`，测试时为 dirty 工作树。
- 平台：macOS arm64，Node.js `v24.19.0`，pnpm `11.19.0`。
- 任务：[150/171 简报](../../tasks/150-171-gateway-capacity/brief.md)。按 Octospec、文档、代码、review、PR 顺序交付。
- 生产代码只调整 Gateway 的 Bot 工作容量准入：仅空闲 session 申请新槽时检查 64 上限。原 session 队列上限、同步计数、Promise FIFO 和最终清理保持原机制。
- Channel/session 规则及中英文 README 补充单会话、20 个工作会话和 64 个工作会话例子，区分排队、槽位转交/释放及历史 binding。同群多人共享队列、独立话题独立排队。
- #171 引用的旧 README 恢复段落在本基线已被移除；本次补齐五态表、首次/后续暂态恢复、5/10/15/15… 秒、Retry-After 和重置条件，并纠正知识目录中的旧摘要。连接恢复生产代码未修改，历史 journal 保留当时事实。

# 本地验证

| 状态 | 命令/范围 | 结果 |
| --- | --- | --- |
| PASS，缺陷已复现 | 修复生产代码前：`node --test test/im-admission-capacity.test.js` | 既有 1 项通过，新增完成/失败/取消 3 项均失败；预期满载后排队 4 条，实际 0 条，进程 exit 1。 |
| PASS | 修复后：`node --test test/im-admission-capacity.test.js test/im-session-scheduling.test.js test/im-connection-state-machine.test.js` | 109/109，exit 0；包含新会话拒收、FIFO、计数释放和既有连接恢复控制。 |
| PASS | `node --test test/im-*.test.js test/channel-*.test.js` | 435/435，exit 0；覆盖渠道、上下文、交互、投递、关闭、调度及连接回归。 |
| PASS | review 补强后：`node --test test/im-admission-capacity.test.js` | 4/4，exit 0；取消 ACK 后仍为 64 工作、4 排队，收到原流取消终态后才推进下一条。 |
| PASS | `pnpm build`、`pnpm typecheck` | workspace 构建和根类型检查通过。 |
| PASS | 构建完成后 `pnpm lint`、`pnpm lint:names` | ESLint 与命名检查通过。lint 不与清空 dist 的构建并行运行。 |
| PASS | `pnpm format:check` | 既有全仓格式范围通过。 |
| PASS | `pnpm docs:check` | 18 对双语页面、37 个 Markdown、22 个 JSON 示例、16 个 Mermaid、12 个内置 Context 示例检查通过，4 项文档运行测试通过。 |
| PASS | `uv run --with pyyaml python .octospec/scripts/lint.py` | OKF 元数据、规则索引及本地文件链接通过；系统 Python 缺少 PyYAML，使用 uv 临时依赖环境，不修改仓库依赖。 |
| PASS | `git diff --check`；相对 `origin/main` 检查 `.github`、`package.json`、lockfile、scripts 的 diff | 无空白错误；上述 CI 接线、脚本和依赖文件无变更。 |

新增回归先让 64 个不同 session 各执行一条，再向 session 0 发送四条。验证第五条排队输入即该 session 第六条待处理输入以 `OH-RUN-2004` 拒收；新/空闲 session 以 `OH-RUN-2003` 拒收，拒收不执行、不标记已读、不保留调度对象。原流分别以 completed、failed、cancelled 结束时，队列按 FIFO 使用原槽；整个队列清空后工作数降为 63，重新发送的新会话消息可以接纳，最终归零。

日志位于 `/tmp/octo-runtime-150-171-{before,focused,channels,build,typecheck,lint,names,format,docs}.log`。这是本轮本地受控自动化证据，不作为远端 IM 或真实 Provider 的容量证据。

# Verified Review

采用 `verified-review` 技能，串行执行源码检查与运行检查；本轮未调用其他 reviewer 或子 agent。范围是上述基线上的全部 10 个变更文件，逐文件检查，未跳过文件。

审查计划：核对空闲/已有工作的准入边界、两种满额时的错误优先级、槽位转交期间的新会话拒收、取消 ACK 与真实终态、最后清理后的释放、失败测试的回收、双语容量例子/恢复表与实现一致性、历史 binding 独立计数及 CI 范围。

源码跟踪 `#receive → #enqueue → #turn → session.tail.finally`：新增判断和 `pending++ === 0` 的占槽条件一致，计数更新之间没有新增异步边界；`pending >= 5` 仍优先。工作槽只在最后一条的清理完成后递减。权限、身份、去重、Context、Kernel 与 WeCom 的执行路径没有改变。文档恢复说明与 `#connect/#lostConnection/#scheduleReconnect`、连接错误分类及现有恢复回归一致。

结论：没有发现 medium 或以上问题。新增取消 ACK 断言通过；原基线也已用新增测试复现缺陷。最终仅测试断言和文档解释在广域回归之后补强，补强后的容量测试单独重跑通过。

边界：未运行全仓 `pnpm test:suites`，未进行真实模型、远端 IM 的 64 会话压测、Windows/Linux 原生验收或部署；本改动不涉及平台专属路径。原生平台 CI 结果以 PR 的既有检查为准。没有新增 workflow、job、矩阵、触发条件、必需状态或 gate 依赖；创建 PR 后再核对实际检查列表。
