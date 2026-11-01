---
type: Task
title: Issue 265：保留 Codex 异步问题并通过公共接口回答
description: 将异步问题的结构、身份和生命周期传给宿主，按活动轮次回传答案，保留同步问答和审批行为。
tags: [protocol, interaction, adapter, invocation, testing]
---

# 历史规格（已被 brief.md 替代）

本文件仅保留首版设计与审查依据。原 Run 完成即问题失效的限制已由用户最新旁路 ask 决定取消，不能作为当前实现合同。

## 原目标

用户看到 Codex 的问题后，可以选择选项或填写自己的答案。Codex 在等待期间继续工作；Runtime 将答案送回提出问题的活动轮次，并准确报告接收结果。

来源：[GitHub #265](https://github.com/Mininglamp-OSS/octo-runtime/issues/265)、Loop ORT-84 分诊评论 `1825e3b1-0a0a-49fd-b8e3-bee470f3a405`，以及本会话对同步、异步提问和 `steer` 的讨论。用户以“开始实现”认可本规格，随后以“本地code-revew 然后提交PR到main”授权本地审查、修复、提交、推送和创建 PR，不授权合并。

原实施基线：`0bcd89c528018ffd508ca8099c8ac9c6b88de35d`；PR 审查前同步至 `origin/main@4a0f53b50723422d90f051944ae19eb28f60712a`。分支：`fix/265-codex-async-questions`，沿用独立 worktree。

本文为已获实施授权的规格；实施证据与限制另见 validation.md。

## 已知事实与原生依据

- 当前 Codex Adapter 对 `agentMessage` 只投影 message.create/update，丢失 `delivery` 和 `questions`；同步 `item/tool/requestUserInput` 走 reverse request 注册与响应路径。
- 本机 `codex-cli 0.164.0` 的 `app-server generate-ts --experimental` 确认：`agentMessage.delivery` 可为 `async`；questions 为 `{title: string, options: string[] | null}[] | null`，原生问题没有独立 ID。
- 同一生成协议中，`TurnSteerParams` 包含 threadId、expectedTurnId、input 和可选 clientUserMessageId；`TurnSteerResponse` 包含 turnId；UserInput 的 text 项带 text_elements。
- [官方 App Server 文档](https://learn.chatgpt.com/docs/app-server#steer-an-active-turn)说明 `turn/steer` 向活动轮次追加输入，不创建新轮次，要求 expectedTurnId 匹配；没有活动轮次时拒绝。它没有专用 questionId 回传参数，因此本方案通过明确的问答文本关联原问题，不宣称存在原生结构化 question-response RPC。
- [上游 #40805](https://github.com/openai/codex/issues/40805)报告过 steer 接纳与实际消费之间的差异。它是历史问题报告，不证明本机版本仍有该缺陷；本方案因此将接纳与消费分开验收。
- 当前 Core、Kernel 及 Codex responder 均只接受活动调用内的回答；turn 终态使交互失效并回收子进程。Runtime 不保存业务历史，重启不恢复旧 stream。

实施前已在本机 0.164.0 Default 原生轮次验证异步通知、steer 接纳、clientId 关联 userMessage 与模型使用答案；公开 Runtime 往返另见 validation.md。

## 责任与范围

| 组件 | 本次责任 |
| --- | --- |
| 公共 Protocol | 定义异步问题结构、响应值、非阻塞语义及可观察的终态；同步维护 Schema、生成类型和运行时校验 |
| Codex Adapter | 识别原生异步消息、绑定真实 thread/turn/message、调用 steer、确认原生响应、管理有界状态及失效 |
| Core / Kernel | 沿原 invocation/RunRef 转发回答；异步问题不误触发暂停、等待输入或超时豁免；保留身份和终态校验 |
| HostApp | 选择界面样式、保存业务展示历史、按公开合同渲染并提交，不解析 Markdown 或调用 Codex 私有接口 |

本次修复的起点是 Codex Adapter；公共扩展仅提供表达异步交互所需的合同，不要求其他 Provider 新增异步提问。

用户在 PR 准备阶段补充：现有 channel-gateway 不接入异步表单。Gateway 在任务消费入口成对忽略 async interaction.requested 及其 resolved，不注册响应、不发卡/文字操作入口、不改变等待状态，不暂停模型等待钟；普通消息正文照常投影，同步问答和审批保持。过滤只影响 Gateway 视图，不删除 Runtime 公开源事件、不向 Provider 代答或取消，原交互仍随原轮次结束或到期清理。

## 问题如何传给 App

### 消息快照与交互身份

1. 原生 `type=agentMessage`、`delivery=async` 且 questions 为非空合法数组时，保留消息正文、channel、原生 messageId，同时保留公开、类型化的 delivery/questions 消息快照。孤立调用 `normalizeCodexEvent` 也不能再丢掉这些字段。
2. 活动 transport 在收到 `item/completed` 的完整问题快照后注册一次 `interaction.requested`，kind 为 question，增加可选 `delivery: "async"`。省略 delivery 的既有交互仍按原同步合同解释。started 只保存可用快照，不提前把可能变化的表单发布为可提交。
3. 公共请求为 `request.schema = "octo.question-request/v1"`，包含 `messageId` 和 `questions`。每题包含 `id`、`title`、`options: string[] | null`、`allowCustom: true`；保留题目和选项的顺序，null 与空数组保持区别，两者均可自由填写。
4. interactionId 是原 invocation 与原生 threadId/turnId/messageId 元组的确定性标识；推荐使用 JSON 元组 SHA-256 加 `codex:async:` 前缀，不做字符串分隔猜测。题目 ID 固定为批次内从零开始的 `q:0`、`q:1`。原生 messageId 原样公开，题目 ID 明确属于 Runtime 派生身份。
5. 消息快照供正文保存与回放；`interaction.requested` 才是可回答的生命周期事实。Host 通过同一 messageId 关联成一份表单，不因两种事件显示两个问题。只有消息快照、没有当前交互状态时，不得猜测旧问题仍可回答。
6. 重复的相同 completed 通知不新增交互、不延长期限、不重新启用已回答表单。同一原生身份对应不同问题快照时，明确报协议冲突，不能更换用户已经看到的选项。
7. delivery 缺失/null、questions 缺失/null/空数组均不创建问题；文本看起来像提问也仍是文本。明确携带非空但结构损坏的问题时返回协议错误，不能静默降成普通文字后宣称适配成功。
8. 问题注册必须属于当前活动 thread/turn；来自其他轮次或历史恢复快照的消息不能注册为本次可提交的问题。

消息完成只表示问题已发布，不表示 Run 完成。不得把 async final_answer 错当作整次执行终态；真实终态仍由 turn/completed 决定。

### 非阻塞语义

- `delivery=async` 的问题不产生阻塞型 waiting_input 活动，不让 watchdog 暂停模型或工具计时，不阻止既有 finalization 检查；模型工作事件继续正常发布。
- 同步问题、approval 和 elicitation 的活动、超时和 full_access 处理保持原合同。full_access 不自动回答异步问题。
- 当前 native 输出继续完整保留原生消息。本次 canonical 答案接口不能被当作任意 Codex RPC 代理；native.respond 仍限于已有 reverse request 响应，不能因新增 steer 绕过模式校验。

## App 如何提交答案

复用公共 `KernelClient.respondInteraction(invocationId, response)`，以及现有按 RunRef 调用的 `respond` 原语。直接 Core 使用其现有 respondInteraction；跨 Kernel/worker 保持同一路由。无需新增 invoke 或通用 steer API。

异步问题的响应值明确为：

```json
{
  "interactionId": "<interaction.requested 中的 ID>",
  "outcome": "answered",
  "value": {
    "schema": "octo.question-response/v1",
    "answers": [
      { "questionId": "q:0", "text": "Workspace A" },
      { "questionId": "q:1", "text": "用户自定义的答案" }
    ]
  }
}
```

- 每批问题整体提交一次，每题一个文本答案；选项点击提交对应原始选项文字，自定义答案走同一字段。空白答案、漏题、重复或未知 questionId、非字符串答案均在写入 Provider 前拒绝。校验时判断空白，合法文本原样保留。
- 多题提交顺序可以不同；Adapter 按原题目顺序组装。每题答案最多 4096 Unicode 码点；响应仍受现有公共帧/JSON 容量限制，不增加传输预算。
- 不新增多选或部分提交语义；多个可选条目仍是单题单个答案，原生协议未声明多选。accepted/declined outcome 不用于回答该异步问题。
- 同步 requestUserInput 的既有 response.value 形状不修改，按 delivery/schema 分派校验。

### Codex 回传映射

1. 校验当前执行实例、会话代次、协议模式、interactionId、批次状态和到期时间，取得注册时冻结的 threadId/turnId/messageId/questions。
2. 在发送前原子地将批次标记为 submitting，阻止重复或并发提交。调用一次 `turn/steer`：threadId 和 expectedTurnId 取冻结值；clientUserMessageId 使用由 interactionId 派生的稳定 UUID。该 UUID 用于关联回显，不声明 Provider 幂等保障。
3. input 为一条 text 项，text_elements 为空数组。text 是固定前缀 `Answer to async user questions:\n` 加 JSON 对象，包含 messageId 和原顺序 answers；每项包含 questionId、原题 title 与用户 text。使用 JSON 序列化，题目与答案不解释为模板、命令或协议字段。
4. Runtime 仅接纳与本次 RPC 匹配的成功响应，并校验 response.turnId 等于原 turnId。然后发布唯一 `interaction.resolved`：status=resolved、outcome=answered、reasonCode=provider_accepted，公共 respond Promise 才可以成功。
5. resolved 在这里仅证明 Codex RPC 接受了输入，不证明落盘、模型已阅读、采用答案或任务成功。文档和宿主示例必须说明这一点；模型消费另以关联 userMessage 和后续实际模型行为验证。
6. 不通过 `turn/start`、thread/inject_items、普通新消息、自动 resume 或重新 invoke 代替失败的 steer；不切换账号、actmode 或 Provider 配置。

## 生命周期与失败合同

每批内部状态为 pending、submitting、resolved、cancelled、expired、invalidated；pending/submitting 都属于尚未发布最终交互结果的状态。提交中的按钮等待由 respond Promise 表达，不新增公共中间事件。

| 触发 | Provider 副作用与公共结果 |
| --- | --- |
| 合法 answered，收到匹配 steer 成功响应 | 一次 steer；发布 resolved/answered/provider_accepted |
| 本地答案校验失败 | 不发送；明确失败，保持 pending，可修改后重新提交 |
| submitting 时再次提交或取消 | 不发送第二次；拒绝为 INTERACTION_NOT_ACTIVE，不承诺撤回已发答案 |
| 已 resolved/cancelled/expired/invalidated 后再提交 | 不发送；明确 INTERACTION_NOT_ACTIVE，不返回伪成功 |
| 用户在 pending 时 outcome=cancelled，且无 value | 仅关闭本批提问；发布 resolved/cancelled/user_cancelled；不取消 Run、不伪造 Provider 确认 |
| 注册满 10 分钟，且仍 pending | 发布 expired/question_timeout；后续不可回答；Run 继续，不向同步请求路径发送拒绝包 |
| Provider 明确拒绝 steer | respond 失败；发布 invalidated/provider_rejected；不自动重试。保留安全原生错误诊断 |
| 写出前已知未发送 | respond 失败；若调用仍活动且未到期，恢复 pending，允许用户显式再提交 |
| 已发送但超时、断流或响应损坏，无法确认接受 | respond 返回 OPERATION_OUTCOME_UNKNOWN；发布 invalidated/submission_outcome_unknown；不重试、不显示已送达 |
| 发送前 turn 已结束、取消或丢失 | 不发送；发布 invalidated/run_terminal、run_cancelled 或 execution_lost；拒绝回答 |
| 提交与 turn/completed 竞争 | 以 Adapter 实际观察顺序处理；已观察到匹配成功响应则先 resolved，再执行终态；终态先到且未观察接纳则失效，已发送的结果标记未知，不以迟到响应改写为成功 |

过期计时在提交前检查；发送后使用已有有界 RPC 响应预算，不能在 submitting 时回到 pending 并允许第二次发送。每批最多一个公共交互终态事件，真实 Run 终态必须及时发布，不能等待用户回答。

错误需通过现有公共错误目录、Schema 与 worker/Kernel RPC 保留机器可判断的 code。复用已有 INTERACTION_NOT_ACTIVE 和 OPERATION_OUTCOME_UNKNOWN；实现时若发现内部错误文本未进入公共合同，修复相应路由，不能只靠错误文案匹配。不得为本次更改同步响应原有的成功含义。

### 连接恢复、会话恢复与重启

- 仅订阅断开、原 Kernel/worker/turn 仍存活时，按原 RunRef 和游标重放同一事件，可使用原有效交互提交；不重复注册或续期。超出源窗口仍按 STREAM_GAP/过期处理，不假装可以恢复完整表单状态。
- 公共 respond ACK 丢失仍遵循 OPERATION_OUTCOME_UNKNOWN；宿主可在原源流窗口查到已发布 resolved，但不得自动重交答案。
- Run 正常结束后，未答批次失效。宿主可显示历史问题，但不能继续调用原交互。用户愿意补充信息时，由宿主明确发起新的普通输入；本方案不自动转换。
- 显式 thread/resume 的新 invocation 不接管旧批次，不在新轮次重新激活历史问题；本轮新产生的问题仍可回答。
- Kernel 或 worker 重启使旧交互不可用；保留既有 instance/generation 校验。历史重放能展示问题不等于恢复 Provider 投递能力。

### 容量与隐私

最多 16 个在途交互，包含原有同步交互与新增异步批次；单批最多 50 题、每题最多 50 个选项；题目和选项各最多 4096 Unicode 码点。超限明确失败，不裁剪标题、选项或 ID 后继续开放回答。

为去重每 invocation 最多登记 1024 个不同异步批次；保留终态标识直到 invocation 清理，超限明确报告交互容量错误并按既有失败清理路径结束，不通过淘汰后重新激活旧问题。pending 正文在批次结束后释放，去重只保留身份及固定长度摘要。所有新增 Map、timer、RPC 等待在终态与 finally 清理，不新增磁盘历史。

普通日志只记必要身份、状态、数量及耗时，不记录题目、选项、答案或凭据。公共事件和 Provider 输入中的正文属于本次显式数据传递，不复制到诊断附件。

## 实施顺序与交付边界

1. 先在隔离的本地真实 Codex Default 轮次验证原生前提：异步 questions 通知确实到达、steer 接受、带关联 clientId 的 userMessage 可观察、模型确实收到带题目关联的答案。缺环境记录 blocked；原生路径失败不得把整项降为“只显示选项”后报告完成，应记录结果并回到规格审查。
2. 扩展 Protocol、Schema 及运行时校验，生成类型；新增的 delivery 省略语义保持同步路径。Run=7、Context=v3、Adapter transport=2 保持不变。若生成器输入影响 native SDK 产物，显式本地生成和校验，不扩大 CI。
3. 实现 Codex 映射、批次状态、steer 确认与清理；Core experience/watchdog 只针对 async 跳过阻塞等待；Kernel 保留原响应路由和错误事实。
4. 更新公共 SDK/Protocol 接入文档、就近中文核心注释和显式手动专项。接口示例必须只导入已发布主包公共入口。
5. 实现阶段按仓库流程使用 code-review，修复 Standards/Spec 问题并记录验证；是否提交、推送、PR 仍按后续用户授权执行。

不修改 Work App 或其上游子模块引用；不新增通用消息注入 API、持久化问题库、后台任务队列、跨 Run 回答、其他 Provider 异步实现、全局功能开关或自动切 Plan。真实 Work App 表单验收归宿主后续接入，本仓可用临时消费端验证公开结构，不能将其称为 Work App 已适配。

## 验收

专项文件放在 `test/manual/` 等不会被既有 `test/*.test.js` 默认 glob 自动纳入的位置，使用命令显式运行。新增 fixture 可供手动专项消费；不改 package.json 默认测试入口或开关来扩大 CI。既有回归范围按原命令运行。

| 编号 | 通过条件 | 证据与入口 |
| --- | --- | --- |
| A1 | 孤立 normalizer 与完整流均保留 delivery、多个题目、null/空选项及原生 messageId；started/completed 和重复通知只创建一批交互 | 新建显式手动专项；精确断言输出及调用次数 |
| A2 | 普通提问文字、delivery 缺省/null、空 questions 不创建交互；损坏/超限结构明确失败；相同身份冲突不静默覆盖 | 手动正反夹具；Schema 与运行时双重校验 |
| A3 | 单选/自定义、多题乱序提交正确回传；漏题/未知题/重复题/空白/超限答案在发送前拒绝 | 手动 adapter 和公共 Kernel/worker 往返夹具 |
| A4 | Provider 确认前 respond 不成功、resolved 不出现；确认后仅一次，错误 turnId 不成功 | 可控制响应时序的 fake app-server，计数 steer 与 turn/start |
| A5 | 并发提交/取消、已完成重复提交、明确拒绝、写前失败、写后超时/断流、过期、终态前后竞态全部符合生命周期表；无第二次 steer 或新 turn | 手动状态机夹具，测试时钟或可注入期限，核对终态及清理 |
| A6 | pending 异步问题存在时，模型/工具继续；watchdog 不获等待豁免，不生成阻塞 waiting_input；问题过期不让 Run 失败 | Core experience/watchdog 专项与真实持续工作的通知 |
| A7 | 原订阅重连可回放同一 ID；resume 新 invocation、worker/Kernel 重启、代次变化不能回答旧问题；ACK 丢失不重投 | 公共 Kernel API 手动集成夹具，保留实际错误码 |
| A8 | 同步 requestUserInput、approval、elicitation 及 ask/assisted/full_access 行为保持；native 原生载荷不丢失、不获得任意 steer 代理能力 | 既有 `node --test test/codex-app-server.test.js test/native-host.test.js`，构建后执行 |
| A9 | 真实 Codex 0.164.0 Default 模式经公共 canonical API 提出结构化问题，消费端按结构呈现；分别提交选项和自定义答案，取得匹配原轮次的接纳响应、关联 userMessage 和模型实际使用答案的证据 | 显式 non-gating 真实专项；绑定 SHA/dirty、版本、平台、命令、时间、终态和清理事实 |
| A10 | 类型、构建、lint、现有离线跨包回归通过；专项无 CI 自动接线 | `pnpm typecheck`、`pnpm lint`、`pnpm lint:names`、`pnpm test`；协议生成与 `native:check` 按影响执行 |
| A11 | 所有本地任务文档结构与链接正确；相对目标分支 workflow diff 为空，实际 PR checks 未增加 | `python3 .octospec/scripts/lint.py`、`git diff origin/main -- .github`；PR 阶段核对实际 checks |

A9 的结构呈现可以用本地临时消费端完成，不要求合入新的 UI 产品；真实 Work App 未验时单列未验。所有测试结果在实现阶段记录，不以本规格的完整性代替实测通过。

## 待审查决定与可执行性

以下边界已随“开始实现”获确认：

1. 原轮次结束后问题失效，不自动开启下一轮；代价是晚填的答案需要用户通过普通消息明确继续。
2. 每批题目整体提交一次，单题单文本答案；默认允许选择或自定义；取消仅关闭这批提问。
3. 以匹配 steer RPC 成功作为“Provider 已接受”的依据；不把它描述为模型已阅读，真实消费由 A9 单独验证。
4. 10 分钟有效期、16 个在途交互、50 题/50 选项/4096 码点和 1024 批次去重上限；前几项沿用或收敛当前交互边界，批次总数是新增容量选择。

原生前提已验证：0.164.0 上异步问答按该 steer 文本及 clientId 关联完成。此处记录前提证据，不代替公开 Runtime 的逐项验收。

规格可执行性自评 **95/100**，是文档与实施路径准备度，不是功能成功率。原生前提和产品边界已确认，实际完成度以 validation.md 为准。
