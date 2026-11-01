---
type: Task
title: 首版规格存档：恢复测试逐阶段资源回收与错误保留
description: Gateway 关闭超时后继续清理 Kernel，保留测试与清理失败，并通过显式本地故障注入验收。
tags: [testing, lifecycle]
---

# 目标

修复 [Issue #233](https://github.com/Mininglamp-OSS/octo-runtime/issues/233) / Loop ORT-68：恢复测试中任一清理阶段失败后，仍尝试后续阶段；结束后报告全部已知失败，避免 Gateway 超时跳过 Kernel。

基线为 `0bcd89c528018ffd508ca8099c8ac9c6b88de35d`，分支 `fix/233-recovery-teardown`，worktree `/Users/lvsijia/github.com/Mininglamp-OSS/octo-runtime-issue-233`。本规格基于分诊评论 `2a39edcb-2c11-45e7-b052-5eef32362fba`，当前仅编写规格，未实现或运行故障注入。

## 责任与现状

- 目标是测试基础设施可靠回收自己取得的资源；决定权属于测试资源所有者，不引入业务策略、公共参数或生产服务 API。
- CLI composition root 仍为两个真实 CLI 子进程：先 Kernel，再 Gateway；Kernel 拥有 worker。测试拥有两项子进程登记和对应退出 Promise。Gateway 无权关闭 Kernel，`client.close()` 只关闭连接。
- SDK composition root 仍在测试进程原生构造 Kernel 与 Extra，测试负责分别调用它们的 close；SDK 内部负责所属 worker 和调用排空。
- 当前 CLI 的 finally 在 Gateway 超时后强杀并等待，但原拒绝继续传播，跳过 Kernel。SDK 的顺序 close 也可能提前中断，且目前未检查返回的 `complete`。
- 合同内动作是顺序清理、有限等待和准确报错；越界动作包括修改产品重试策略、生产 Kernel、服务构造方式或处理其他接入产品的进程。没有生产 Kernel 缺陷证据。

## 关键合同

### 清理阶段与顺序

1. 记录测试主体是否失败及原始抛出值，再无条件进入清理。使用独立的失败标记，不能用值的 truthiness 判断是否失败。
2. 依次尝试 `client.close()`、已创建的 SDK Extra close、已创建的 SDK Kernel close，以及 CLI 子进程的逆启动顺序关闭。同步抛错、Promise 拒绝和关闭结果不完整均记录后继续。尚未取得的资源不执行清理。
3. SDK close 使用既有内部生命周期期限，不修改生产预算；返回 `complete: false` 时保留 `errors` 与 `pendingResources` 并标记失败，不把 Promise fulfilled 当作资源回收成功。
4. 子进程按登记列表副本逆序遍历，避免修改供诊断使用的原数组。已退出的进程仍观察退出 Promise；仅在 `exitCode` 和 `signalCode` 均为 null 时发送终止信号。
5. 单个 CLI 子进程先尝试 SIGTERM，最多等待现有 7000 ms；超时保留 `FIXTURE_SHUTDOWN_TIMEOUT`。SIGTERM 失败也不能跳过必要的强制终止尝试。
6. 宽限结束后仍活着的子进程尝试 SIGKILL，再用独立 3000 ms 期限等待退出；强杀抛错或返回 false 时，仍进行有界退出确认。失败记录组件、PID、阶段和退出状态，明确 incomplete，继续下一个子进程。
7. `kill()` 成功、输出管道关闭或 client 关闭均不替代进程退出证据。退出监听器在 spawn 后立即登记；spawn error 不得变成未处理拒绝，保留原 errno。
8. 清理完成后才交给既有 IM fixture 与 Home after hook 收尾。测试不得新增提前删除仍被写入目录的路径；无法确认退出时保留关联目录并报告路径。仅正常回收路径承诺所有所属进程退出。

### 失败结果

| 测试主体 | 清理 | 结果 |
| --- | --- | --- |
| 成功 | 全部完成 | 正常通过 |
| 失败 | 全部完成 | 重新抛出原始失败，保留原对象和堆栈 |
| 成功 | 有失败 | 抛出 AggregateError，按清理顺序包含阶段错误 |
| 失败 | 有失败 | 抛出 AggregateError，原始失败列首项并作为 cause，其后保留各阶段错误 |

阶段错误包含稳定的组件名称与阶段；原 Error 用 cause 或 errors 引用保留，不能只转成字符串。最终 Node 测试输出须可见原始失败标记和 `FIXTURE_SHUTDOWN_TIMEOUT`，必要时用 `t.diagnostic` 补充阶段事实，不能仅依赖聚合错误总标题。日志不得包含 fixture 凭据。

### 实现位置与范围

- 修改 `test/recovery-dual-mode.test.js` 的资源登记和收尾，必要时抽取仅供测试使用的 `test-support/recovery-cleanup.mjs`，由普通恢复用例与手动专项共用同一实现。
- 增加 `test/manual/recovery-teardown.test.mjs` 作为显式手动验证入口；如需注入点，仅放在测试代码，默认关闭且不改变普通 CLI/SDK 场景数量或行为。
- 新专项不能匹配现有 `test/*.test.js`，不能修改默认测试脚本、GitHub workflow、job、矩阵、触发器、必需检查或 gate 依赖。
- 不新增依赖，不扩展通用进程管理 API，不批量重构其他测试，不改重连时长或将 Issue 的历史约 35 秒用时设为性能门槛。

## 验收

### A1：真实 Gateway 超时与退出

手动专项启动隔离子测试运行器，执行受影响的真实 CLI 恢复用例。子测试仅在测试主体即将进入收尾时通过测试专用握手暂停自己登记的 Gateway（macOS/Linux 使用 SIGSTOP），不暂停 Kernel 或 worker。必须确认 Gateway、Kernel PID 均已登记且此时存活，不能用虚构子进程替代真实服务。

从 SIGTERM 尝试计时，Gateway 超过实际 7000 ms 期限后应记录超时并尝试 SIGKILL，确认 Gateway 退出；之后应尝试 Kernel SIGTERM 并等待其退出。记录 Kernel worker PID，并在收尾后确认该 PID 消失。不得缩短该场景的产品或 fixture 期限，不要求 Kernel 在等待 Gateway 时停止工作。

子测试预期失败，外层专项只有在以下条件全部满足时通过：子测试非零退出、输出包含超时证据、清理顺序正确、Gateway/Kernel/已登记 worker 均已退出、运行器在其独立 90 秒上限内退出。外层设有独立 finally，对本次登记 PID 做有界兜底；兜底介入视为被测清理失败，不能用兜底结果满足验收。只操作本次所属 PID，禁止按名称批量杀进程。

### A2：其他失败与原始失败保留

同一手动入口对共用清理实现注入以下确定性故障，断言每个后续阶段均被调用且被等待：

- client.close 同步抛错，仍清理 SDK Extra、Kernel 与已登记子进程。
- Extra close 拒绝或返回 `complete: false`，仍调用并等待 Kernel close，保留具体失败明细。
- 子进程 SIGTERM 抛错/返回 false、强杀失败/退出确认超时，仍执行有限等待并访问下一个子进程；模拟操作不对真实进程制造不可回收故障。
- 主体抛出带独特标记的错误且清理超时，两项均在最终测试诊断可见；主体单独失败时保留原 Error 对象。补充主体抛出 falsy 值的用例。
- 已自行退出与 spawn error 场景不重复发送不必要信号，且不会出现未处理拒绝。

### A3：正常回归与 CI 范围

实施阶段准备依赖并运行 `pnpm build`，再执行：

```sh
node --test test/manual/recovery-teardown.test.mjs
node --test test/recovery-dual-mode.test.js
git diff --check
git diff origin/main -- .github package.json
```

正常 CLI 与 SDK 两项均须通过，未改变其产品恢复断言；手动故障专项单独记录。按最终 diff 执行仓库要求的 lint/typecheck；若只改测试 JS 和文档，说明检查的实际覆盖范围。提交前重新核对相对目标分支的 workflow diff 与测试脚本展开后的入口，不能只检查 workflow 文件。

结果绑定 HEAD/dirty、Node/平台、命令、耗时、阶段信号及 PID 退出事实。失败、跳过和未执行分别记录；CLI 原测试在 Windows 跳过，SIGSTOP 专项仅声明 macOS/Linux 证据，不能宣称 Windows 已验。该问题不请求真实模型或线上 IM。

## 实施与审查

先实现共享清理路径，再做手动专项和正常回归，使用 code-review 对照规格与仓库标准修复问题；验证写入本任务 validation 或 journal。实现阶段另行授权，提交、推送、PR 按已有授权判断；当前没有这三项授权。公开 GitHub 提交和 PR 使用英文，授权提交时保留配置作者并追加规定的 Codex trailer。

## 待审查决策与可执行性

建议采纳：SDK 同一夹具的关闭失败一并处理；CLI 宽限 7000 ms、强杀退出确认 3000 ms；采用 AggregateError 保留原失败；真实故障专项通过 SIGSTOP 与隔离子运行器执行。以上为本规格建议，等待本次规格审查，不冒称用户逐项确认。

无必须补充的业务输入。规格自评 **96/100**：范围与职责 20/20、失败合同 20/20、实现落点 18/20、验收可观察性 20/20、环境与恢复约束 18/20。剩余不确定性是具体握手机制和 Node 输出细节，实施时以 A1/A2 实测解决；如需改变验收条件或扩大范围，应返回规格审查。
