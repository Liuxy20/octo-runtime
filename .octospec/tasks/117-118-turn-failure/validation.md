---
type: Task
title: Issue 117/118 实施、审查与验证
description: 记录统一未提交错误的实现、可复现审查修复和验证边界。
tags: [channel, delivery, session, invocation, stream, testing]
---

# 实施范围

基线为 `8af836068780ebb76581225254ad7bef18cc8170`，分支为 `codex/117-118-turn-failure-analysis`。用户授权实施、verified-review、修复、提交、创建 PR 并普通合并到 main，禁止 Auto Merge。提交与 PR 使用英文，保留 Git 配置作者及 Codex trailer。

- 共享 failure 目录注册 OH-RUN-2010/2011/2012；分类同时要求对应阶段，接纳拒绝还要求可信未提交证据。
- Kernel 的本地接纳错误由私有 WeakSet 标记，仅公开 `isInvocationNotSubmitted`，不改变 IPC/Run schema。初次接纳和登记后写出前的检查共用证据，包装、手工及反序列化同名错误不获得证据。
- Gateway/WeCom 在 store.read、展示初始化和明确接纳拒绝时独立反馈；Gateway 走现有错误卡片投影并独立发文本，WeCom 走自身文本协议。卡片、文本、attempt、日志共享同一错误对象的 code/diagnosticId。
- Gateway attempt 增加 not_submitted，保留此前真实执行记录；只有整轮没有已执行或未知尝试时才保存 occurrence.notSubmittedFailure。旧 occurrence 无新字段仍按原合同处理。
- 执行中展示故障禁用进度并尽力取消，继续消费原流；真实终态保留，原流错误仍未知，交互发送失败不隐式放行。finish 有界且不抑制独立最终文本。
- 普通日志白名单逐字段接纳 diagnostic_id、stage、failure_component、occurred_at；沿原 worker 写盘链路，不扩大 statusOutput/状态镜像。不记录异常正文、路径或凭据。
- 新故障测试加入 Windows CI 的 Gateway drain 组，Linux/macOS 沿全量测试执行。

# Verified Review

范围为基线 HEAD 的工作树变更和全部未跟踪文件；每个文件独立核对。没有生成代码、依赖锁或二进制变更需要跳过。源代码审查采用正确性、安全、性能、维护性及测试五维，候选问题回溯真实调用方后过滤；运行验证另外发现错误顺序和排空问题。规则来源为用户授权及 AGENTS、context.yaml 中记录的仓库规则、verified-review 的审查和证据要求。

环境为 macOS/darwin arm64、Node.js v24.19.0、pnpm 11.19.0，审查时为 dirty 工作树。以下均是本轮实现中已复现并修复的问题，不声称原 main 存在这些新增回归。

## 已修复 High：源流失败后残留执行重试入口

位置：WeCom `application/im-channel.ts` 的未知结果 catch。原新增代码重置 projector 后没有同步清除 controls.failed；先 run.failed 后源流抛错时，界面仍可请求重试，可能重复不确定的业务操作。

修复前代码：

```ts
projector = new ImRunProjector(request.runId, message.conversationKind === "direct");
```

修复：双渠道未知 catch 均先设置 `controls.failed = false`。证据等级 reproduced；命令 `node --test --test-name-pattern='source-after-failed' test/im-pre-execution-failure.test.js`，修复前 WeCom 断言 true !== false，修复后两渠道通过。另验证 source-after-completed 和真实终态后展示失败，避免把展示错误扩大为执行未知。

## 已修复 Medium：卡片收尾超时未保留关闭失败

位置：双渠道 `application/im-channel.ts` 的 presentation.finish catch/close。有界等待释放了调度槽位，但运行期间发生的 finish 超时只记诊断，随后 close 错误地成功。

修复前代码：

```ts
this.#finalizationFailed("IM_PRESENTATION_FAILED", request.runId);
```

修复：有界保存首次 `IM_PRESENTATION_FINISH_INCOMPLETE`，close 汇总该错误；继续独立最终文本，不增加无界错误数组。证据等级 reproduced；命令 `node --test --test-name-pattern='stalled finish' test/im-pre-execution-failure.test.js`，修复前 Missing expected rejection，修复后调度释放且 close 持续拒绝。正常 finish 和同步 finish 失败由相邻场景覆盖。

## 已修复 Medium：排空期间展示更新错误被吞掉

位置：Gateway `application/im-channel.ts` 的事件循环 update catch。新增的展示隔离分支只记诊断，使既有 drain 错误合同回归。

修复前代码：

```ts
this.#diagnostic("IM_PRESENTATION_FAILED", request.runId);
```

修复：事件循环及 unknown 展示更新 catch 通过既有 `#finalizationFailed` 记录。证据等级 reproduced；第一次完整 `pnpm test` 中 `Gateway drain reports presentation failure and fences late work` 失败，Missing expected rejection。修复后 `node --test test/gateway-shutdown-drain.test.js test/im-pre-execution-failure.test.js` 的 41 项全部通过，包括普通执行的展示失败和所有既有 drain 故障分支。

修复后的二次源码复核未发现待修复的 Medium 或更高问题；该结论不覆盖未运行的真实平台验收。

# 验证证据

| 验收 | 证据与边界 |
| --- | --- |
| V01 公共错误合同 | failure.test.js 覆盖三码、阶段、安全文案、动作、retryable、同名非可信错误；未改旧 payload.code 语义 |
| V02–V03 Kernel 证据/未知 | 真实 kernelFixture 和 IPC relay 覆盖 stopAdmission 初次及写出前竞态，无 agent_run.invoke 写出、登记释放；既有 lifecycle/consumers 覆盖 ACK/源流错误，不重复提交 |
| V04 attempt 与 drain | im-task-retry、新故障文件及 Gateway drain 组覆盖无取消、无自动重试、保留此前已执行 attempt、零终态记 unknown |
| V05–V06 展示与执行 | 双渠道 begin/首次 update/进度/终态 update/finish/终态后源错误；未提交 invoke=0、cancel=0，真实终态和文本保留 |
| V07 去重与存储 | read 恢复原消息可执行；初始化失败的安全 occurrence 快照可回读，旧消息重复提示未提交；宿主现有存储组保持兼容 |
| V08–V09 日志/状态 | Channel → RuntimeLogging →真实 worker 临时文件回读，code/diagnostic_id 与卡片一致；新增字段过滤非法日期和值，任务诊断不进入 statusOutput 或状态镜像，连接仍 online |
| V10 投递 | 本地标准卡片投影及独立文本、卡片失败、双路失败、卡片卡住均覆盖；有界结束、不递归，不宣称真实平台已读回 |

- 构建、`pnpm lint`、`pnpm typecheck`、`pnpm format:check`、`pnpm docs:check`、`pnpm lint:names` 通过。
- 最终 `pnpm test` 通过：Node 1849 项中 1809 通过、40 跳过、0 失败；WebUI 35 项全部通过。初次完整测试为 1808 通过、1 失败、40 跳过；该失败已复现、修复后重验，不把初次结果列为通过。
- 初次 lint 与会清理 dist 的测试构建并发，产生大量类型解析错误；构建结束后串行重跑 lint 通过。属于验证执行顺序问题，不修改无关源码压制诊断。
- OctoSpec lint 收尾仍只有四项旧文件缺 frontmatter：tasks/systemd-directive-paths/brief.md、review.md，journal/shared/2026-10-22-systemd-directive-paths.md、2026-10-24-124-sass-build-fix.md；与基线相同，无新增。`git diff --check` 通过。

线上 Gateway：BLOCKED，当前未配置 `OCTO_CHANNEL_QA_ACCOUNTS`，已请求受保护账号文件路径但尚未收到；没有执行真实 IM 发信或 Provider 调用。线上 WeCom：用户明确要求“不测试wecom”，跳过真实平台验收，本地双渠道故障测试仍执行。其他 OS/Node 版本以当前 PR 的托管 CI 结果为准。

远端交付：待本地最终检查后创建 PR，正文包含 `Closes #117`、`Closes #118`。main 的保护要求 CI Gate、最新基线和一名独立 approving review；按普通合并执行，不启用 Auto Merge，不绕过保护。

# PR 180 同步 main

2026-10-26 用户要求从 main 更新并处理冲突。将 `origin/main@78bb88a154700bdd9cd0eda8c3624a8db2a89c1b` 合入原分支，保留原提交历史；仅 `.octospec/index.md` 冲突。解决时保留 #117/#118 入口，并采用 main 新增的 DSH 官方 SDK 任务入口及 Issue 17 最新说明。双渠道、Kernel、错误目录及本 PR 测试相对原 head 无改动。

新 main 包含 DSH 官方 SDK 调整和 happy-dom 更新，已按新锁文件执行 `pnpm install --frozen-lockfile --ignore-scripts`，并重新运行全量 `pnpm test`。同步后 OctoSpec lint 为七项缺 frontmatter：原四项加 main 新引入的 DSH brief、upstream-feedback 和 journal；这三份文件的 origin/main 版本已核对，没有 frontmatter，不归因于本次冲突解决。

同步后全量通过：Node 1802 通过、40 跳过、0 失败，WebUI 35 通过；`pnpm lint`、`pnpm docs:check` 和 diff 空白检查通过。测试数量以新 main 的测试集合为准，与上文原 head 的结果分开记录。

原 head `6da72f269254d9de6ef4952e33af1335e2081443` 已获得 yujiawei APPROVED，六组跨平台 CI 和 CI Gate 全通过；新合并提交的托管检查及审查状态须重新以 GitHub 为准。

# Jerry-Xin 与 yujiawei 后续审查

审查基线为 `7e0355104569c01652cead113b1450377ef5d75f`，main 为 `78bb88a154700bdd9cd0eda8c3624a8db2a89c1b`；本地 macOS arm64、Node.js v24.19.0、pnpm 11.19.0。两位审查正文均从 GitHub 读取，行内评论列表为空。用户授权修复后新增英文评论并请两位重新审查。

Jerry-Xin 的 P2 已复现。原 Gateway 展示更新失败分支为：

```ts
void task
  .cancel("IM presentation failed")
```

`ImTask.cancel()` 中止传入 KernelClient.invoke 的本地 signal。公共 `createInputInvoke` 在源流正常耗尽后检查该 signal 并抛其 reason，因此真实 Kernel 已输出 completed/cancelled 仍被 ImTask 当成源流异常，缓存的终态被丢弃。旧 generator stub 没有公共包装器的尾部检查，之前的通过不能覆盖该链路。

新增真实 Kernel/worker/IPC 回归，原实现上正常展示对照通过，三个展示失败场景的观察 signal 断言失败（actual=true、expected=false）。命令：`node --test --test-name-pattern='real Kernel presentation cancellation' test/im-pre-execution-failure.test.js`。证据等级 reproduced，属于已确认缺陷，取代此前“无待修复问题”的阶段性结论。

修复在 ImTask 增加 `cancelExecution(reason)`：停止后续重试，复用当前取消 Promise，只请求 Kernel 取消，不中止观察 signal。展示失败分支使用此入口，继续耗尽同一原流。取消 ACK 不被当成终态，缺终态和终态后源错误的 unknown 规则不变；没有修改公共 invoke 包装器或降低其错误检查。

回归验证包含四个真实 IPC 场景：正常对照、完成先于取消、在途执行被取消、真实终态后源错误。完成场景显式控制取消与终态的顺序，避免依赖主机调度速度；取消场景实际向 Kernel 请求在途取消。修复后四项通过，真实终态分别保存为 run.completed/run.cancelled，源错误保存 unknown。另补单测验证观察 signal 未中止、取消请求合并为一次、暂态失败不进入自动重试。相关 Channel、ImTask、drain 和 Kernel 消费者组共 72 项通过。

yujiawei 的 occurrence mock 建议已落实：第二次发送使用 try/finally 显式恢复 `occurrence.mock`；现有 Node test 的每测试清理机制也继续有效。其 Gate Summary 备注不是当前 diff 的代码生成或门禁放宽问题：PR 的 CI 修改仍仅增加 Windows 故障回归文件，没有修改门禁条件、豁免或生成代码。

本轮源码复核覆盖展示失败调用方、取消 Promise 归属、公共 invoke 尾部检查、自动重试及 drain 清理。每个本轮变更文件独立检查，无生成文件或依赖文件需跳过。完整验证与新 head 托管状态在交付时分别记录，不沿用旧 head 的绿色检查。

本轮 `pnpm typecheck`（含全量构建）与 `pnpm test:suites` 通过：Node 1807 通过、40 跳过、0 失败，WebUI 35 通过；`pnpm lint`、`pnpm format:check`、`pnpm lint:names`、`pnpm docs:check` 通过。固定取消顺序后的四项真实 IPC 回归再次全部通过。OctoSpec lint 仍只有同步 main 后已有的七项 frontmatter 错误，diff 空白检查通过。本轮没有真实 IM 发信或真实模型调用，WeCom 真实验收继续按用户要求跳过。
