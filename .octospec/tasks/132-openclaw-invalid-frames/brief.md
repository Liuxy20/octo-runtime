---
type: Task
title: OpenClaw 无效帧记录日志后跳过
description: 在同一连接继续消费后续合法消息，保护在途请求与共享执行进程。
tags: [openclaw, adapter, protocol, testing]
---

# 目标

OpenClaw 发来 `null`，随后又发来正常结果时，本次任务应正常成功。收到无效帧只记录诊断并跳过，不能使宿主或共享 worker 崩溃，也不能因此断开连接或结束任务。

需求来源：[GitHub #132](https://github.com/Mininglamp-OSS/octo-runtime/issues/132)、Loop ORT-38，以及用户在本次会话确认的“收到 null 就忽略打印日志，后面只要正常就行”。该决定取代原 Issue 和分诊中的坏帧拒绝请求、关闭连接建议。异常原因未知，不能据此宣称网络故障。

## 基线与事实

- 规划基线：`origin/main@148d737d3ee14f0453ae5018c563b08d6b21ec5b`。
- Worktree：`/Users/lvsijia/github.com/Mininglamp-OSS/octo-runtime-ort-38`；分支：`triage/ort-38-openclaw-frames`。
- [gateway.ts](../../../packages/octo-runtime-adapter-openclaw/src/gateway.ts) 的 `#onMessage` 只捕获 JSON.parse 错误，`null` 在随后读取 type 时抛错。无法解析的 JSON 目前会 failPending 并关闭连接，此分支也需改为跳过。
- 分诊在 `3f2a810b` 的源码构建与真实 loopback WebSocket 上复现 null 子进程退出 1；正常 event/response 成功。该文件在规划基线未变化。此次规划未运行新实现或真实模型。
- [index.ts](../../../packages/octo-runtime-adapter-openclaw/src/index.ts) 的 invocation、probe、取消对账/恢复使用 Gateway client。每次调用持有自己的 WebSocket；Kernel 监督共享 worker，不能代替输入边界校验。

## 已确认决策

1. 无效输入采用日志加跳过策略，保持同一 socket、pending 和原超时；既不主动失败也不重发请求。
2. 此策略适用于握手前后、probe、执行及恢复连接。跳过无效输入不等于确认 Provider 成功。
3. 真正的 RPC 失败响应、socket error/close、取消及超时继续使用既有行为。
4. 用户先授权实现和本地验证，完成复审后进一步明确“更新代码提交PR合并进入main”，已授权同步主线、提交、推送、创建 PR 和合并；发布不在本次范围。
5. 新专项仅显式本地执行；不修改 workflows、jobs、矩阵、触发、必需检查、CI Gate 或默认测试入口。

## 接收与分发合同

每条 WebSocket 消息独立处理。先转换消息并解析为 unknown，再检查结构；仅在合法后访问字段或调用监听器。捕获范围覆盖消息转换/解析/结构校验，不能用一个 catch 吞掉后续业务回调错误。

| 输入 | 处理 |
| --- | --- |
| 不能解析的 JSON、转换失败 | 诊断并跳过本消息 |
| `null`、字符串、数字、布尔、数组 | 诊断并跳过 |
| 非数组对象但缺 type、type 非字符串、未知 type | 诊断并跳过 |
| type=event，event 不是非空字符串 | 诊断并跳过；不调用任何 listener |
| type=res，id 不是非空字符串，或 ok 不是 boolean | 诊断并跳过；即使 id 匹配 pending，也不访问/修改该 pending |
| 合法 event | 按现有顺序分发，payload 可以缺省或为任意 JSON 值 |
| 合法 res | 沿用 pending 匹配、中间回执、成功/失败处理；payload/error 的解释保持既有逻辑 |
| 合法 res 但 id 不在 pending | 保持既有忽略行为，不当作输入故障 |

只验证必要路由字段，不复制完整 OpenClaw Schema，不使用上游版本白名单；未知扩展字段允许保留。`ok:false` 是合法失败响应，不能跳过；error 缺失时仍由现有错误映射生成失败。hello/challenge 的具体业务结构仍由原握手逻辑处理；本需求不把结构合法但业务含义错误的握手响应改成成功。

无效帧不得执行 `#failPending`、socket.close/terminate、pending.delete、resolve/reject/onAccepted、取消或重建连接。不得清除、重建或延期原计时器，不作为 Provider 有效进度更新 watchdog。一个无效帧不影响同连接中其他 pending。

没有正常结果时，有限握手/RPC/Run 预算按原期限失败；显式 `timeoutMs:null` 仍表示该 RPC 没有自己的超时，等待后续结果、AbortSignal 或实际断连，不增加隐藏超时。正常 close/finally 仍负责清理，不保留额外定时器或队列。

## 日志合同与落点

复用 [RuntimeLog](../../../packages/octo-runtime-adapter-sdk/src/runtime-log.ts)，不新增日志服务、持久队列或协议事件。Gateway options 增加可选 `log?: RuntimeLog`；Adapter 工厂参考既有 DSH 的可选 log 注入方式。执行及其恢复连接优先使用 invocation context.log，缺省使用工厂 log；probe 使用工厂 log。直接创建 Gateway client 或未注入日志的场景，使用固定格式的 stderr 诊断，保证用户仍能看到；禁止写 stdout 污染 worker RPC。

- 级别 warn，固定事件 `openclaw.gateway.invalid_frame`。
- 仅记录 `adapter_type:openclaw`、固定 `reason_code` 与 `frame_count`，允许已有受控 invocation/run 身份；reason 使用 `invalid_json`、`invalid_message`、`invalid_shape`、`unknown_type`、`invalid_event`、`invalid_response`。
- 不记录原消息、任意 type/event/id 字符串、payload、endpoint、token、提示词、输出或解析器异常正文/stack。
- 每连接一个饱和计数器，前 10 条各记一次，此后每累计 100 条记一次总数；到安全整数上限后停止新增采样。固定单条 stderr 诊断不超过 512 字节，无计时器、无按内容 Map、无逐帧异步队列。恢复连接独立计数。
- 日志调用同步抛错或返回 rejected thenable 时隔离并观察 rejection，不影响接收、不改请求结果、不递归打印失败。日志不可用不承诺落盘成功。
- stderr 只在没有注入 sink 时使用；已注入 sink 失败后不另外创建旁路日志。宿主未启用文件日志时，仅承诺相应 sink 被调用或 stderr 写入被尝试。

## 实现步骤与范围

1. 在 Gateway 接收入口增加 unknown 解析、最小帧判定与固定原因分类；将现有 malformed JSON 的 failPending/close 改为诊断后 return。现有合法帧派发和 pending 生命周期保持原路径。
2. 在同文件增加小型计数/安全日志入口；在 Adapter 的 probe、主连接与恢复连接传入同一作用域的日志，沿用 RuntimeLog API，不修改共享日志字段白名单。核对全部 `clientFactory` 调用点。
3. 添加 `test/manual/openclaw-invalid-frames.test.mjs` 及必要独占 fixture，复用现有 loopback 握手形状。用真实 socket、子进程和真实 Kernel/worker 验证同一进程仍可工作；fixture 只运行本地假 Provider，不用账号或模型。
4. 按下列矩阵验证并执行 Standards/Spec 代码审查。修复问题后将实际版本、命令、结果与限制写入任务 validation、review 和 journal；实现时再增量更新 OpenClaw 规则，不提前宣称实现完成。

生产预计仅改 `packages/octo-runtime-adapter-openclaw/src/{gateway,index}.ts`。必要专项 fixture 放 `test/manual/` 或 `test-support/`，不加入现有默认 glob。文档放本任务目录及 OpenClaw 规则。

## 验收矩阵

| ID | 输入/操作 | 必须观察到的结果 |
| --- | --- | --- |
| A1 | 逐个发送 null、42、字符串、true、[]、{}、破损 JSON，随后合法 event 和 final res | 每个 case 同 socket、同 request.id 成功一次；日志原因正确；没有异常退出、额外请求或 close |
| A2 | 缺/错误 type、未知 type、缺/错误 event、缺/错误 id、缺/错误 ok | 不分发、不结算；后续合法帧正常；未知扩展字段不被误拒绝 |
| A3 | challenge 前及 connect pending 期间发送无效帧 | 原连接后续握手成功；超时预算不重置；只发送一次 connect |
| A4 | 两个 pending，并发送匹配其中 id 的非法 res | 两个请求都保留，后续各自合法结果各结算一次，中间 ACK 逻辑仍工作 |
| A5 | 持续无效消息且没有合法结果 | 仍在原有限预算失败，清理 timer/abort listener；socket 由既有所有者关闭 |
| A6 | RPC timeoutMs=null，先无效帧再正常结果；另一例显式 abort | 正常结果成功；取消例按既有行为取消，连接可完成其他 pending，无额外隐藏超时 |
| A7 | 合法 ok:false、真实 socket close/error | 失败原因与清理沿用现有行为；不能吞为输入噪声；无 unhandledRejection |
| A8 | 直接 client、Adapter probe、invoke 及一次恢复连接收到无效帧后正常 | 日志路由及作用域正确，返回真实探测/执行结果；无副作用重放 |
| A9 | 同一真实 worker 中 A 连接收到 null，B 在途且健康，再提交 C | A 后续正常完成，B/C 成功；Kernel instance 与 worker PID/generation 均不变 |
| A10 | 发送 1000 条无效帧，再发正常结果；sink 同步抛错/异步 reject | 采样恰好 20 次，每条仅安全元数据；无 uncaught/unhandled，正常结果成功 |
| A11 | 从独立子进程运行接收场景并捕获 stderr | 子进程正常退出 0；固定日志不含运行期生成的敏感 canary，不污染 stdout 协议 |

专项计时从真实握手/发出请求开始；可用假时钟验证“未重置期限”，同时保留真实 socket 路径。每例 finally 关闭 client、server 和所属 Kernel/worker，确认退出；cleanup 错误不能掩盖原失败。

### 实现阶段计划命令

```bash
pnpm build
pnpm exec tsc -p tsconfig.json --noEmit
pnpm lint
pnpm lint:names
node --test test/manual/openclaw-invalid-frames.test.mjs
node --test test/openclaw-gateway-client.test.js test/openclaw-compatibility.test.js test/openclaw-runtime-connection.test.js
python3 .octospec/scripts/lint.py
git diff --check
git diff origin/main -- .github package.json pnpm-lock.yaml
```

以上为原规划命令；实现后实际执行及结果见 [validation.md](validation.md)，审查见 [review.md](review.md)。专项新增入口不进入默认测试/CI；提交前另外核对实际必需检查列表。真实 OpenClaw/线上 IM、Windows/Linux、全量回归分别记录实际执行情况，不能用 loopback 结果代替。

## 范围外与风险

- 不做请求重试、重放、自动 reconnect、逐调用进程化或 Kernel 恢复重设计；现有实际断连恢复路径保持原合同。
- 不把“忽略坏帧”扩大为吞掉任意 listener/onAccepted 业务异常。分诊发现的回调异常逃逸是独立缺陷，实施中不能用 catch-all 伪造完成；如需修复须另列明确的失败合同。
- 无效帧一直到达时任务仍可能最终超时；这是预期，不宣称网络已恢复。关闭消息/超限等 ws 库传输错误仍可关闭连接。
- 原始消息解码/JSON.parse 的 CPU、ws maxPayload 和持续输入的传输成本仍沿用现有限制；本次只限制新增诊断开销，不宣称完整抗洪泛能力。

## 可执行性评估

规划自评 **96/100**，不是已实现或已验收评分。

| 维度 | 得分 | 依据/扣分 |
| --- | --- | --- |
| 需求与验收 | 20/20 | 用户例子、无效分类、合法失败及同连接继续均可观察 |
| 代码落点与边界 | 19/20 | 已确认入口与日志 API；具体 helper 命名待实施选择 |
| 状态与兼容 | 20/20 | pending、原期限、无限等待、扩展字段、恢复及失败路径明确 |
| 验证可执行性 | 19/20 | A1–A11 与命令明确；新 Kernel fixture 尚未实现 |
| 日志与交付 | 18/20 | sink、采样、隐私及 CI 边界明确；真实部署的日志可见性和跨平台结果需实施验收 |

阻塞性待决策点：无。规划经用户授权进入实施，当前实现及本地验证已完成，进入验证审查。规划评分不代表真实 Provider 或跨平台验收结果。
