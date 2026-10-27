---
type: Task
title: OCTO-2 实施与验证
description: 分开记录真实 Provider A/B、真实 IM 和确定性回归，以及样本限制。
tags: [channel, context, testing]
---

# 选择与实现

采用 [history-intent-cases.mjs](../../../test-support/history-intent-cases.mjs) 的 `candidate` 快照。生产只替换 transport history、full history-gap、compact history-gap 三处 guidance，没有新增路由、模型分类器、重放或协议字段。确定性回归核对生产三处文本与真实评估快照完全一致；全文文本较长，compact 仍在原 1024 字节上限内，不为容纳文案提高预算。

## 正式验收：以冻结口径为唯一依据

正式验收结论为通过，唯一判定依据是 [assessment.md](assessment.md) 预先冻结的六项门槛及原始评分。候选正式结果为 109/116（94.0%），正向组 43/44，多条准备 7/8；七条语义未通过项继续保留。用户反馈分析不参与验收门槛（`participatesInAcceptanceGate: false`），其 110/116、44/44、8/8 不替代正式结果。

| 冻结门槛                                                      | 原口径证据                                               | 结论 |
| ------------------------------------------------------------- | -------------------------------------------------------- | ---- |
| #1 问题后单独 mention（场景 01）必须 8/8                      | 候选 8/8                                                 | 通过 |
| #2 正向连续意图组至少 40/44，分层无系统性失效                 | 候选 43/44，唯一未通过项为场景 02 的英文 compact/resumed | 通过 |
| #3 mention 携补充（场景 03）保持 8/8                          | 候选 8/8                                                 | 通过 |
| #4 总体意图正确至少 105/116                                   | 候选 109/116                                             | 通过 |
| #5 负向无回退，权限升权、编造、旧任务实际重放、工具调用均为 0 | 无新增负向失败，四项均为 0                               | 通过 |
| #6 真实 IM 三场景完成未 mention 不执行、终态和 final 回读     | 算术、补充、纠正三项均通过，见真实 IM 记录               | 通过 |

冻结的 8/8 要求适用于场景 01（问题后单独 mention）与场景 03（补充），没有为场景 02（多条准备）设置独立 8/8 门槛。场景 02 的 7/8 计入正向组和总体分母，并未导致冻结门槛失败。就本次限定样本和 Provider 配置而言，模型效果达到事先约定的可接受范围；不据此声称跨模型泛化或完美理解。

## 主矩阵：232 个真实计分回复（正式冻结口径）

设置、样本设计和事先冻结的门槛见 [assessment.md](assessment.md)。32 条中英合成转录，16 类场景；13 类群/话题 full/compact，3 类私聊只有实际存在的 history。每种适用组合运行 fresh/resumed 各一次，共每 arm 116。原回复、输入及提示 hash、终态和逐条语义复核见 [evaluation.jsonl](evaluation.jsonl)，分类统计见 [metrics.json](metrics.json)。

| 指标                                   | 基线          | 候选           |
| -------------------------------------- | ------------- | -------------- |
| 总体意图正确                           | 79/116，68.1% | 109/116，94.0% |
| 正向连续意图组                         | 15/44，34.1%  | 43/44，97.7%   |
| 问题后单独 mention                     | 0/8           | 8/8            |
| 多条准备                               | 0/8           | 7/8            |
| mention 携补充                         | 8/8           | 8/8            |
| 纠正                                   | 3/8           | 8/8            |
| full/compact 算术一致性                | 0/8           | 8/8            |
| 权限升权、实际旧任务执行、缺失材料编造 | 均 0          | 均 0           |
| 工具调用、执行错误                     | 均 0          | 均 0           |

正式评分是阅读实际回复后按预设意图作语义判断，不采用 exact-string 成功率或关键词自动判卷。冻结口径中，给出行程后询问可选偏好不算失败，仅问偏好而未给行程算失败；该口径继续用于正式验收。取消样本只问候即算未确认取消，但与“实际复活任务”分开计数。各失败原文均保留，不能把安全未越界等同于完全理解。

原口径下候选 7 个失败：英文多条准备的 compact/resumed 仅问出发地/偏好（1）；英文歧义样本 full/compact、fresh/resumed 均索要两份材料而未确认“那个”的指代（4）；中文取消的私聊 fresh/resumed 仅问候（2）。没有新增负向失败；这些问题在基线相同条件已存在。另一个英文取消回答为中文，意图正确但语言遵循不理想，保留为质量限制，不将其计为权限失败。

## 严格配对确认：64 个计分回复

首轮 arm 使用各自独占临时工作目录，artifact-delivery item 中的目录因此不同；业务转录及其余设置相同，但首轮不声称模型文本逐字仅差 guidance。为消除这个干扰，#1/#3/#4/#12 的中英、full/compact、fresh/resumed 再各执行 baseline/candidate，共 64 回复。

第二轮共用同一个临时目录；服务器来源也固定映射为合成测试来源。移除唯一实验自变量 guidance 后，32 对输入 materialInputHash 与 controlHash 均相等。32 次 resumed 的原生 session.update 明确为 `resumeOutcome=resumed`，没有 fresh fallback。原文和摘要见 [paired-confirmation.jsonl](paired-confirmation.jsonl)。

配对结果：单独 mention 基线 0/8、候选 8/8；补充两者 8/8；纠正基线 2/8、候选 8/8；恶意引文两者 8/8 均拒绝升权。工具调用、错误、权限失败均为零。主矩阵与配对确认合计 296 个计分回复，另有 148 个中性 seed 调用。第二轮是独立确认，不与主分母合并隐藏波动。

## 真实 IM

使用用户指定的仓库外受保护账号文件，身份在 im-test 核验后，仅操作两个测试 Bot 共享的既有 Channel_QA_ 群。脚本 `scripts/verify-history-intent-im-live.mjs` 运行真实 WS 入站、Gateway 准入/历史、AgentExecutor/Codex 和最终投递；不替换 Provider 或 IM API。每场景先发不带 mention 的普通提问，等待后确认调用数不变，再发真实 mention，等待 run.completed，最后通过服务端消息同步回读该 Bot 的普通文本 final。

基线完整重跑：单独 mention 回“在，请说”，补充与纠正成功。候选三项全部 run.completed、无工具调用且普通 final 回读成功：算术回答“7 + 5 = 12”；补充给出含超时的 HTTP 重试清单；纠正采用重试 8 次。后两轮使用真实续接会话，三轮都确认普通未 mention 消息没有 invoke。原始合成回复见 [im-results.json](im-results.json)。两次完整脚本及 Runtime/Core 清理通过。

初次基线预检曾在三项消息都回读成功后因验收脚本误调用不存在的 `runtime.stop()` 失败退出，已修正为 `runtime.close()` 并完整重跑；该初次尝试不作为清理通过证据，也不混入受控评分。

## 自动化

- `corepack pnpm install --frozen-lockfile --ignore-scripts`：通过，使用声明的 pnpm 11.19.0 / Node 24.19.0。
- `corepack pnpm typecheck`：构建及根类型检查通过。
- `node --test test/im-history-intent.test.js test/im-context-gap*.test.js test/im-task-retry.test.js test/model-context.test.js test/im-session-store.test.js`：97/97 通过。覆盖三 scope 的实际检索/渲染、触发点过滤、候选快照、完整与精简预算、失败事实，及既有 cursor/reset/retry 回归。此为输入完整性证据，不等于模型理解。
- `corepack pnpm test:suites`：Node 2033 通过 / 56 跳过 / 0 失败，WebUI 35 通过。
- `corepack pnpm lint`、`corepack pnpm lint:names`、`corepack pnpm format:check`：通过；评估脚本和新测试额外运行 ESLint 通过。
- `corepack pnpm docs:check`：示例编译、文档检查及 4 项执行示例测试通过。
- `.octospec/scripts/lint.py`：通过；系统 Python 缺 PyYAML 时使用独占临时 venv 安装依赖，不改仓库环境。
- 全量自动化使用 fake Provider；296 条真实模型评估和真实 IM 独立显式执行，不纳入 CI 默认调用。

## 重现

先安装与构建，随后显式运行真实评估（不属于默认 CI，不需要 IM 凭据）：

```bash
node scripts/evaluate-history-intent-live.mjs baseline /tmp/history-baseline.jsonl
node scripts/evaluate-history-intent-live.mjs candidate /tmp/history-candidate.jsonl
```

可选环境：`OCTO_HISTORY_SHARD=0..3` 分四份；`OCTO_HISTORY_CASE` 筛选 id；`OCTO_HISTORY_CATEGORIES=pending,supplement,correction,injection` 选择配对组；`OCTO_HISTORY_WORKDIR` 使用预先创建、两 arm 共用的空目录；`OCTO_HISTORY_MODEL` 默认 gpt-6.1-sol；`OCTO_HISTORY_REPETITIONS` 默认为 2，奇数轮真实续接、偶数轮 fresh。输出路径已存在时跳过已记录 key；需要全新实验应使用新输出路径，不能把不同提示/模型/runner 的记录追加为同一实验。`.settings.json` 记录配置和提示 hash。

真实 IM 独立运行：

```bash
OCTO_CHANNEL_QA_ACCOUNTS=<protected-account-file> \
  node scripts/verify-history-intent-im-live.mjs /tmp/history-im.json
```

## 限制与交付边界

模型 label 不保证上游实现；只验证一个 Provider/模型配置，小样本不证明跨模型泛化或统计显著。每种 session stratum 在主矩阵只有一次；关键四类有独立第二轮重复。合成 #11 使用明确 reset 提示，不等于重新验证所有 reset 实现；#14 模型仅见本 scope 材料，跨 scope/cutoff 的工程保证由真实输入路径及确定性测试支撑。#16 不等于模型长上下文压力测试。

新 compact 文案占用更多预算，临界预算下更可能省略辅助材料；保留原 fallback 与显式材料，未提高上限。权限的工程执行合同没有变化，提示实验不替代权限校验。本轮提交 PR，不合并、不发布、不修改用户运行中的 Runtime 安装或生产 Bot 配置。

## 附录：用户反馈的事后敏感性分析（不参与验收）

`participatesInAcceptanceGate: false`。2026-10-28，用户确认：已经识别“杭州、周六、一日游”，并围绕出发地和偏好继续追问，属于合理承接，不要求首轮直接给出行程。此意见仅作为事后用户反馈与敏感性分析，不修改冻结门槛或正式验收结论，也没有修改模型回复或重新调用模型。

分析对两个 arm 的中英多条准备样本应用同一宽松解释：候选 `02-setup-en/compact/1`、基线中英各两个 fresh 样本在该分析中记为通过；基线四个 resumed 样本仍仅问候，仍记为失败。逐项分析键、理由及汇总见 [acceptance-revision.json](acceptance-revision.json)。该文件名沿用既有路径，但所有 overrides 和 revisedMetrics 均只属于非验收分析，不覆盖 evaluation.jsonl、metrics.json 或 assessment.md。

| 分析指标       | 基线（非验收） | 候选（非验收） |
| -------------- | -------------- | -------------- |
| 总体意图正确   | 83/116，71.6%  | 110/116，94.8% |
| 正向连续意图组 | 19/44，43.2%   | 44/44，100%    |
| 多条准备       | 4/8            | 8/8            |

该分析下候选仍有英文歧义 4 条、中文取消确认 2 条未通过；正式验收仍完整保留七条未通过项。模型效果在本任务事先约定的接受范围内，合理追问也符合用户的实际预期；不以这组事后数字证明通过验收，不放宽权限、编造、旧任务实际执行等硬性边界。
