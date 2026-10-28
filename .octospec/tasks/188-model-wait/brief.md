---
type: Task
title: Issue 188 模型静默反馈与有界取消
description: Channel Gateway 在原响应卡片底部每 30 秒更新连续模型等待，300 秒取消并如实展示结束状态。
tags: [channel, delivery, testing, interaction]
---

# 目标

依据 https://github.com/Mininglamp-OSS/octo-runtime/issues/188#issuecomment-6460043487，消除长时间模型静默时看似冻结的 IM 体验。独立 worktree `.worktree/octo-runtime-188-model-wait`，分支 `fix/188-model-wait-feedback`，基线 `origin/main@59cb21a14259b6dc828f8791b8117ba1f3689f4c`。

## 意图与责任归属

业务目标及静默策略由 Channel Gateway 拥有；显式输入是现有 CanonicalEvent，动作是更新原卡片及调用既有 cancelInvocation。Kernel/Adapter/公共协议、其他 Extra 和宿主部署不承接该产品策略。不新增进程、持久化、配置或模型调用；原 Gateway 服务内每个 ImTask 拥有计时器和临时状态，任务结束、用户 Stop、排空及迭代器清理释放。

## 关键合同

- 初始调用交接及返回模型等待开始新间隔；30/60/90…270 秒更新同一 footer。计时使用单调时钟，迟到回调按实际连续等待时长计算。
- 只有非空 assistant 文本或明确可公开的 reasoning 内容重置静默；message.update 是快照，只在实际内容增长时算进展。ACK、session、usage、activity 心跳不重置。私有 reasoning 不用于反馈。
- 同时跟踪工具和交互身份，任一未完成工具/审批/用户输入等待均暂停；完成最后一项后重新开始。activity 的等待状态补充无工具事件的适配器，不能被心跳取消。
- 300 秒只发起一次 cancelExecution，立即禁用自动重试，保留原流观察 signal。等待取消确认期间沿 active 模板显示“超时，正在请求停止”；10 秒未确认或取消失败显示“停止未确认”。确认原流正常耗尽且有真实终态后才能开放 Retry；未知结果不开放。
- 原卡片 `progressText` 位于底部。复用 CardSession 的 messageId、序号、调度、终态屏障和预算；不追加阶段、虚构推理或每 30 秒另发文本。恢复内容即清除等待 footer。
- 正常输出、长工具、交互、reset/续聊、最终文本及既有 Codex 恢复保持其合同。超时不授权重放。迟到成功保留真实 completed。

## 实施步骤

1. Gateway 内增加独立可注入时钟的 model-wait 状态机；ImTask 观察统一事件并拥有其清理。
2. ImRuntime 合并计时快照，经原 presentation 更新；卡片渲染复用 footer，区分等待、取消中、未确认和确认结束。
3. 确定性时钟验证边界、并行工具/交互、生命周期与竞态；真实 Kernel/IPC 验证取消和尾流；指定测试账号连接 im-test，验证原卡片消息 ID、footer、递增序号及最终投递。
4. 格式、lint、命名、类型构建及相关/全量回归；证据写 journal，未执行的真实 renderer 场景单独声明。

### 实施中确认的前置修正

Gateway 默认 limits 使用 `model_idle_policy: observe`，首帧预算为 310 秒，使 Gateway 的 300 秒连续静默策略先处理；整轮与工具预算继续由 Core 执行，显式 Context limits 优先。Core 原首帧预算按整轮开始时间计算，首次输出前长审批会在恢复后立即超时；预算基点改为进入 starting 阶段的时间。Core 同时识别统一活动中的工具、审批及输入等待，与正式工具/交互分别持有生命周期；活动工具也拥有独立 idle/wall 时钟，真实进度只续 idle，心跳不续期，人工等待仅暂停重叠时间。正式终态清理对应活动，并行阻塞继续有效，整轮期限不暂停。此为通用等待期限修正，30/300 秒产品策略仍只属于 Gateway。

真实 Stop 验收复现既有本地 signal 提前中止导致真实取消终态被尾流检查变成 unknown。运行中的用户 Stop 改为复用 cancelExecution 保留观察；尚未执行/退避时仍中止本地等待，整轮期限及恢复预算仍强制中止。追加真实 Kernel IPC 的文本 Stop 与卡片 Stop 回归。

## 可执行性评估

自评 **96/100**，达到用户要求的 95 分实施门槛。这是准备度，不代表验收通过。

| 维度 | 分数 | 依据 |
| --- | --- | --- |
| 需求与边界 | 20/20 | 评论给出明确时间、状态及取消合同 |
| 代码与模板定位 | 20/20 | ImTask、ImRuntime、CardSession、reasoning-frame；服务端 active 模板 footer 确认为 progressText |
| 状态与竞态 | 19/20 | 单调时钟、并行阻塞项、真实尾流、超时后禁重放；底层取消可能不确认须明确展示 |
| 兼容性 | 19/20 | Gateway 独有策略，不改公开协议或适配器；将运行相关回归 |
| 验证可执行性 | 18/20 | 时钟与真实 IPC 可控；已有 im-test Bot 凭据，真实 renderer 登录能力须实测确认 |

## 验收

- 时钟测试覆盖 29,999/30,000/60,000/299,999/300,000ms、内容恢复、ACK/心跳、工具/交互及清理；取消仅一次且无自动重放。
- 卡片测试确认 footer 字段、同一 messageId 编辑、Stop 保持、终态后不回退；取消受理不等于结束，未知不显示 Retry。
- 使用用户指定仓库外账号文件连接 `https://im-test.deepminer.com.cn/`；真实收发证据与故障注入/模拟 Provider 分开记录，不输出凭据。
- `pnpm lint`、`pnpm lint:names`、`pnpm typecheck`、相关 Node 测试，必要时完整套件；失败与未执行项明确记录。

## 范围外

修改 Adapter、将产品策略下沉到 Core watchdog、增加 reasoning 通知、自动 replay、重启用户现有服务、改全局凭据、合并及部署。

用户后续授权本地双轴 code-review、修复、提交并创建 PR；审查基线仍为上述最新 main，具体发现及处理见 [审查记录](review.md)。公开提交及 PR 使用英文，保留配置的 Git 作者并添加 Codex trailer。
