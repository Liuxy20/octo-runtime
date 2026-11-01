---
type: Validation
title: Issue 233 实现与本地验证
description: 第二版独立 Kernel 依赖装配、RPC 独立性、全阶段回收与错误证据的本地验证。
tags: [testing, lifecycle]
---

# 当前结论

## 最新 main 复验与 PR 准备

2026-11-01 用户授权更新 main 并提交 PR。已 rebase 到 `origin/main@42102c60103a9b18166c499b0c74a23e0d2295c6`，实现提交为 `8baba8d2acc200d44bcd9a361437dc05d1581c28`；构建时工作区干净，后续只补充本任务文档，不改变已验证测试源码。唯一冲突为工程日志，已保留双方内容。

最新基线重新执行：依赖锁未变；build、根 tsc、lint、lint:names、改动文件 Prettier 及知识 lint 均通过。普通恢复 2/2（CLI 10166.98 ms、SDK 10168.05 ms，总 20554.23 ms），手动专项 12/12（45044.47 ms），已有日志/SDK 生命周期 22/22（3362.00 ms）。知识 lint：573 单元、20 规则、3550 本地链接。双轴新基线复审均 0 发现。

| 最新主线场景 | 测试 PID / K / G | worker | 结果 |
| --- | --- | --- | --- |
| CLI 暂停，主体成功 | 97224 / 97228 / 97240 | 97238、97385 | 实际宽限 7000 ms，保留 timeout，关闭后独立 RPC 成功，所属进程全退出 |
| CLI 暂停，主体失败 | 97954 / 97955 / 97959 | 97957、98739 | 实际宽限 7001 ms，原始失败与 timeout 同时保留，独立 RPC 成功，所属进程全退出 |
| CLI 正常关闭 | 99315 / 99317 / 99324 | 99319 | 无关在途、新请求均 completed，Kernel 实例不变，全退出 |
| CLI 强杀 | 99477 / 99478 / 99482 | 99480 | 无关在途、新请求均 completed，Kernel 实例不变，全退出 |
| SDK 原生关闭 | 117 / 119 / 123 | 120 | close 完整，无关在途、新请求均 completed，Kernel 实例不变，全退出 |

以上退出断言均在兜底前完成；未用 fallback 冒充被测清理成功。CLI lost 后仍保留 exitCode=5，SDK 精确保留仅 runs incomplete 的预期事实；不能将 CLI 结果解释为原生日志资源完整。Windows/Linux、全量套件与真实模型/线上 IM 未执行。相对最新 main 的 workflow、默认测试脚本及锁文件 diff 为空；分支保护现有唯一必需检查为 CI Gate，未增加检查或 gate 依赖。

以下为前一版基线的实施证据，保留供追溯。

第二版已实施，以下结果对应 `7fd022cd725030317feee75d27621fa6b4d996e6` 加本任务未提交修改。普通 CLI/SDK 2/2、手动专项 12/12、相关现有回归 22/22 通过。无生产代码、依赖或 CI 范围变更；未提交、推送或创建 PR。

## 第二版实现与验收

- 外层独立启动 Kernel dependency；CLI Gateway 使用 CLI run，SDK Gateway 在独立宿主直接构造 createExtraService，仅接收 endpoint/config。Kernel、Gateway、worker 与测试进程 PID 均不同。
- 外层先清理 Gateway，手动探针确认 Kernel 原 PID/实例、无关在途调用终态与新 RPC 成功，最后才清理 Kernel。每阶段独立捕获错误，探针校验失败也关闭自己的客户端并继续环境清理。
- 原生宿主通过私有 IPC 消息调用原生 close，避免 Windows SIGTERM 直接退出而跳过 close；消息发送和退出共用 7000 ms 预算，之后 SIGKILL 与独立 3000 ms 确认。进程 exit 与管道 close 分别登记，等待 close 后解析完整输出。
- SDK 默认不启用文件日志。现有 statusOutput 要求 directory；测试模块透明转发 Gateway 入口与 log，用现有 extraStatusRecord 白名单捕获渠道状态，不声称测试了 SDK statusOutput sink。未修改日志 API，也不放行 logs incomplete。
- 主动 worker loss 对应的 LookupKey 由 fake Adapter 写入私有文件，外层 get 确认其终态 lost。SDK close 精确断言仅 runs incomplete，保留完整原结果与诊断；未注入 worker loss 的手动 SDK close 必须完整。
- CLI 主动 worker loss 后实际 exitCode=5，前台宿主只公开聚合退出码。测试记录此事实，不推断其仅有 runs 问题或日志完整；进程退出与独立 RPC 仍单独验收。普通无 worker loss 的 CLI 停止要求 exitCode=0。这一观察限制已同步 brief。

## 第二版验证结果

平台：macOS，Node `v24.22.2`，pnpm `11.19.0`；worktree `/Users/lvsijia/github.com/Mininglamp-OSS/octo-runtime-issue-233`，分支 `fix/233-recovery-teardown`。普通恢复测试 SHA-256：`f6c7f8cee7ecd30c67f82cd108d8c562e15eca6b6d1d5ebc61d02247ae9fa8b9`；手动运行器：`72bce3fb8a7e9587a066bea5556a81e4950c83b2f376b64484f5887fdcd565f1`。

| 命令 | 第二版结果 |
| --- | --- |
| `pnpm install --frozen-lockfile --ignore-scripts` | 通过，匹配当前 lockfile，未修改依赖文件 |
| `pnpm build` | 通过；既有 WebUI 第三方 use client 指令提示 |
| `pnpm exec tsc -p tsconfig.json --noEmit` | 通过 |
| `pnpm lint` / `pnpm lint:names` | 通过，lint 范围为 apps/packages；命名检查无发现 |
| 改动的 8 份 JS/MJS 的 Prettier 检查 | 通过 |
| `node --test test/recovery-dual-mode.test.js` | 2/2；CLI 10132.84 ms，SDK 10053.50 ms，总 20261.22 ms；SDK 保留 runs incomplete，CLI 保留 exitCode=5 |
| `node --test test/manual/recovery-teardown.test.mjs` | 12/12，总 44440.92 ms；7 项确定性错误路径、5 项真实进程场景 |
| `node --test test/extra-status-logs.test.js test/runtime-logging.test.js test/host-sdk-lifecycle.test.js` | 22/22，总 3178.33 ms，沿用现有日志与服务生命周期专项 |

### 第二版真实进程证据

| 场景 | 测试进程 / K / G | worker | Gateway 宽限 | 结果 |
| --- | --- | --- | --- | --- |
| CLI 暂停，主体成功 | 7456 / 7458 / 7462 | 7459、8058 | 7002 ms | 超时错误保留，强杀后继续原 Kernel 的 RPC，再回收环境 |
| CLI 暂停，主体失败 | 8239 / 8241 / 8245 | 8242、8313 | 7003 ms | 原始失败和关闭超时同时可见，原 Kernel 的 RPC 仍成功 |
| CLI 正常关闭 | 8481 / 8483 / 8489 | 8487 | 非超时 | 无关在途 completed、新请求 completed，原 PID/实例不变 |
| CLI 强杀 | 9010 / 9013 / 9018 | 9015 | 非超时 | 无关在途 completed、新请求 completed，原 PID/实例不变 |
| SDK 原生 close | 9086 / 9087 / 9091 | 9089 | 非超时 | close 完整，独立在途与新请求 completed，原 PID/实例不变 |

两次暂停期间也实际执行独立 RPC，关闭后独立性事件严格先于 Kernel native-close。以上所有所属 PID 均在兜底之前确认 ESRCH；外层没有依靠 fallback 使断言通过。未知结果保持未知，没有重放 lost 请求。

确定性覆盖 Gateway close 同步抛错、异步拒绝与 incomplete 后继续下一资源；信号 throw/false；强杀等待超时；native-close 发送回调永不完成；进程退出但管道未关；部分 spawn 失败；原始错误及 falsy 值保持。

### 第二版修正与限制

首次 SDK 试跑暴露 statusOutput 不能脱离 directory，随后改为测试专用状态捕获；一次包名导入因根包未直接依赖 Adapter SDK 而失败，已改为本仓构建路径。最终上述命令已重跑通过。审查发现 Windows 信号不执行原生 close、SDK 校验错误可能跳过探针关闭，均已修正；native-close 与管道关闭另加确定性覆盖。

专项只在 `test/manual/` 显式执行；默认测试场景仍为原 CLI/SDK 两例，不修改 workflow、job、触发器、矩阵、required checks、gate 或默认脚本。未运行全量测试、真实模型/线上 IM、Windows/Linux；Windows 仅完成结构性审查，不能声称已实测。CLI 原生资源列表不可观测的限制不等于已证明其日志关闭完整。

双轴 [code-review](review.md) 最终 Standards 0 / Spec 0 遗留项。5 份知识 Markdown 元数据检查通过，全仓知识 lint 通过（546 单元、20 规则、3438 本地链接），diff 空白检查通过；相对 origin/main 的 `.github`、`package.json`、`pnpm-lock.yaml` diff 为空。功能日志保存在本机 `/tmp/ort68-triage.huIj9i/` 的 `*-v2*.log`，主要证据已在本文保留。

## 首轮历史记录

历史结果说明：以下部分记录首轮 `0bcd89c5` 基线实现及随后规格重写当时的状态；其中的通过/失败和“尚未实施”均不代表当前第二版结果。当前结论以上文第二版验证为准。

第二版规格文档检查（2026-11-01）：本任务 4 份知识 Markdown 的 YAML 语法、mapping、必填字段及 type 均通过；`.octospec/scripts/lint.py` 全仓通过，545 个 OKF 单元、20 条规则、3435 个本地链接；`git diff --check` 通过。系统 Python 缺少 PyYAML，使用仓库外独立临时 venv 补齐后运行，未改项目依赖。相对最新 origin/main 的 `.github`、`package.json`、锁文件 diff 为空。四份旧测试源文件 SHA-256 与上一轮一致，本轮只重写规格和记录，未重新运行功能测试。

逐阶段清理、错误保留及手动故障注入已实现。A1/A2 通过；A3 的普通 CLI 通过，SDK 因既有 Run 结果未知而报告清理不完整，整体尚未通过规格验收。等待用户决定是否允许该特定场景显式断言预期 incomplete；未调整已认可规格，也未修改生产合同。

## 版本与范围

- 基线/HEAD：`0bcd89c528018ffd508ca8099c8ac9c6b88de35d`，dirty，分支 `fix/233-recovery-teardown`。
- Worktree：`/Users/lvsijia/github.com/Mininglamp-OSS/octo-runtime-issue-233`；macOS，Node `v24.22.2`，pnpm `11.19.0`。
- 修改原恢复测试，增加 `test-support/recovery-cleanup.mjs` 与两个 `test/manual/` 文件，另有本任务文档与 journal/log。无生产包、公开 API、依赖锁、workflow 或默认测试命令修改。
- 未提交、未推送、未创建 PR，这三项尚未授权。测试结果对应未提交代码，不宣称绑定到新的提交。

## 实现

`trackRecoveryChild` 立即登记退出和 error，保留 errno；有 PID 的 error 不结束退出确认。`cleanupRecovery` 按原顺序清理连接、Extra、Kernel 和逆序子进程，各阶段错误保留后继续。CLI 保留 7000 ms 宽限，强杀后独立最多等待 3000 ms。SDK `complete:false` 被记录为失败。`finishRecovery` 保留主体原值和错误 cause；主体与清理同时失败时聚合，并逐项输出诊断。

Home 仅在清理完整时删除；不完整时保留目录并输出路径。手动 probe 原子发布资源 PID，暂停本次 Gateway，在强杀时验证 Kernel 仍活着；外层验证服务、两代 worker、实际测试进程均退出后才判成功。兜底介入自身算失败，且不能覆盖原始失败。

## 验证结果

| 命令 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile --ignore-scripts` | 通过，锁文件未变 |
| `pnpm build` | 通过；WebUI 构建有第三方 use client 指令提示 |
| `pnpm exec tsc -p tsconfig.json --noEmit` | 通过，与前一步合计覆盖 build 与根类型检查 |
| `pnpm lint` | 通过；既有命令覆盖 apps/packages，不把它当作测试 JS lint 证据 |
| `pnpm lint:names` | 通过 |
| `pnpm exec prettier --check test/recovery-dual-mode.test.js test-support/recovery-cleanup.mjs test/manual/recovery-teardown-probe.mjs test/manual/recovery-teardown.test.mjs` | 通过 |
| `node --test test/manual/recovery-teardown.test.mjs` | 最终 7 通过，0 失败，约 26.71 秒 |
| `node --test test/recovery-dual-mode.test.js` | 最终 CLI 通过（约 10.09 秒）；SDK 业务断言完成，Extra close 返回 runs 与 logs incomplete（约 9.91 秒），整体失败，总约 20.12 秒 |
| `git diff --check` | 通过；新增文件另通过格式检查 |
| `git diff origin/main -- .github package.json pnpm-lock.yaml` | 空，无 CI 或默认测试范围变更 |

手动专项不匹配 `test/*.test.js`。既有 `pnpm test:suites` 和 CI 入口不变；未增加场景到默认执行，故障注入只由显式命令开启。未运行全量测试、真实 Provider、线上 IM、Windows 或 Linux，本次没有这些平台的实测结论。

### 最终真实注入证据

| 场景 | Gateway 宽限实测 | Kernel / Gateway PID | Worker PID | 测试进程 PID | 结果 |
| --- | --- | --- | --- | --- | --- |
| 主体成功、Gateway 超时 | 7003 ms | 90073 / 90076 | 90074、90174 | 90072 | 子测试因超时失败；强杀后继续 Kernel，全部退出，外层通过 |
| 主体失败与 Gateway 超时并存 | 7002 ms | 91892 / 91895 | 91893、92681 | 91890 | 输出含 FIXTURE_ORIGINAL_BODY_FAILURE 与 FIXTURE_SHUTDOWN_TIMEOUT；全部退出，外层通过 |

以上 PID 均在外层兜底前通过 `process.kill(pid, 0)` 的 ESRCH 结果确认消失，Gateway 强杀发生时 Kernel 存活；同时核对 SIGTERM、超时、SIGKILL、Gateway 退出、Kernel SIGTERM 与退出的事件顺序。未依赖外层兜底完成被测回收。

其他 5 项手动测试覆盖服务异常后子进程退出、拒绝和 incomplete 明细、信号抛错/false、强杀退出超时不跳过后续 child、强杀成功仍保留宽限超时、已退出/spawn error、主体错误及 falsy 抛出值。

### 失败与修正记录

1. 第一次手动运行早于构建完成，缺协议包 dist；完成构建后重跑。
2. 初版手动运行器继承 NODE_TEST_CONTEXT，被 Node 当作递归测试发现跳过；已清除此内部标记。
3. 初版服务关闭错误未更新资源完整标记；针对性断言发现后已修正。
4. 双轴 review 发现外层兜底可能覆盖原失败、存活探测在 try 外、遗漏实际测试文件进程、服务错误后等待子进程覆盖不足；已全部修正并重新运行完整手动专项。

## SDK 规格冲突

该测试主动杀死活跃 worker。`InvocationRegistry.observe` 将 lost 记为 `RUN_OUTCOME_UNKNOWN`，`drain` 明确保留 unresolved，而 Extra 服务将 drain 不完整记为 `runs/EXTRA_CLEANUP_INCOMPLETE`。这是当前合同的保守结果，不应为了本测试通过而删掉未知结果或修改生产行为。

旧恢复测试只 await close，不检查返回值，因此该事实原先不可见。当前实现按规格报告它：

```text
FIXTURE_SERVICE_CLEANUP_INCOMPLETE
complete: false
errors: [{ resource: 'runs', code: 'EXTRA_CLEANUP_INCOMPLETE' }]
pendingResources: ['runs']
```

上面是首次正常回归结果；最新复跑还包含 `{ resource: 'logs', code: 'EXTRA_CLEANUP_INCOMPLETE' }`，`pendingResources` 为 `['runs', 'logs']`。Extra 各阶段共享关闭期限，但本次没有把 logs 不完整直接归类为可接受结果；即使用户允许预期 lost 的 runs 结果，也必须明确 logs 的验收方式，不可无条件放行所有 incomplete。

普通 CLI 的退出成功不等于 SDK 的 close 返回 complete；两者观察边界不同。当前不能同时满足“所有 SDK incomplete 均报测试失败”和“A3 正常 SDK 必须通过”。已向用户询问是否允许对该特定 lost 场景显式验收并记录预期 incomplete，同时确认 Kernel/worker 退出；没有默认忽略此结果。

## code-review

固定基线为上述 SHA，因无提交授权，审查比较工作区 diff 并读取未跟踪文件。使用 code-review 技能的两个独立审查者分别核对 Standards 与 Spec。

- Standards：初审 2 项 P2，修复后复核 0 项遗留代码问题。
- Spec：初审 2 项 P2 与 1 项覆盖缺口，修复后复核 0 项代码问题；仍有 1 项上述 SDK 验收决策未解决。

原始执行日志位于本机 `/tmp/ort68-triage.huIj9i/`：`build.log`、`typecheck.log`、`lint.log`、`names.log`、`manual.log`、`normal.log`。临时日志路径不作为长期唯一证据，本文件保存主要结果与限制。
