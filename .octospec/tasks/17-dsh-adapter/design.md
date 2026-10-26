---
type: Task
title: DSH SDK 版本合同、映射与故障验收
description: 固定 0.2.1-rc.3 的 stdio Client、原生事件及资源边界。
tags: [dsh, adapter, protocol, lifecycle]
timestamp: 2026-10-24T00:00:00Z
---

# 版本与 composition root

> 2026-10-25：本文为 #173 历史设计，用户已否决自实现 Client。当前方案见[官方 Client 接入](../17-dsh-official-client/brief.md)，不继续执行本页的自实现决定。

Desktop `0.2.1-rc.3` / 内嵌 `@deepseek-ai/dsh@0.2.1-rc.3`，commit `be72761ee1a6736ebcdf4f3739363b083ae53c98`。核对 npm `@deepseek-ai/dsh-sdk-client@0.2.1-rc.3` 的 client/api 类型和实现，以及 Desktop 内嵌 dsh-sdk-jsonrpc-server、dsh-agent-loop、dsh-base 源码。最新 master 的 approvalRequests 不能套用到本版。

默认优先 PATH dsh；macOS PATH 缺失时检查 `/Applications/DeepSeek Harness.app`。显式 desktopPath 选择另一安装位置，command 选择已安装 CLI。Desktop 用其 Electron 的 ELECTRON_RUN_AS_NODE 加内嵌 CLI 路径启动，保持其 asar/native modules 解析。此变量只在本次子进程设置。启动前有界检查 --version；只接受已核对版本。SDK/CLI 通过同一 adapter，公开主包 `/adapters/dsh` 导出；CLI 内置 manifest 选用 dshAdapter。

每 invocation 新建 DshClient 及独立进程组。并行会话从不共用进程；同 adapter 实例持有的 Provider ID 同时只允许一个调用。进程关闭先尝试 shutdown（有界），再沿 Runtime 现有 TERM/KILL 进程组/Windows taskkill 路径确认退出。保留 cleanup 错误，不将未确认回收报成功。Windows leader 已退出的后代可观测性沿既有 SDK 限制，不声明原生 Windows 已通过。

模型 provider 默认 deepseek-account（Desktop 登录）；model 默认 deepseek-flash；可选 deepseek-official/API key 路径由宿主选定。profile 默认 sdk、Home 默认 DSH 原值。full_access 固定原生 danger-full-access；ask/assisted 不启动。sandbox 显式冲突拒绝；非默认 actmode 拒绝。可信 controlInstructions 仅新 session 以独立 text block 补入 user 消息，明确非原生 system；普通业务上下文每轮传入。环境按 invocationEnvironment 合并，不改 process.env。

# 原生数据表

JSON-RPC 2.0 一行一个对象，数值 requestId 有界增长，最多 16 pending。原生行、输出队列沿本 invocation StreamLimitPolicy；整轮预算沿 Core 并增加有界 client deadline，启动/请求/退出各有独立预算。拒绝无效必需 envelope；可选未知 notification 忽略。该版 deepseek-account 会向 stdout 写 `[llm-deepseek-account]` catalog info，Client 仅丢弃有界的已知单行前缀，其余非 JSON stdout 视为协议失败；不记录该行正文。

| 原生来源 | 关联/次序 | Canonical 输出 / 省略 |
| --- | --- | --- |
| initialize result.serverInfo | 校验 name 和 wire version | 不制造完成，执行配置不进入模型 |
| session/prompt result.messageId | 与 agent/inbox/spliced.inserted[].id 核对 | 仅接纳，终态前必须看见对应 durable receipt |
| session/resume | 只传原 providerSession.sessionId；恢复后通过 session/working-directory/set 应用本轮目录，再发 prompt | session.update resumeOutcome=resumed；不存在/占用/错误返回 DSH_SESSION_RESUME_FAILED，不 fresh fallback |
| session.event {sessionId,event:{type,seq,time,data}} | root/已发现 descendants；每 session 单调 seq，重复末序号同内容忽略、冲突失败、较老迟到忽略 | sessionId/turn/step 保留于开放 payload；foreign session 忽略；最多 128 个 scoped sessions |
| turn/start | data.turn；原生时间 | activity.started working；不当成 Run 接纳 |
| step/start、step/end | sessionId+turn+step | model_step.started/finished；end 本身无模型失败依据，不凭空推断 stop reason |
| assistant/message | data.message.id/content、data.stream compact records | message.create/delta/update；有 stream 时按 text-chunks 重放并与 committed text 对账，快照只补遗漏尾部；分歧失败，禁止叠加重复文本 |
| assistant/chunk | 历史兼容样例，不作为当前版本实时能力证据 | text delta 需 turn+step，与 committed snapshot 对账；reasoning 从 committed message 取出，标记 analysis/private_reasoning 并记录 provenance |
| assistant/attempt | 没有 committed answer | 不当最终回答，终态按 turn/end 判定 |
| tool/call | data.callId/name/arguments，turn/step | tool_call.create，arguments 从原生 JSON 字符串解析为结构化 args |
| tool/result | data.message.toolCallId/content/isError，原生时间 | tool_call.update completed/failed；单工具失败不使 Run 失败；不把原始错误正文写日志 |
| subagent.started/finished | parentSessionId/childSessionId，先登记 lineage | child activity；子消息含 providerSessionId/parentSessionId，使用 commentary，不进入 root final；结束状态沿原生事实 |
| assistant/message data.usage | 仅已提供的数值 | usage.update，使用原生 input/output token 字段，不估算 |
| turn/end reason.kind | completed/error/aborted/max-tokens | root 最后有效 terminal evidence；completed 还需 receipt、非空 committed answer、wait 成功；error/max-tokens 为失败；aborted 为取消 |
| session.status idle | 仅状态提示 | 不独立判完成；session/wait result 在所有通知之后，才收束队列 |
| permission/preset、sandbox/mode、approval/policy、request/*、session/title 等 | 当前版本可选元数据 | 不把配置/系统 prompt 或整段轨迹发卡片，不制造额外工作事件 |

状态只保留每 session 最后序号/摘要、活动 turn/step/tool/message 和当前消息字节。消息提交后释放文本缓存；上限按每 Run 4096 个对象和 stream policy 检查，不永久保存轨迹或重新构造历史。

# 错误合同

全部失败不自动重跑模型/工具。Adapter 原始 message 含稳定 DSH code 和固定安全英文说明；native 数值/枚举 code、phase、requestId、exitCode、signal 单独保留，不带远端 error.message/data、stderr、prompt、工具正文或凭据。Core 沿既有 failurePayload/classifier 与结构化日志接线，DSH code 保留于 failure.reasonCode；一般用户卡片展示公共 OH code 和公共目录说明，默认 Core 日志保留公共 code 和 reason_code。容量超限保留共同 PROVIDER_MESSAGE_TOO_LARGE / STREAM_QUEUE_* 原因，不被清理的后续错误覆盖。

| Code | 触发 | 重试与不确定性 |
| --- | --- | --- |
| DSH_EXECUTABLE_NOT_FOUND | 没有 CLI/Desktop | 未执行；宿主安装/选择依赖 |
| DSH_VERSION_UNSUPPORTED | 安装版本不在已核对版本集合，或 wire identity 不符 | 未发模型输入；选择兼容版本 |
| DSH_START_FAILED / DSH_INITIALIZE_TIMEOUT | spawn/握手失败或启动超时 | 不重发；初始化阶段 |
| DSH_RPC_ERROR | 有效原生 error response | 保留 numeric nativeCode、方法/requestId；prompt 结果未知时不能重跑 |
| DSH_REQUEST_TIMEOUT / DSH_TRANSPORT_CLOSED | deadline/EOF/非预期 exit | 输入可能已执行，关闭拥有进程，不重发 |
| DSH_PROTOCOL_ERROR / DSH_TRAJECTORY_INVALID | 必需 JSON-RPC/事件字段或因果缺失 | 停止拥有工作并报告，不伪造成功 |
| DSH_SESSION_RESUME_FAILED | 原生 resume 失败 | 未发新 prompt；原 session 不替换 |
| DSH_EXECUTION_FAILED / DSH_NO_FINAL_OUTPUT | 原生错误/达到 token 限制/缺少已提交回答 | 保留 nativeCode，不把工具失败一概升格 |
| APPROVAL_MODE_UNSUPPORTED / ACTMODE_UNSUPPORTED / MCP_UNSUPPORTED | 当前原生 transport 不能应用显式请求 | 启动前拒绝；不得自动批准 |
| DSH_CANCEL_FAILED / DSH_CLEANUP_FAILED | 关闭拥有进程/确认回收失败 | 保留 primaryCode+cleanupCode；不能发 completed/cancelled |

日志复用 RuntimeLog，Core 通过可选 AdapterInvocationContext.log 注入既有 sink，独立调用的适配器工厂也允许注入同一 log；默认 Core 仍写本次 failure/finish。时间、run/session/invocation/request/phase 和 PID/exit 纳入有界诊断，禁止并行日志系统。RuntimeLogging 白名单仅接纳安全编号、数值/枚举原因和阶段，不接纳远端正文。

# 实施顺序

1. 原生入口发现、有界 JSON-RPC Client 和稳定错误。
2. trajectory normalizer、adapter 请求/恢复/取消、公开 SDK/CLI 接线。
3. deterministic fixture 及真实 KernelClient/Desktop 调用、工具与取消/恢复。
4. SDK/CLI Gateway 测试与发行包测试；verified-review 逐文件、过滤和执行；修复后重验。
5. 将实际结果写 journal/验收表，英文提交和 PR，等待托管必需检查后合并。
