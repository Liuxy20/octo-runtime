# @mininglamp-oss/octo-runtime-adapter-openclaw

OpenClaw Provider 的统一 Runtime Adapter。通过认证 WebSocket Gateway protocol v4 执行已有 Agent，回传统一 Host 事件。

## 连接与目标

Runtime 的连接快照保存到 `<harness-home>/<profile>/adapters/openclaw/connection.json`，token 与设备私钥保存在该 profile 的 `credentials` 目录。自动发现只在 CLI 启动编排执行；CLI 保存 Home 来源，每次 daemon 启动重新读取 OpenClaw 配置并刷新快照，支持重启后跟随端口/token 轮换。probe 和 invoke 只读快照，不发现、不落盘。

SDK 显式调用 `configureOpenClawConnection(profileRoot, {url, token})` 初始化连接和稳定设备身份，或通过 `providerOptions` 传入 `OPENCLAW_GATEWAY_URL`、`OPENCLAW_GATEWAY_TOKEN`、`OPENCLAW_GATEWAY_DEVICE_ID`、`OPENCLAW_GATEWAY_PUBLIC_KEY`、`OPENCLAW_GATEWAY_PRIVATE_KEY`。SDK 不读取 OpenClaw 配置或环境变量。远程地址要求 `wss://`；CLI/SDK 共用认证与执行路径。

```sh
octo-runtime --profile work adapter connect openclaw --openclaw-home /path/to/openclaw
octo-runtime --profile work adapter connect openclaw --gateway-url ws://127.0.0.1:18789 --token-stdin
```

无参数时复用已保存连接或初始化默认来源。首次初始化可使用 `OPENCLAW_HOME`，或成对提供 `OPENCLAW_GATEWAY_URL` 和 `OPENCLAW_GATEWAY_TOKEN`。连接失败仅使该 Provider 不可用。

目标 Agent 由本轮 Context 的 `octo.execution/adapter.payload.provider_agent_id` 指定。探测不要求 `main` 存在，执行时验证实际目标；不自动创建 Agent或回退到其他目标。

完整定义与示例见 [统一合同](../../.octospec/rules/openclaw.md)。

## 执行边界

OpenClaw 管理 Agent 的 persona、Skill、Plugin、MCP、memory、tools、workspace 和原生审批。Runtime 不调用 `config.patch`、不清空 workspace，也不设置 `skipBootstrap`。

Adapter 声明 `metadata.workspace: false`，忽略 `octo.execution/workspace` 和 `workdir`，对 `preset` 与 `provisioned` 一致。Runtime 不检查或创建请求中的目录，不分配随机工作区，也不为 OpenClaw 创建 Provider 状态目录；准备回执使用 `workspace_mode: "none"`，被忽略的工作区配置记录为 `CONTEXT_WORKSPACE_IGNORED`。Gateway 的 `sessions.create` 和 `agent` 请求不携带 cwd/workspace，实际工作区始终由目标 OpenClaw Agent 管理。Context 格式、冻结计划一致性和执行身份校验继续生效。

Adapter 检查协议版本和公开执行能力，将原生事件映射为 canonical events，通过统一 interaction 合同处理审批、取消与恢复对账。Provider 原生配置不因调用而被永久改写。

## 版本兼容与权限

probe 与每次执行均读取真实 hello 的协议号、`server.version`、方法及事件，使用同一个 Adapter 内部解析器。当前合同表覆盖已核对的 27 个正式标签：2026.6.11、7.1、7.1-1、7.1-2、7.33–7.35、8.1、8.2、8.33–8.35、9.1–9.9、9.33、10.1–10.5（均带 2026 前缀）。接受 `v` 前缀；未核对版本、beta、fork、缺失版本或必要执行方法／事件时，在创建前明确失败。后续正式版本需要核对合同后加入，不能仅凭协议同为 v4 推断兼容。

6.11 和 7.x 的创建请求只发送公共字段，不发送 `permissionMode`、创建 `idempotencyKey` 或 `thinkingLevel`。随后在本次会话上 patch `execSecurity: full`、`execAsk: off`，确认保存结果后才启动 agent。执行请求始终保留 `agent.idempotencyKey`、模型、`thinking` 和系统指令。8.x 起采用原生会话权限字段，不调用已退休的旧权限 patch。创建或执行状态未知时不重建／重跑。

`ask` 在新版人工审批通道和授权可用时映射为 `guarded`；通道不可用时按兼容策略回退 `full_access`。旧版 `allowlist/on-miss` 无法区分人工 reviewer 与自动 reviewer，当前无法确认人工 ask，因而采用同样的 full 回退。每次回退发送 `run.notice/provider_diagnostic`，审批桥按实际 full 自动响应本次 allow-once，保留原始请求意图和 Context 身份。`full_access` 映射新版 `full` 或旧版 full/off；新版声明的 scopes 必须允许 `operator.admin`。宿主 sandbox、工具禁止策略及 harness 的独立限制仍按实际原生结果处理，`assisted` 仍不支持。

取消与断线对账重新核对连接合同，终态区分等待超时、执行超时和取消；不把 abort ACK 当成取消完成。源码核对、严格请求投影和替身端到端测试已覆盖上述范围；真实 6.11 的 probe、full_access／ask 回退文本、固定 exec 工具和取消，以及真实 9.4 的 full_access／ask 文本和取消已验证。6.11 经显式本地 TCP 转发验证，正式远程地址仍要求 WSS；**27 个版本的真实 Gateway、模型、reviewer／harness 与 IM 投递尚未全部实测**。详见 [6.11 记录](../../.octospec/tasks/40-openclaw-compatibility/remote-6.11-validation.md)、[版本矩阵](../../.octospec/tasks/40-openclaw-compatibility/compatibility-matrix.md)及[实施记录](../../.octospec/tasks/40-openclaw-compatibility/implementation.md)。
