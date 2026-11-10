---
type: Guide
title: DSH 298 原生证据与映射
description: 记录锁定的官方 rc.5 协议、延迟分类依据与跨仓消费边界。
tags: [adapter, canonical, stream]
---

# 版本与所有者

Runtime main `157fabb7d680df1ee72d9d9e5ed40cfc6c22b336`，官方 `@deepseek-ai/dsh-sdk-client@0.2.1-rc.5`，外部 Provider 仍按既有 `>=0.2.1-rc.4` 准入；此次未对所有未来版本作兼容保证。npm rc.5 的 dsh-session `lib/types/types.d.ts` 和 dsh-agent-loop `lib/index.js` 是本次精确核查依据。SDK archive integrity：`sha512-kDMYeV0Ar1F6cfg6FlZJrfV8LASZGdqr+BLnXxLdaMFeFFiPEdf02XzTKCOxeALTvLPCDmWg3buV2k5kkrVL1Q==`。

官方资料查询：Context7 `/deepseek-ai/deepseek-harness`，并核对[官方 SDK 通知定义](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/sdk/protocol/src/types.ts)及本次安装的版本化包。master 文档不替代锁定包内容。另核对 npm rc.4 的 agent-loop 发行 JS，关键顺序与 rc.5 一致。无真实模型事件样本；fixture 由以上 schema 和 loop 顺序构造。

独立 Gateway main `7c03559ffee9c8475b31e2ced4c30838d0f6d1b7`；`run-projector.ts`、`reasoning-frame.ts` 和 `ImRuntime` 拥有展示/投递。其生产依赖是公开 client `1.1.12`，未修改 Gateway 源码或加入 Runtime 依赖。

# 原生事实

| 原生事实 | canonical 映射 |
| --- | --- |
| session.event 带 sessionId、seq、time、data | 保留会话 lineage、身份与时间；旧序号忽略、冲突重复拒绝 |
| step/start 与 step/end 只有 turn/step | 不能声称原生提供了 finishReason |
| assistant/message 是一次模型调用的 commit，stream 中 text-chunks 保留 chunk 边界 | 校验正文与 legacy chunks、durable stream 的前缀；仅发布一份文本增量和唯一 messageId 生命周期 |
| 当前 rc.5 使用 durable commit stream；assistant/chunk 是保留的旧路径 | 旧路径也必须等 commit 对齐，不能先发 final 再撤回 |
| commit 先于 executeToolCalls；tool/call 的 callId 配对 tool/result 的 toolCallId | 当前步骤出现真实工具调用则派生 finishReason=tool-calls；工具失败保留 failed，不强行把成功处理失败的整轮改为 run.failed |
| turn/end.reason.kind 表达 turn 结果，session/wait 只表达活动 idle | receipt、最后 root durable terminal 和无活动工作共同确认；不把某一次 turn/end 当整次调用已完成 |
| 一个活动区间可有多个 turn | 后续 root step/turn 使上一候选成为 commentary；最后合格 root commit 才是 final |
| 子会话始终独立 | child 公开文字只为 commentary，analysis 维持 private_reasoning，绝不拼入 root final |

`subagent.finished` 结束的是一次运行，不是 durable child 会话。rc.4/rc.5 的 SDK server 将 session/created 转为 started；rc.5 AgentLoop 的 create 与 cold resume 都会 announce session，因此相同 childId 可再次合法 started。底层 subagent 有不同 runId，但 SDK 没有透传，两个合法运行的 started/finished 载荷可以完全相同。

Adapter 以这些原生运行边界配对 canonical 活动：活动期间的重复 started 忽略；finished 只结算一次，后续无新 started 的迟到 session.event 不进入工作状态；再次 started 为同一 durable session 建立新活动代次。代次只提供 canonical 唯一身份，不冒充原生 runId；会话 seq/digest 和 lineage 保留，重挂载仍使用既有对象预算。不按载荷相同永久屏蔽 child，也不额外要求 turn/start 作为恢复前提。SDK 缺少 activation 身份时，不能判断跨新 started 边界的相同 finished 是否为旧运行重放；不声称修复协议本身无法区分的情况。

# 延迟分类与边界

根会话尚未确定用途的 create/delta/update 最多暂存 4096 条，正文最多本 invocation 的 rawMessageMaxBytes；只保留一个候选步骤。工具到来先发其前的 commentary，再发 tool_call；后续步骤/turn 先结算旧候选，再开始新步骤。只有成功 finish 才按原 chunk 边界发布 final，保留原 messageId；延后的 model_step.finished 仍携带原生 endedAtMs。

因此纯最终回答的正文会延迟到活动终局确认；无原生分类字段时不承诺实时 final 流。中途取消、错误、max-tokens、缺 receipt、未闭合工作、空回答、仅工具说明均不能成功发布 final。工具直接 concluded 整轮但没有后续无工具回答时，当前保守返回 DSH_NO_FINAL_OUTPUT，避免把工具前说明当最终回复；这是明确的可用性限制，不能靠正文猜测解除。

未确认的候选不做撤回或后改通道；最终发布一次，不让 Gateway 学习 DSH 私有协议。缓冲属于 Runtime 投影预算，不代表官方 SDK 在 JSON 解析前、stderr、后代进程或所有 lineage 上已有相同资源保证。

# 验证边界

手动专项：`node --test test/manual/dsh-semantics-298.test.mjs`；设置 `OCTO_GATEWAY_CHECKOUT` 后启用独立消费者链路。`OCTO_DSH_EVIDENCE` 指定仓库外证据 JSON。测试中的私有 reasoning 均为明确的合成哨兵，不使用真实私有轨迹。

链路使用未修改的官方 SDK 启动协议 fixture，经真实 Adapter/Core 产生 canonical，再走真实 projector、buildReasoningFrame 与 ImRuntime 的 replyFinal 调度；连接器与发送端口为 fixture。它证明应用终局选择及一次发送调用，不证明 IM 服务端投递或真实 DSH 模型可用。
