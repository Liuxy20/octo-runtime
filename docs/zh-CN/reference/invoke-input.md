# InvokeInput

[English](../../en/reference/invoke-input.md) | [文档目录](../README.md)

`InvokeInput` 是一次调用的参数对象。从 `@mininglamp-oss/octo-runtime/protocol` 导入该类型，按字段构造普通对象即可，不需要 `new`。

普通调用至少提供 `inputs` 和 `contexts`，建议再显式设置 `protocol_mode: "canonical"`。先读 [Inputs 与 Contexts](../concepts/inputs-and-contexts.md) 可了解完整示例；本页用于查阅字段。

可以用 `InvokeInput.check(value)` 校验 JSON 结构，校验成功后返回原值。Runtime 在执行前还会检查配置是否一致、会话能否续接、Provider 是否支持所选功能。

## 基本字段

| 字段            | 必填 / 默认 | 用途                                                                                   |
| --------------- | ----------- | -------------------------------------------------------------------------------------- |
| `inputs`        | 必填        | 1–128 个有序文本或图片对象，至少包含非空白文本或一张图片。                             |
| `contexts`      | 必填        | 包含 `schema` 和 `items` 的 Context 对象，`items` 可以为空。                           |
| `protocol_mode` | `native`    | `native` 返回 HostFrame，`canonical` 返回 CanonicalEvent。不支持的模式会在执行前报错。 |

默认使用 `codex` Adapter。要选择其他已注册的 Adapter，在 Context 中提供 `octo.execution/adapter`。

## 调用与会话标识

| 字段                | 省略时               | 用途                                                                   |
| ------------------- | -------------------- | ---------------------------------------------------------------------- |
| `sessionId`         | 自动生成             | 应用的会话 ID；不能单靠它恢复 Provider 对话。                          |
| `invocationId`      | 自动生成             | 关联本次调用、取消请求和交互回复。                                     |
| `runId`             | 自动生成             | 应用用来标识一次执行的 ID，独立于会话 ID 和调用 ID。                   |
| `sessionGeneration` | 回执返回执行使用的值 | 非负安全整数。应用可用它区分同一会话的不同代次，避免旧请求覆盖新数据。 |
| `providerEpoch`     | 不推断应用的版本号   | 非负安全整数。应用可用它标记 Provider 会话绑定的版本。                 |
| `runMetadata`       | 无                   | JSON 业务信息或诊断信息，用于关联记录，不作为模型输入或权限依据。      |

## 执行配置

通常通过 Context 选择执行设置。下列字段供需要直接提供配置的接入使用；同时提供字段和 Context 时，两者必须一致。

| 字段                  | 默认来源                                   | 用途                                                            |
| --------------------- | ------------------------------------------ | --------------------------------------------------------------- |
| `agentSource`         | OpenClaw 为 `preset`，其他为 `provisioned` | 使用 Provider 中已存在的 Agent，或由本次调用准备执行配置。      |
| `prompt`              | 从 inputs 生成的文本描述                   | 用于展示，不包含可替代原图片的数据。                            |
| `modelInput`          | 从 inputs 生成的文本                       | 按需覆盖输入文本；图片仍通过 inputs 提供。                      |
| `workdir`             | Context workspace 或本地当前目录           | Provider 的工作目录；必须与 Context 中的 fixed workspace 一致。 |
| `controlInstructions` | Context 会话指令                           | 单独传给 Provider 的指令文本，应用须验证来源权限。              |
| `approvalMode`        | Context 审批策略，否则为 `ask`             | 工具调用的审批模式，必须与 Context 一致。                       |
| `agentConfig`         | 解析后的执行设置                           | 完整 Provider 配置；模型和 effort 必须与 Context 一致。         |
| `runtimeLimits`       | 执行默认值；整轮默认 120,000 毫秒          | 完整超时配置；字段形式与 Context limits 不同，见下文。          |

`agentConfig` 包含 `workdir`、`model`、`effort`、`sandbox`、`providerAgentId`、`timeoutSeconds`（秒）、`openclawConfigPath`、`openclawStateDir` 和 JSON 对象 `providerOptions`。Runtime 保留 Provider 扩展字段，但仍校验已定义字段，并拒绝已删除字段。

`runtimeLimits` 使用 camelCase 字段名：`firstFrameTimeoutMs`、`modelIdleTimeoutMs`、`modelIdleWarningMs`、`modelIdlePolicy`、`toolTimeoutMs`、`toolWallTimeoutMs`、`runTimeoutMs`、`cancelGraceMs`、`enforcement`。数值单位为毫秒，策略为 `observe | enforce`。数值范围见 [Context 超时字段](contexts.md)，完整对象可用公开的 `assertRuntimeLimits` 校验。如果只想调整某一项，优先使用 Context `octo.execution/limits`。

## 继续会话与恢复输入

| 字段                             | 默认 / 要求                                        | 用途                                                           |
| -------------------------------- | -------------------------------------------------- | -------------------------------------------------------------- |
| `providerSession`                | 可选                                               | 保存 Provider 返回的整个会话对象，包括扩展字段，用于继续对话。 |
| `continuityMode`                 | 有 providerSession 时为 `continue`，否则为 `fresh` | `fresh` 不允许同时传 providerSession，`continue` 则必须提供。  |
| `freshFallbackModelInput`        | 可选                                               | 恢复失败并退回新会话时，应用提供的历史文本。                   |
| `freshFallbackModelInputParts`   | 可选                                               | 同上，但可以包含文本和图片。                                   |
| `freshFallbackImagesUnavailable` | 可选                                               | 必需的历史图片无法提供时，使退回新会话的恢复流程失败。         |

`providerSession` 必须包含非空 `sessionId`，还可包含 `resumable`、`resumeOutcome`（`new | resumed | fresh_fallback | compacted`）、`resumeFallback` 和 `contextInputVariant`（`primary | recovery`）。这些字段记录 Provider 的恢复结果，应用应连同扩展字段一起保存。完整续聊步骤见 [Context 与会话](../guides/context-and-sessions.md)。

## invoke 的第二个参数

`invoke(input, environment?)` 的 `environment` 接受以下设置，它们不放在 `input` 中：

- `signal`：本地 `AbortSignal`，用于请求取消，不会被序列化。
- `executionEnvOverrides`：覆盖本轮执行环境变量，KernelClient 通过单独的 IPC 字段传递。
- `streamLimits`：仅直接使用 AgentExecutor 时支持。KernelClient 收到该字段会返回 `KERNEL_STREAM_LIMITS_UNSUPPORTED`。

`executionEnvOverrides` 的结构为 `{env_variables: [{key, value}]}`，最多 128 项、65,536 字节。环境变量按以下顺序合并，后者覆盖前者：进程继承环境、Context envs、`executionEnvOverrides`、Adapter 固定设置。合并结果只供本轮使用，不修改全局 `process.env`。应用仍须自行检查调用者是否有权设置这些变量。

## 多模态与容量

`inputs` 中的文本对象为 `{type: "text", text: "..."}`，图片对象为 `{type: "image", mimeType, data, byteSize, sha256}`。每项可选的 `id` 在同一数组内必须唯一。

图片 `data` 使用规范 base64，`byteSize` 必须与解码后的字节数一致，`sha256` 为匹配的 SHA-256 小写十六进制值。支持 `image/png`、`image/jpeg` 和 `image/webp`。可以用 [image.mts](../../examples/image.mts) 生成这些字段。

每个输入数组最多 4 张图片，单图最多 2 MiB，解码后合计最多 8 MiB。整次调用的传输上限为 32 MiB UTF-8 JSON，包含 Context、base64 图片、恢复输入、环境变量覆盖及协议包装。

等于上限时允许提交；超过时，在启动 Provider 前返回 `INVOKE_REQUEST_TOO_LARGE`，不会截断输入。原输入和恢复数组都提交时，两份数据都会计入大小，即使图片内容相同。

## 常见格式错误

Context 缺少 `schema`、图片哈希不匹配、`inputs` 为空，或把 `signal` 放进 JSON，都会校验失败。旧字段或包装 `protocolMode`、`adapterType`、`request`、`options` 也不再使用；请使用 `protocol_mode`，并通过 Context 选择 Adapter。

来源：[InvokeInput](../../../packages/octo-runtime-protocol/src/invoke-input.ts)、[准备](../../../packages/octo-runtime-executor-core/src/invoke-input.ts)、[多模态校验](../../../packages/octo-runtime-protocol/src/multimodal.ts)、[schema](../../../packages/octo-runtime-protocol/schema/protocol.schema.json)。
