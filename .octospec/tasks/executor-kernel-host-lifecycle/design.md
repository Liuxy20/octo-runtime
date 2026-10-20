---
type: Design
title: Kernel、SDK 与 Extra 可实施接口合同
description: 固定本任务的接口、状态、容量、依赖代理和关闭时序，供实现与测试共同遵循。
tags: [architecture, protocol, lifecycle, ipc, extra]
timestamp: 2026-10-20T00:00:00Z
---

# 方案状态

本文是本任务选定的实施设计，不是已发布 API。变更设计须同步 [计划](plan.md)、
[验收](acceptance.md)和共享 fixture。M0 将这些声明落成 Schema、类型及合同测试，
不再把关键行为留给后续开发临场决定。与 #51 使用同一 wire 定义；Go client 不阻塞本仓实现。

## D1 包、入口与配置归属

| 位置 | 固定职责及公开方式 |
| --- | --- |
| `packages/octo-runtime-executor-kernel` | execution server、TS client、worker NDJSON、源流窗口和 worker 监督；不依赖 Extra 或 HostApp SDK。 |
| `packages/octo-runtime-host-sdk` | owned Kernel/Extra handle、组件启动、依赖代理和宿主生命周期；依赖 Kernel client、协议、通用清理，不反向依赖 CLI。 |
| 主包 `/executor-kernel` | 导出 attach/执行 client、serveWorker 和相关类型；独立服务由 Host SDK 启动；import 不启动服务。 |
| 主包 `/host` | 导出 Host SDK、owned handle、Extra runner/依赖描述类型；import 不安装或启停组件。 |
| 主包 `/executor-core`、`/extra`、`/protocol` | 保留现有公开路径；Extra 类型的实现位置迁移但公开类型和函数式入口保留。 |
| 内部 workspace 包 | 继续 private；单一 npm tgz 包含生产依赖、所有 runner 和完整声明。 |

准备好的执行配置由 Host 在启动 Kernel 时传入，复用当前 runtime/profile 到配置值的显式映射。
原 server 的配置值装配移到 Host；Kernel 将选定值交给同一 Core 解析。Kernel 不读取业务配置源，
不重新实现 defaults/mandatory 或 Context 渲染。Adapter module/manifest 仍由 worker 加载。

## D2 SDK 能力对象

以下为必须落地的最小声明；`InvokeInput`、`InvokeEnvironment`、`HostRunReceipt`、
`HostFrame`、交互及 Adapter 类型引用现有协议。新增 wire 类型从 Schema 生成。

```ts
type LookupKey = {
  run_id: string;
  invocation_id: string;
  agent_session_id: string;
  session_generation: number;
  protocol_mode: "native" | "canonical";
};
type RunRef = HostRunReceipt & { kernel_instance_id: string };
type RunSnapshot = {
  ref: RunRef;
  oldest_seq: number;
  latest_seq: number;
  terminal?: HostFrame;
};
type AcceptedRun = { ref: RunRef };
interface KernelClient {
  readonly topology: "kernel-ipc";
  readonly ownership: "attached";
  status(): Promise<KernelStatus>;
  list(): Promise<readonly HostedAdapterMetadata[]>;
  submit(input: InvokeInput, env?: InvokeEnvironment): Promise<AcceptedRun>;
  get(key: LookupKey, expectedInstance?: string): Promise<RunSnapshot>;
  subscribe(ref: RunRef, afterSeq: number, signal?: AbortSignal): AsyncIterable<HostFrame>;
  cancel(ref: RunRef, reason?: string): Promise<{ accepted: boolean }>;
  respond(ref: RunRef, response: InteractionResponse): Promise<void>;
  respondNative(ref: RunRef, response: NativeInteractionResponse): Promise<void>;
  close(): void;
}
type CleanupResult = {
  complete: boolean;
  processExited: boolean;
  pendingResources: readonly string[];
  errors: readonly { code: string; component: string }[];
};
interface OwnedKernel {
  readonly topology: "kernel-ipc";
  readonly ownership: "owned";
  readonly client: KernelClient;
  stop(reason?: string): Promise<CleanupResult>;
  restart(): Promise<KernelStatus>;
}
interface OwnedExtra {
  readonly name: string;
  readonly ownership: "owned";
  status(): Promise<ExtraProcessStatus>;
  stop(reason?: string): Promise<CleanupResult>;
}
```

工厂固定为 `attachKernel({ endpoint })`、`startOwnedKernel(options)` 和
`startExtra(options)`；direct 沿用公开 `AgentExecutor`，不新增同义执行类。
`KernelClient` 不含 stop/restart/install。`startOwnedKernel` 遇已被占用端点返回
`ENDPOINT_IN_USE`，不会静默 attach、接管或杀旧进程。重新配置 Extra 采用
`old.stop -> 检查 complete -> startExtra(最新完整配置)`，不增加原地 configure API。

Extra 注入的 `ctx.adapterHost.invoke/cancel/respondInteraction` 形状保留：SDK 适配器将 invoke
映射为 submit+subscribe，再用现有输出视图投影；不复制输入解析。适配器只管理该 Extra
接纳的 RunRef。client.close 不发 cancel；Extra.stop 则显式取消所属调用。

stop 的并发调用共享当前清理尝试，关闭接纳同步生效；complete=false 时仍保留 owner handle。
再次 stop 只观察未决清理，不重复调用已失败 finalizer 来制造 complete=true。
restart 只有在上次进程树退出已确认、资源冲突已排除时才启动新进程；错误保留原始原因。

## D3 公共 IPC 与执行身份

使用 UTF-8、每行一个 JSON-RPC 2.0 对象、LF 分隔；request id 固定非空字符串，长度不超过
128 UTF-8 字节。服务可同时接受多个连接，每连接承载一个请求及其响应/通知流，与当前连接模型一致。
不支持 batch。对象/数组/数值的合法性、未知可选扩展及 opaque native payload 沿协议规则校验。

| 方法 | params | result / notification |
| --- | --- | --- |
| `status` | `{}` | KernelStatus，含 `ipc_version:1`、实例 ID、Kernel/worker PID、worker generation/state。 |
| `adapter.list` | `{}` | 实际 Adapter metadata/probe 结果，不能推导已认证。 |
| `agent_run.invoke` | `{input, executionEnvOverrides?, kernel_instance_id?}` | `{kernel_instance_id, receipt}`；源流独立消费，事件通过 subscribe 读取；可选实例前提在接纳前校验。 |
| `agent_run.get` | `{key:LookupKey, kernel_instance_id?}` | `{ref:RunRef, oldest_seq, latest_seq, terminal?}`。 |
| `agent_run.subscribe` | `{ref:RunRef, after_seq}` | 同 get 的快照，随后 event/stream_error 通知；只续原执行。 |
| `agent_run.cancel` | `{ref:RunRef, reason?}` | `{accepted:boolean}`，不是执行终态或进程退出证明。 |
| `agent_run.respond` | `{ref:RunRef, response}` | `{}`，原生 responder 写入确认后返回。 |
| `agent_run.native.respond` | `{ref:RunRef, response}` | `{}`，检查 native 模式及原 pending request。 |

event 通知参数为 `{kernel_instance_id, run_id, stream_id, seq, event:HostFrame}`。
stream_error 为 `{kernel_instance_id, run_id, stream_id, code, requested_after_seq?, oldest_seq?, latest_seq?}`。
实例 ID 是 Kernel 每次启动产生的 UUID，worker generation 从 1 开始、每次替换加 1；两者仅是来源身份，
不是认证信息。receipt/HostFrame 继续沿用既有结构，不往 Run 7 或 Context v3 内塞入服务字段。

所有 ref 操作核对完整身份；get 在 ACK 未知时核对 LookupKey。错实例返回 `KERNEL_INSTANCE_CHANGED`，
错 Run 身份返回 `RUN_IDENTITY_MISMATCH`；runId 单独匹配不能授权取消/回答。
游标为安全整数且 `0 <= after_seq <= latest_seq`；窗口缺口 `STREAM_GAP`、源改变 `STREAM_EXPIRED`、
无记录 `RUN_NOT_AVAILABLE`，不把后三者误报成可恢复执行。

JSON-RPC parse/invalid request/method/params 使用标准错误码；业务错误使用 `-32001`，
`error.data={code, ...安全白名单测量}`，message 为固定脱敏文本，不透出 Provider 原文或配置。
新增稳定码包括 `KERNEL_UNAVAILABLE`、`KERNEL_INSTANCE_CHANGED`、`RUN_IDENTITY_MISMATCH`、
`ACCEPTANCE_UNKNOWN`、`OPERATION_OUTCOME_UNKNOWN`、`CLIENT_CLOSED`、`WORKER_RESTART_EXHAUSTED`；
现有 Run/stream/交互错误码复用，Schema 与校验器一起更新。

### 接纳、ACK 与修复

1. Kernel 在 Core 校验成功、首个身份帧可见后登记 receipt 和独立源流消费任务，随后返回 ACK。
2. 网络连接只能结束订阅，不持有源流消费 iterator 的生命周期；关闭 socket 不得 source.return。
3. client 在 submit 前取得实例 ID。ACK 丢失后，在同一实例上 get 原 LookupKey；成功则订阅原 stream。
4. get 无记录可能是尚在接纳，也可能是未接纳。最多 3 次查回，间隔 100/250/500 ms，共享 10 秒修复截止；届时无确定结果返回 ACCEPTANCE_UNKNOWN，不再次 invoke。
5. 已知 ref 的断流仅 subscribe；同样最多 3 次、10 秒总截止。任何身份变化、gap/expired 立即结束修复；连接拒绝报告 unavailable。
6. get/subscribe 返回已存在 terminal 且游标已等于 latest 时，正常结束且保留该终态快照；不能再等待新帧或重复交付旧帧。
7. submit 的 AbortSignal 是显式取消意图：接纳前标记 intent；ACK/查回后以完整 ref 发一次 cancel。不能用 socket close 代替 cancel；无法确认时保留 unknown。
8. cancel/respond 写入后丢 ACK 返回 OPERATION_OUTCOME_UNKNOWN，不自动重发修改操作。只读 get 可帮助查询，但不能把未知回答结果改写为成功。

查回仅提供有界证据，不保证 exactly-once 或 durable acceptance；Kernel 重启/记录过期后业务重试由调用方决定。

## D4 容量、超时与监督

| 边界 | 实施默认 / 硬限制 | 超限或截止行为 |
| --- | --- | --- |
| invoke 完整请求行 | 沿用 INVOKE_REQUEST_MAX_BYTES 32 MiB；换行前计 UTF-8 字节 | `INVOKE_REQUEST_TOO_LARGE`，拒绝本请求，不执行。 |
| 事件完整行 | 沿用 HOST_RPC_MAX_LINE_BYTES，不重新写一套常数 | `HOST_FRAME_TOO_LARGE`，本连接失败。 |
| Kernel 连接 / 同时订阅 | 64 / 现有全局 16；client 同时 pending 32 | 满额立即受控拒绝；不建等待队列。 |
| 单连接发送队列 | 最多 2 条、字节最多 2×HOST_RPC_MAX_LINE_BYTES（含未 drain 写入） | 停读源窗口并等 drain；持续 5 秒无 drain 关闭该订阅，Run 继续。 |
| client 接收队列 | 同上限，满后暂停 socket 读；每条消费后释放 | OS 背压传到服务端；超大单帧失败。 |
| 请求/初始 ACK | 连接 5 秒；普通请求/订阅 handshake 5 秒；submit 30 秒 | 绝对截止，不因零碎字节续期；超时不证明服务端操作未发生。 |
| 源流 | 现有 128 Run、4096 帧/32 MiB 每 Run、128 MiB 总量、TTL120秒、页32 | 继续使用中央受信 override 与硬最大值，不扩大为 durable 历史。 |
| worker 启动 / 探活 | readiness15秒；每1秒 ping，最后 pong 后5秒截止 | Kernel 正常获调度下最多6秒判阻塞；只检查 event loop，不检查模型输出。 |
| worker 控制通道 | 专用 Node IPC fd3，每 worker 最多1个未决 ping，单条4KiB | worker 主线程响应带序号 pong；不可放在能独自存活的后台线程中冒充主循环健康。 |
| worker 替换 | 每故障周期最多3次，间隔250/1000/4000ms；滚动60秒最多3次 | 存活稳定60秒才重置故障周期；耗尽 unavailable，owner 显式恢复。 |
| 受管进程强制关闭 | POSIX TERM400ms、KILL及确认200ms；Windows最多5秒 taskkill/后代确认预算 | 未确认退出 report incomplete，禁止启动冲突替代进程；原生平台验证不能跳过。 |

优先消费 liveness IPC，业务 stdio 保持 NDJSON；新 fd 不承载执行或业务 callback。
stop 必须 abort backoff/readiness，在迟到 spawn 成功时也回收新进程。Provider 失败仅影响对应 Run；
worker 失败使同代 worker 所有未终态 Run 以已有 Host control error+lost 结束，序号从 last+1 连续分配。
只对尚未终态的流写 lost；保留 Kernel 已接受的终态。Kernel 死亡时客户端只有连接失败证据，不能伪造旧流终态。

Kernel 自身恢复只由 Host/OS manager 实施。SDK owned 使用独立 parent control IPC；默认 parent
断开即有界停止其 owned Kernel。CLI foreground/OS 服务不依赖附加执行客户端存活；SDK 托管与
OS 服务管理互斥，不允许两个 supervisor 同时重启同一服务。stop 时先禁用本 owner 的恢复计划。

## D5 Extra 启动与动态依赖代理

`startExtra` 固定输入为 `{name, declaration:{module,enabled?,config}, endpoint, launch, dependencies?, scope}`。
launch 指定已安装 Node、runner、模块解析基准；scope 为宿主标签，不赋予新的 OS 安全隔离。
Host 持有函数，独立 Extra runner 通过父子 Node IPC 专用控制连接请求；业务配置经受保护启动文件传值，
不把凭据放 argv/env 或服务定义。IPC 控制连接只接纳确定的 method allowlist，不提供任意函数调用。

dependency 支持两种显式声明：`{kind:"proxy", methods:["loadContexts"]}` 或
`{kind:"module", entrypoint:绝对路径, exportName:字符串}`。前者绑定宿主函数；后者由 Extra
进程 import 自己的模块，不传递宿主闭包。无宿主在线的 OS 服务不能选 proxy，必须明确使用 module
或无依赖；启动时拒绝缺失依赖，不以启动快照兜底。

```ts
type DependencyCall = {
  type: "dependency.call";
  extra_instance_id: string;
  scope_epoch: number;
  call_id: string;
  method: "loadContexts";
  remaining_ms: number;
  config: JsonObject;
};
// reply: 同 identity + type:"dependency.result" + items:ContextItem[]
// error: 同 identity + type:"dependency.error" + code:固定错误码
// cancel: 同 identity + type:"dependency.cancel"；只发停止意图，不代表实际操作结束
// settle: 同 identity + type:"dependency.settled"；宿主真实操作结束后释放其占额
```

实例 ID 每次启动换新，scope_epoch 在账号/租户切换时增加；call_id 在实例内唯一，长度≤128字节。
两端校验全部 identity；旧结果只丢弃，不写入新代次。调用参数是对应 Bot 本轮配置副本，
动态返回先执行现有 bounded JSON 预检与 Context v3 校验，然后由 Channel 合并本轮静态项。
Kernel 不收到 call 消息，Context 不从历史补齐。

| 参数 | 固定合同 |
| --- | --- |
| timeout | 继承 context_loading.timeout_ms：默认5000ms，范围1..30000；从 Extra 本轮发起开始计时。remaining_ms 只向下扣减，各进程使用本地单调时钟，不传墙上时钟 deadline。 |
| 实际在途容量 | 每 Extra 默认8，范围1..32；Host 保留跨代次实际操作池，调用端 timeout/abort/断线不释放 Host 额度；满额 IM_CONTEXT_LOADING_BUSY，无等待队列。 |
| 配置/结果限制 | 启动配置继承现有1MiB限制；每次 call 最大1MiB+4KiB envelope；返回最多32项，完整 Context envelope≤65536字节，reply最大65536+4096字节。 |
| 队列 | 每条控制连接最多64条、2MiB排队；result 先校验再序列化；满额关闭该失败连接并中止关联等待，不静默丢答复。 |
| 错误 | 复用 IM_CONTEXT_LOADING_BUSY、IM_CONTEXT_LOADING_TIMEOUT、IM_CONTEXT_LOADING_CANCELLED、IM_CONTEXT_RESULT_INVALID、IM_CONTEXT_RESULT_TOO_LARGE；新增 DEPENDENCY_DISCONNECTED，固定脱敏码，不传宿主原异常。 |
| 迟到结束 | timeout/abort 后 Host 仍消费 Promise settle/reject；结果不再校验复制/进入模型。收到 settled 仅释放调用端 tombstone，不重新交付该轮结果。 |
| proxy 断开 | Extra 中止本轮准备并停止接受依赖型新工作；Host abort 对应操作但保留实际未结束占额；不得因新进程/新epoch重建空池绕过额度。 |

宿主底层 IO 不支持取消时可能永久占额；5秒关闭截止后返回 incomplete、阻止该 owner 新建同名
proxy Extra，直到实际操作结束或宿主进程退出。禁止谎称 Promise 被强制终止；同步函数仍可能阻塞宿主。

Host最多持有64个Extra名称记录，失败和未决清理也计数；每名称最多32个实际依赖操作，
全Host硬上限2048。调用端每实例最多32个未settle tombstone；额度耗尽直接BUSY。
重复result/settled不得二次释放额度；无对应call或错epoch的响应只丢弃并记脱敏诊断。

Extra.stop 时序固定：同步关准入 -> abort dependency/排队任务 -> 显式取消所属 Run ->
在统一5秒宽限内等待真实终态与尝试最终业务投递 -> 关闭业务连接与执行订阅 -> 等进程退出 ->
必要时按平台强制回收。5秒内各步骤共享同一绝对截止，不逐项重开5秒；强制回收预算另列。
单项失败仍尝试其他独立清理，聚合错误；最终投递失败不阻止进程回收，也不能被伪报为成功。

## D6 原生组件与状态

原生 launch 独立于 Extra JSON：`{kind:"native", executable:绝对路径, argv:string[], cwd:绝对路径,
configPath:绝对路径, endpoint, stop:{kind:"stdin-json"|"signal"}, readiness:{kind:"ipc"|"process"}}`。
shell=false，不替换 argv 占位符；配置路径和 endpoint 通过固定 `--config PATH --endpoint ADDRESS`
参数追加，禁止重复保留参数。凭据只在受保护配置内。
stdin-json 的停止消息为 `{type:"component.stop", request_id:string}`，默认等待5秒退出再强制回收；
signal 按平台能力显式选择。process readiness 只报告进程存活，executionReady 为 unknown。
ipc readiness 必须能连接公共 Kernel/组件约定端口并验证响应，status result.pid 必须等于本次新建子进程 PID，不能靠日志关键词或其他进程的端点响应判断。

spawn 后启动失败抛出 ComponentStartError，cause 为启动错误，cleanup 为包含进程、插件及依赖清理事实的 CleanupResult。Kernel/Extra 初始化期间预先观察 owner 退出和 stop，取消或归并异步启动后再清理，不允许晚到资源越过关闭边界。失败 Extra 名称和 Kernel 替换实例的回滚 incomplete 必须保留，processExited 不替代完整清理。

KernelStatus 至少包含 `{ipc_version:1, kernel_instance_id, pid, worker:{pid,generation,state,restart_attempt},
execution_ready:boolean}`；worker.state 为 starting/ready/restarting/failed/stopping/stopped。
Extra 状态分别提供 process、execution_connection、dependency_connection 和不透明 business JSON。
外部健康未知不能折算为 online；Kernel ready 不表示 Provider 已认证或任何 Run 成功。

## D8 旧 daemon 删除合同

旧apps/daemon、daemon workspace包及adapter-host传输壳在职责移走后删除；
不保留DaemonRuntime/createDaemonRuntime、octo-runtime-daemon bin、daemon CLI命令组，
不加转发、别名、运行降级或旧服务迁移工具。具体删除点见 [changes](changes.md)。
只保留执行语义与现有用户状态；新Kernel的服务/端点名称按changes生成。
源码改名不授权停止用户现存进程或删除其文件，规划阶段不执行任何部署清理。

## D7 仍需实证的限制

当前设计没有未知的核心接口选择；剩余验证点为真实 Windows task/pipe/后代确认、受背压探活时序、
明确消费者的回调迁移和真实业务投递时序。这些是实施风险，不记作已通过。
凡实测迫使修改合同，在本设计与 fixture 同时记录原因，不通过放宽验收隐藏问题。
