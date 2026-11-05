---
type: Review
title: Issue 313：双轴审查与运行验证
description: 固定基线审查未提交实现，分别记录 Standards、Spec 和 verified-review 的证据、修复及剩余验收范围。
tags: [review, testing, architecture, lifecycle]
---

# 审查范围

基线为 `de3ff37a86ee3cb8f6ab66148ceca817f6ae5240`，审查执行时 HEAD 等于基线，没有本地新增 commit。审查对象为当时的 `git diff HEAD --` 及全部未跟踪文件；仅比较 commit 会漏掉本次实现。需求依据为 issue #313、#307 澄清、用户限定的常驻 PID 视图及本任务设计和验收文档。后续提交仅将已审查实现纳入 Git，并补充交付授权说明。

最终范围共 75 个文件（53 个 tracked、22 个 untracked，包含本审查记录）。使用 code-review 的独立 Standards / Spec 子审查，主 agent 串行执行 verified-review 的逐文件阅读、候选问题过滤和实际运行。四份生成产物不做逐行人工审查，其余 71 份包括源码、夹具和文档；生成物以 Schema 输入、生成器及 `pnpm native:check` 核验。格式、命名等已有工具检查不重复列为人工 finding。原目录没有 issue-tracker.md，本次已明确给出 GitHub issue 和 OctoSpec，未安装额外工具或修改项目配置。

## Standards

首次确认 5 项 P2，均已修复。没有保留仅凭代码味道作出的推测性 finding。

| 问题及规则 | 修复 | 复验 |
| --- | --- | --- |
| 共享 stdout 按默认上限读取，未遵守有效 rawMessageMaxBytes；stateless-execution 的受信限制合同 | 有效预算进入服务兼容键及 parse 前行限制；活动图片回显保留受控例外 | 低预算、无换行 300 KiB 输出：修复前等到取消，修复后及时 run.failed |
| thread 历史容量在 ACK 时抛错，影响健康连接；stateless-execution 的容量隔离合同 | thread/start 前预留 used/live/pending 槽，局部拒绝新请求 | 4096 历史边界下原服务 PID/代次及活动 sibling 保持 |
| 进程状态枚举通过 String 转换接受数组；protocol-schema 的运行期类型合同 | 先验证 state/observation 为 string，再验证枚举 | 修复前数组枚举被接受，修复后数组、对象、null、布尔值均拒绝 |
| 测试 owner 未检查 scope 清理结果；architecture 的资源所有权合同 | scope helper 明确断言 complete；native Host 故障场景显式预期 incomplete 并要求服务清理 ID 为空 | 26 项手动专项及 native-host 19 项通过；先启动全部 shutdown 再断言，单个失败不阻断其他 owner 收尾 |
| 手动协议探针在 child 已退出后才等 close，可能挂起；engineering 的有界验收合同 | 复用 createProcessCleanup，保留原失败及清理失败 | 注入提前 exit：修复前 watchdog 以 86 结束，修复后有界失败，exit 1 / initialize timeout |

复审及最后测试收尾改动复核：无未关闭 finding。最后一次 Standards 复核为源码检查，19 项执行结果来自主 agent。

## Spec

首次确认 1 项 P1、1 项 P2，均已修复；与 Standards 的容量 finding 重叠一项，不合并两轴评级。

| 问题 | 需求及影响 | 修复与复验 |
| --- | --- | --- |
| P1：历史容量错误使整个服务重建 | 健康服务不能因局部容量拒绝被驱逐，不能导致 sibling 失败 | 发 RPC 前局部容量拒绝；专项确认 ready、PID、incarnation 和 sibling 保持 |
| P2：doctor 按 PID 合并旧清理资源与新存活 Extra | 同 PID 合并必须代表同一存活进程；OS PID 复用不能吞掉清理未确认记录 | 仅在均 alive、owner/service/incarnation 身份一致时合并；旧资源与新 Extra 分别保留 |

复审：无未关闭 finding，无已确认的额外扩围；复审者实际运行两个相关专项并通过。

## Verified Review

主 agent 对上述六个独立问题核对触发条件、调用路径及反证，并实际复现行预算、枚举类型、容量、PID 复用和探针退出问题。修复后 26 项显式专项全部通过。全量回归中发现 native-host 新增清理断言未区分 Core 既有的 next() 抛错合同；修正测试预期和收尾顺序后，19 项相关回归及完整默认回归再次通过。生产代码没有为通过测试放宽清理合同。

最终默认回归为 2400 项，2334 pass、66 skip、0 fail；未增加既有默认用例数。最终 tgz 的包外 Codex 公共类型与 direct/IPC 各三轮复用、owner 清理通过，既有离线发行验证也通过。真实 Codex direct/IPC kill/recovery 及 MCP elicitation 在前述预算、容量和诊断修复前已通过，未将其写成修复后重新执行的模型测试。完整命令和环境见[验证记录](validation.md)。

## 交付边界

Linux/Windows 原生、外部 Electron、实际 IM、真实并发审批、完整恢复预算耗尽等仍按[验收表](acceptance.md)保留 partial / not run；这属于证据缺口，不是已通过项。未关闭 GitHub issue。

相对基线的 `.github/workflows`、`package.json`、`scripts` 和锁文件无 diff；专项仅本地显式执行，未扩大 CI。审查执行时没有 PR，实际托管检查列表为 not applicable；当时无 commit、push、merge 或 publish。用户随后授权提交和创建 main PR，后续状态见[交付记录](validation.md#后续-pr-交付授权)及对应 GitHub PR。

两轴最终结果：Standards 0 项未关闭（首次 5 项，最高 P2）；Spec 0 项未关闭（首次 2 项，最高 P1）。

## PR 317 外部路径审查整改

2026-11-05 对[外部 P2](https://github.com/Mininglamp-OSS/octo-runtime/pull/317#pullrequestreview-5779607241)逐项核对，复现基线为 PR head `2515e7be6c82c3c6c6562bc868d8ea7f33d6c3e4`。本地已 fast-forward 远端合并 main 的提交，保留 #314 的全部改动。审查指出 executableIdentity 可能因重复 cwd 解析而遗漏文件身份；其对绝对 cwd 的解释不成立，但显式 Adapter scope 接收相对 cwd 时确实可以复现。

增加四个仅手动运行的真实 POSIX 可执行夹具：`./codex`、`bin/codex` 分别搭配绝对和相对 cwd。替换前连续调用复用 PID，原子替换文件后应新增服务并保持旧服务 ready。修复前：两项绝对 cwd 通过、两项相对 cwd 失败，服务数实际 1、预期 2。修复后：四项全部通过，scope 最终清理 complete；未调用真实模型。

生产修复只将带路径命令的搜索目录从 `[cwd]` 改为 `[""]`，使现有 `resolve(cwd, directory, command)` 只应用一次 cwd。裸命令仍按 PATH 搜索，Windows 扩展名规则不变。本修复没有引入自动热重启：旧进程及已接受任务保持，新请求按既有文件身份合同选择新服务。用户尚未确认改为“仅重启 Runtime 后升级生效”，因此不借此次整改变更生命周期策略。

code-review 复审：Spec 无新增问题，并实际运行四项回归；Standards 指出的新增测试清理顺序已修正为先确认 complete 再删目录，最终未关闭项为 0。主 agent 的 verified-review 复现及修复后运行结果见[验证](validation.md#外部-review-修复后重验)。新专项保持手动入口，无 CI 扩围。代码修复不等于 GitHub 已重新批准，远端审查状态仍以 PR 为准。
