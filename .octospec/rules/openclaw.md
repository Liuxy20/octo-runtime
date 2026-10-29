---
type: Rule
title: OpenClaw 连接与执行合同
description: profile 连接、已有 Agent、原生工作区及目标解析。
tags: ["openclaw","adapter","workspace"]
timestamp: 2026-10-22T00:00:00Z
implementation_baseline: df63c8f
id: runtime-openclaw
tier: repo
priority: 90
load_bearing: true
inject_when:
  paths: ["packages/octo-runtime-adapter-openclaw/**","packages/octo-runtime-executor-core/src/invoke-input.ts","apps/cli/**","test/openclaw-*"]
  touches: ["openclaw","adapter","workspace"]
source: self
supersedes: []
---

# Runtime 与 OpenClaw 连接统一合同

本文说明当前连接配置、Provider 目标与执行边界。Run=7、Context=v3 保持独立。

本地身份与云端登记独立，见 [Runtime 合同](runtime-lifecycle.md)。OpenClaw 的认证 Gateway 连接是 Provider 执行依赖，与 Worker 设备在线或 IM 频道连接是不同链路。

## 概念定义

| 概念 | 定义与归属 |
| --- | --- |
| 本地 Runtime | 本地初始化即存在的执行对象，以稳定 `runtime_id` 标识；注册与远程寻址可选。一个 Runtime 对应 Runtime Home 中的一个 profile；多个 Runtime 可以共用本地控制服务和 Adapter Host。 |
| Provider Runtime | 实际执行任务的引擎或服务。OpenClaw、Codex 等处于同一执行层；Provider 可以由进程启动，也可以通过认证连接访问。 |
| Provider 类型 | 标识执行实现，例如 `openclaw`。当前协议沿用 `adapter_type` / `provider_type`；本次不新增含义重复的 `provider_id`。每个 本地 Runtime 对每个 Provider 类型保存一份连接配置。 |
| Adapter | 把 Provider 的执行协议转换成统一 Host 事件的实现。OpenClaw 使用认证 WebSocket Gateway RPC，不使用 SSE。 |
| Provider 连接配置 | 属于 本地 Runtime 的本地信息，包括连接来源、地址、凭据引用和设备身份。由本地宿主管理，不属于 Agent 定义或模型上下文。 |
| 目标 Agent | Provider 内的执行目标，由 Context 的 `provider_agent_id` 指定。多个 Agent 可共享一个 Runtime 的同一连接。 |
| Agent 来源 | `preset` 表示调用已有 Agent；`provisioned` 表示按该来源合同执行。来源与传输方式、连接配置相互独立；来源声明不意味着 Runtime 可以隐式安装 Runtime 或创建 OpenClaw Agent。 |

Runtime 的安装决策继续归 HostApp。OpenClaw Agent 的人格、记忆、插件和原生 workspace 继续归 OpenClaw 管理。

## 本地初始化与连接配置

1. SDK 在本地初始化 Runtime 并保存身份，不要求 Worker 注册。CLI 的 executor-kernel run 按需准备本地连接配置，不提供 login 命令；当前 Worker 接入包已移除。
2. CLI 启动编排初始化或刷新该 Runtime 的 OpenClaw 连接，探测 Gateway 可用性。SDK 由宿主显式配置连接，不自动发现。OpenClaw 缺失、未启动或认证失败只影响该 Provider 的可用状态，不阻止本地 Host 就绪或其他 Provider 执行。
3. 本地配置保存到 `<runtime-home>/<profile>/adapters/openclaw/connection.json`。内置 Runtime 使用账户目录下对应的 profile，不能退回另一账户或默认 Home 的连接。
4. 本地探测和实际执行读取同一 Runtime 配置。外部业务若报告可用状态，不得上报 Gateway token 或私钥；本地探测本身不需要云端上报。

CLI 支持两种连接来源，执行层只消费解析后的 `gateway` 快照：

- OpenClaw Home：CLI 读取 `openclaw.json`，解析 URL/token，配置未指定端口时使用 `18789`。默认目录为 `~/.openclaw`，首次发现时通过 OPENCLAW_HOME 指定。CLI 将来源绝对路径和对应快照凭据引用保存在同目录的 `cli-source.json`；它不含 token。CLI executor-kernel 的统一启动编排重新读取该来源并保存新快照；playboard 启动临时 Kernel 复用同一编排，不自行刷新。因此端口或 token 轮换后，重启 executor-kernel 或重新运行 playboard 即可生效。单纯端口可连接不作为 OpenClaw 可用证据。
- `gateway`：保存显式 `ws://` / `wss://` 地址与本地凭据引用。token 通过 stdin 或 `OPENCLAW_GATEWAY_TOKEN` 提供，存入该 profile 的 `credentials` 目录。非回环地址必须使用 `wss://`。

显式命令参数优先。无显式参数时刷新已保存的 Home 来源，或复用显式 Gateway；没有已保存连接才读取环境变量或默认目录。`OPENCLAW_GATEWAY_URL` 与 `OPENCLAW_GATEWAY_TOKEN` 必须成对提供，不能与 OpenClaw Home 同时配置。显式来源不可用不得改用默认实例。Home 刷新失败时，该次 CLI executor-kernel 启动禁用此 Provider 配置，不使用旧快照。

SDK 不读取 OpenClaw 配置或进程环境、不扫描端口。宿主可调用 `configureOpenClawConnection(profileRoot, {url, token})` 显式保存连接并初始化设备身份，也可直接通过 `providerOptions` 提供 URL/token 和设备身份。`loadLocalOpenClawGateway`、`resolveOpenClawGateway`、probe 和 invoke 只读取已配置数据；连接或设备身份缺失返回明确错误，不发现、不首次落盘、不自动修复。CLI 与 SDK 共用 URL 校验、设备身份校验、认证握手、能力探测及执行路径。

`connection.json` 仅保存 `schema_version: 1`、`source: gateway`、`gateway_url` 和 `credential_ref`。旧 `source: home` 描述不自动转换；由宿主通过 SDK 显式重新配置。`cli-source.json` 的凭据引用只用于确认来源仍对应当前快照；SDK 或 CLI 改为显式 URL/token 后，不再刷新先前的 Home 来源。

凭据文件以 `0600` 创建，设备身份由显式配置操作初始化并保存到该 profile 的 `credentials/openclaw-device.json`。刷新地址/token 时先写入新凭据，再原子替换连接描述，避免并发调用读到新地址与旧 token 的组合。设备身份保持稳定。既有调用继续使用已经解析的连接，新探测和调用读取新快照。启动、注册及探测不得重置 Gateway token，不自动改写 OpenClaw 配置。

## 统一执行合同

### Octo CLI 工具环境的 CLI 预配置

仅针对 channel-gateway 使用 octo-cli，CLI executor-kernel 启动编排按渠道配置更新已定位 OpenClaw 实例的全局 `.env`，写入 `OCTO_BOT_TOKEN` 和去掉末尾 `/api` 的 `OCTO_API_BASE_URL`。这是对既有“CLI 不改写 Provider 配置”要求的明确例外，限于这两个环境变量，不修改 `openclaw.json`、Gateway 认证、设备身份或其他凭据。详见 [渠道方案](../tasks/channel-octo-cli-environment/brief.md)。

目录解析复用当前 CLI 来源与实例选择；`openclaw config file --json` 可用于确认实际配置文件。全局 dotenv 的位置按该实例 state dir 确定；配置文件父目录与 state dir 相同时写同目录 `.env`，两者不同时写实际加载的 state dir，不能仅按文件名猜测。仅有远程 Gateway 地址时，不得写本机默认目录冒充远端配置。

同一 `.env` 按配置处理顺序后写覆盖前写；不同目录独立处理。CLI 保留其他变量及注释，幂等更新两项，以 `0600` 权限原子保存，输出不含值。Gateway 重启由人工处理，不自动重启或声称热生效。官方加载规则通常不覆盖进程已存在的同名值，因此写盘成功和实际加载成功分别报告；人工重启后以工具实际请求核验。

该文件属于实例共享环境，所有继承该环境的 Agent/工具使用最后写入的身份，不提供多 Bot 按轮隔离。OpenClaw Gateway 的每轮 Context envs 仍按现有不支持合同处理；CLI 落盘不是对该协议能力的实现，也不将这两个变量回填到 Context 或每轮执行覆盖。

```text
业务方提交 Context（Provider 类型 + provider_agent_id）
  → 本地 SDK 或业务扩展提交共享 Host
  → Runtime 读取自己 profile 的 Provider 连接配置
  → Adapter 建立认证连接、验证目标 Agent、发起执行
  → 统一 Host 事件、审批、取消和终态回传
```

目标引用示例：

```json
{
  "schema": "octo.context-envelope/v3",
  "items": [{
    "namespace": "octo.execution",
    "name": "adapter",
    "payload": { "type": "openclaw", "provider_agent_id": "researcher" }
  }]
}
```

`provider_agent_id` 随执行计划解析和冻结，不进入模型提示词。本地连接配置不得设置或覆盖目标 Agent。Gateway 探测检查协议与公开执行能力，不要求存在名为 `main` 的 Agent；执行时验证本轮指定的目标。目标缺失必须明确失败，不切换到其他 Agent。

统一执行接口不表示各 Provider 能力相同。OpenClaw Adapter 声明 `metadata.workspace: false`，忽略 `octo.execution/workspace` 和 `workdir`，不检查或创建本地工作区、不分配随机目录、不覆盖目标 Agent 的原生工作区。本地调用不增加 Worker 回执门槛。Context 快照不改写，审批模式、环境变量和恢复等能力按实际支持范围校验。业务上下文由每轮发起方决定，显式重复照常传递，不自动补齐、缓存或追加。

## 远端产物交付：P2 待办

2026-10-29 用户明确：远端 OpenClaw 场景较少，按 **P2 暂缓实施**，覆盖此前的 P0 提议；不改变 Issue #234 的 P0 级别。此节是后续架构约束，当前仅保留 TODO，不表示已支持远端附件转换。

- 后续由 OpenClaw Adapter 解析连接 URL 的 `hostname`，完整匹配 `127.0.0.1`、`localhost`、`0.0.0.0` 时按本地产物处理，其他 hostname 按远端处理。不能用字符串包含匹配，不能用 `agentSource` 或 WS 传输推断位置。此产物判定约定不改变现有 URL 校验、TLS 或认证要求，尤其不表示当前已放开 `ws://0.0.0.0`。
- 本地绝对路径 Markdown 引用继续交给 Gateway 按实际文件系统与交付限制读取。远端执行返回的文件引用由 Adapter 协调远端访问或上传，转换成 Gateway 可读取的 HTTPS 资源后输出；远端绝对路径不得误读 Gateway 本机同名文件。
- Adapter 不调用 IM 业务接口；Gateway 继续负责交付限制、附件上传、链接改写、文件卡、去重、取消及失败反馈。远端资源如何被 Gateway 拉取并交付也属本项待办，不能把普通网页链接都当成附件。
- 远端文件 API、URL 有效期及访问方式需在实施前核实。提示词可说明输出约定，但不能代替确定性的转换与验证；IPv6、代理/隧道、容器及共享目录映射另行确认，不扩充本次用户指定的 hostname 规则。

两个 TODO 槽位位于 [Adapter](../../packages/octo-runtime-adapter-openclaw/src/index.ts) 的连接参数解析处和最终消息出口。待办与验收边界见 [Issue #243 记录](../tasks/234-context-lifecycle/remote-artifact-backlog.md)。本次不新增配置、协议字段或运行时分支，不删除 `agentSource`。

## Gateway 版本与会话权限

probe、invocation 和取消／断线对账新连接共用 Adapter 内部合同解析器，以真实 hello 的协议号、server.version、必要方法及事件交叉判定。当前精确表为已核对的 2026.6.11，加 2026.7.1 至 2026.10.5 的 26 个正式标签，共 27 个，包含维护后缀；不按版本大小推测中间未列版本、beta、fork、未知补丁或未来版本。probe 只检查基础调用合同和只读 agents.list，不保证特定目标 Agent 或请求权限；invocation 每次重新判定，不依赖旧 probe 缓存。

创建参数在实际握手后生成。6.11 和 7.x 仅发送 key/agentId/可选 model，在本次隔离会话 patch full/off 并确认 key 与保存字段后执行；不能发送新版创建 permissionMode/idempotencyKey/thinkingLevel。8.x 起使用原生会话权限创建字段，不能调用已退休的旧权限 patch。所有版本保留执行 agent.idempotencyKey、thinking、model、可信系统指令和 deliver:false。创建、patch、接纳状态未知时，不删除字段循环重试、不重建会话或重发 agent；普通 INVALID_REQUEST 不表示无副作用的可重试信号。

权限按业务意图兼容：可用的新版 ask 使用 guarded，ask 通道／授权不可用时直接采用已授权的 full_access；旧版会话参数无法确认人工 reviewer，当前按此原因回退 full/off。回退通过一次 run.notice/provider_diagnostic 告知实际版本、requested、effective 和原因；不额外询问、不改原请求／Context hash，审批桥单独按 effective full 处理本次 allow-once。full 不代表绕过宿主禁止、sandbox 或 harness 限制，不改全局策略；全部已知权限路径不可用时返回真实错误。assisted 仍不支持。

终态同时核对 status、endedAt、stopReason、aborted 和超时归因；正常成功的 stop 不是取消，rpc/stop 的非成功回执和 restart 才按取消处理。等待超时不等于执行结束，pendingError 不作为终态；执行超时、blocked/abandoned 不报成功。取消桥与执行循环共用一次 abort/对账，确认后关闭连接。断线对账只读已有执行，按实际完成／失败／取消返回，不重跑任务。

RPC expectFinal、终态归一化和 wait 共用中间回执判定：accepted／queued／in_flight／pending／running 及 pendingError 保留原请求，不能提前丢弃最终答案或 usage。并发对账先返回局部结果，再仅填充未知终态；旧 wait 或主动关闭造成的错误不能覆盖已确认取消。断线恢复仍须发布已开始模型步骤的匹配结束事件。确认终态后忽略迟到广播；确认前发生的队列容量失败保留原始异常，并在对账返回和正常出口阻止成功收尾。真实 transport cleanup 错误仍须传播，不能因已知执行终态而吞掉。

上述为代码合同与自动化验证范围，不能代替各 Gateway、reviewer／harness 和 IM 的真实验收。源码及逐标签证据见[Issue 40 实施记录](../tasks/40-openclaw-compatibility/implementation.md)。

## 操作入口

CLI 不再提供 adapter connect；宿主使用既有 SDK 连接配置接口。CLI executor-kernel 启动时复用已保存连接，首次发现可通过 OPENCLAW_HOME 或成对的 OPENCLAW_GATEWAY_URL / OPENCLAW_GATEWAY_TOKEN 环境变量指定来源。已有身份与连接不自动重置，旧格式由宿主显式迁移。

```sh
octo-runtime --home /path/to/runtime --profile work adapter probe openclaw
```

本地 Home 无需登录即可使用。adapter list、adapter probe 使用选定 profile 的已保存连接，刷新发生在 CLI executor-kernel 启动编排；playboard 通过临时 Kernel 复用该编排，跳过渠道 Extra 加载及渠道工具 dotenv 同步，不自行启动 Gateway。目标 Agent 放在 Context 中。


## 目标省略的当前实现

严格 Context adapter 校验和 OpenClaw Adapter 要求目标 Agent。统一公共输入解析在 OpenClaw adapter item 省略 `provider_agent_id` 时补入 `main`；这是当前输入入口的执行默认值，不是本地连接配置自动覆盖目标。需要确定目标的业务方应显式传值，`main` 不存在时执行失败，不查找其他 Agent。

## 核对入口

2026-10-16 起，单次调用在生产回调中按真实 runId/sessionKey/审批 ID 过滤广播，再进入有界 DriverQueue：最多 4096 项、累计 4 MiB、单项 256 KiB。溢出清空积压并立即取消所属请求/订阅和关闭客户端，不等待消费者恢复，不重启共享 Host，不将容量失败对账为成功。正常结束保序，提前停止消费取消未完成调用。实现与真实 Gateway 时序证据见[队列容量交付](../journal/shared/2026-10-16-openclaw-queue-bounds-delivery.md)。

[连接解析与私密文件](../../packages/octo-runtime-adapter-openclaw/src/local-gateway.ts)、[Gateway 执行](../../packages/octo-runtime-adapter-openclaw/src/index.ts)、[公共输入默认值](../../packages/octo-runtime-executor-core/src/invoke-input.ts)、[目录准备](../../packages/octo-runtime-executor-core/src/execution-preparation.ts)、[连接测试](../../test/openclaw-runtime-connection.test.js)。

新逻辑会话创建可读 `agent:{agentId}:{encoded-sessionName}-{uuid}` key，独立随机后缀防止同名合并；Provider 包装保留冒号。缺省名称仅由 Core 生成 UUID，Adapter 不决定渠道命名策略。

续聊必须原样复用 `providerSession.sessionId`，先校验 Agent 前缀与扩展归属，再用 hello 实际广告的 `sessions.describe({key})` 只读确认存在及 key，按版本 patch 本轮权限并确认后订阅、执行；不得逐 Run 新建。旧版 patch full/off，新版 patch permissionMode full/guarded。缺失、错归属或 RPC 失败明确失败，不隐式新建、不自动重发；旧 `resumable:false` 的已存在 key 可被显式续接。新回执 resumable:true，续接回执 resumeOutcome:resumed。系统指令仅在实际新建时发送。

每轮仍独立生成 run/idempotency key，通过 `sessions.messages.subscribe` 取流、`agent.wait` 确认终态、`sessions.abort` 取消，不能因共享 session 而接受前一轮广播。连接验证、执行完成和渠道投递分别判断；`deliver: false` 的本地验证不证明 IM 发消息成功。27 版本新增请求投影与 9.4 真实续接见 [Issue 224](../tasks/224-session-names/validation.md)。

审批没有 runId 时，agent 派发前收到的同 session 广播及 pending 快照属于旧轮次，忽略并有界记住其审批 ID，防止派发后重播重新路由。续聊派发后首次出现的无 runId 审批不能仅凭 sessionKey 或到达时间证明归属：以 `OPENCLAW_APPROVAL_RUN_UNVERIFIED` 明确失败、请求取消本轮，不发布交互、不调用原生 approval.resolve，不自动提升权限或新建 session；ask 和 full_access 均受此关联检查。若原生版本对合法本轮审批同样不提供 runId，该版本的该续聊审批路径也明确失败。新建独立随机 key 的 session 可接纳派发后无 runId 审批；带 runId 的审批始终严格匹配本轮请求身份。取消使用既有 sessions.abort 清理路径，发出请求不等于 Provider 已确认终止。
