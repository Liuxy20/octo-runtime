# Context 类型参考

[English](../../en/reference/contexts.md) | [文档目录](../README.md)

每项 Context 由 `namespace`、`name` 和 `payload` 组成。本页使用 `namespace/name` 简写类型，例如 `octo.execution/adapter`。完整输入说明见 [Inputs 与 Contexts](../concepts/inputs-and-contexts.md)。

## contexts 对象

将下面的对象放在调用参数的 `contexts` 字段中：

```json
{
  "schema": "octo.context-envelope/v3",
  "items": [{ "namespace": "octo.execution", "name": "adapter", "payload": { "type": "codex" } }]
}
```

`items` 最多包含 32 项，也可以为空。整个 `contexts` 对象序列化后不得超过 65,536 UTF-8 字节。每项的 `payload` 必须是对象，`guidance` 是可选的说明文本。

`namespace` 和 `name` 各自最多 96 个字符，须匹配 `^[a-z0-9][a-z0-9._-]*$`。同一数组中，这两个字段的组合不能重复。执行、路由、安全和控制类 namespace（`octo.execution`、`octo.runtime`、`octo.security`、`octo.control`）不接受 `guidance`。

不要添加接口未定义的字段。Context v3 的 item 没有通用 `required` 字段，也没有独立的 schema 版本；`required: true` 会校验失败。已删除的 `octo.resources` namespace 也不再接受。自定义类型的处理方式见本页“业务扩展”。

## 内置类型

以下 12 类是 Runtime 内置类型。[contexts.json](../../examples/contexts.json) 包含全部示例，供查阅字段结构。使用时只选择需要的项，并替换示例路径、地址和其他配置值。

### 选择 Provider：`octo.execution/adapter`

`payload` 示例：`{"type":"codex"}`。`type` 选择已注册的 Adapter。

使用 OpenClaw 时还必须提供 `provider_agent_id`，例如 `main`，指定 Gateway 中已有的 Agent。其他 Adapter 不允许这个字段。

### 选择模型和推理强度：`octo.execution/model`

`payload` 示例：`{"selection":{"use_provider_default":true},"reasoning":{"effort":"medium"}}`。

至少提供 `selection` 或 `reasoning` 中的一项。选择模型时，使用 `selection: {id}` 或 `{use_provider_default:true}`；选择推理强度时，使用 `reasoning: {effort}` 或 `{use_provider_default:true}`。同一项不能既指定值又要求使用 Provider 默认值。

### 选择工作模式：`octo.execution/actmode`

`payload` 为 `{"mode":"default"}` 或 `{"mode":"plan"}`，由 Adapter 转换成 Provider 的工作模式。各 Provider 的支持情况不同；省略该项不会主动重置 Provider 已有模式。

### 设置工作目录：`octo.execution/workspace`

三种 `payload`：`{"mode":"fixed","path":"/example/project"}` 指定目录，`{"mode":"random"}` 创建随机目录，`{"mode":"none"}` 由预设 Agent 管理目录。

随机目录不能替代应用的持久化会话存储。工作目录也不是文件访问沙箱，不会限制 Provider 访问其他路径。

### 设置环境变量：`octo.execution/envs`

`payload` 示例：`{"env_variables":[{"key":"PROJECT_ID","value":"example-project"}]}`。

最多 128 个不重复的变量名，值为不含 NUL 的字符串。这里不会读取 dotenv 文件、执行 shell 或替换 `${NAME}`。OpenClaw 不支持非空的本轮环境变量。完整用法见 [Context 与会话](../guides/context-and-sessions.md)。

### 配置工具连接：`octo.execution/mcp`

`payload` 示例：`{"mcpServers":{"project-docs":{"type":"streamable_http","url":"https://example.com/mcp"}}}`。

最多配置 32 个服务。Runtime 根据连接方式校验字段，再交给 Adapter 转换为 Provider 配置。配置步骤和支持表见 [MCP 指南](../guides/mcp.md)。

### 设置执行超时：`octo.execution/limits`

`payload` 示例：`{"run_timeout_ms":120000}`，表示整轮执行超时设置为 120 秒。所有时间字段使用毫秒整数，详细范围见下表。该项不控制输出缓存的字节数或保留时间。

### 指定 Runtime：`octo.runtime/selection`

`payload` 示例：`{"mode":"explicit","runtime_id":"example-runtime"}`，供应用的上游路由逻辑选择 Runtime。也可以提供候选 Runtime 列表。

本地 Kernel 不实现远程设备发现或切换。即使输入包含此项，调用仍发给客户端已经连接的 endpoint。字段组合见本页“Runtime 选择”。

### 设置审批策略：`octo.security/approval_policy`

`payload` 示例：`{"mode":"ask"}`。支持的模式为 `ask`、`assisted` 和 `full_access`。Adapter 无法实现指定模式时会报错；普通背景文本不能改变此策略。交互处理见[输出与控制](output-and-control.md)。

### 提供正文：`octo.content/inline`

`payload` 示例：`{"entries":[{"text":"Selected source text","resource_ref":"doc:example"}]}`。Runtime 将正文作为背景资料发给模型。

`entries` 不能为空，每项需要非空 `text`。可选字段为 `resource_ref`、`source`（字符串或对象）、`summary`（字符串）。`source` 描述材料来源，不代表已验证读取权限。

### 提供资源引用：`octo.content/references`

`payload` 示例：`{"entries":[{"resource_ref":"doc:example","resolver":"mcp","locator":{"server_ref":"project-docs","tool":"read_document"}}]}`。

`entries` 不能为空，`resource_ref` 不能重复。还可包含对象 `params` 和字符串 `authorization_ref`、`revision`。模型会收到引用描述，但 Runtime 不会自动调用工具或读取正文。

### 设置会话指令：`octo.control/instructions`

`payload` 示例：`{"entries":[{"text":"Answer concisely."}]}`。Runtime 将文本以单个换行符连接，作为 Provider 会话指令单独传入，而非普通背景资料。

`entries` 可以为空，只接受文本条目，不接受 `source` 字段。应用必须验证指令来源的权限，不能直接使用未经授权的用户输入。指令在新建 Provider 会话时设置，续聊行为见 [Inputs 与 Contexts](../concepts/inputs-and-contexts.md)。

上述类型中，只有 `inline` 和 `references` 会作为普通背景文本发给模型。会话指令单独传入，其余类型用于执行配置。业务扩展 `extra.<domain>/*` 也会作为背景文本发送。

## 超时字段

| 字段                     | 含义         | 范围（毫秒）   |
| ------------------------ | ------------ | -------------- |
| `first_frame_timeout_ms` | 等待首帧     | 100–1,800,000  |
| `model_idle_timeout_ms`  | 模型空闲超时 | 100–3,600,000  |
| `model_idle_warning_ms`  | 模型空闲告警 | 100–3,600,000  |
| `tool_timeout_ms`        | 工具空闲超时 | 100–86,400,000 |
| `tool_wall_timeout_ms`   | 工具总时长   | 100–86,400,000 |
| `run_timeout_ms`         | 整轮执行     | 100–86,400,000 |
| `cancel_grace_ms`        | 取消宽限     | 100–60,000     |

`model_idle_policy` 和 `enforcement` 接受 `observe` 或 `enforce`。旧写法 `enforcement: "observe"` 不能与 `model_idle_policy`、`model_idle_warning_ms`、`tool_wall_timeout_ms` 同时提供。超时后的停止和清理还取决于 Provider，不能假设达到阈值时所有进程都已退出。

## Runtime 选择

供上游路由逻辑使用的两种写法：

- 指定单个 Runtime：`mode: "explicit"` 和 `runtime_id`，可选 `failover` 只能为 `none`。
- 指定候选列表：`mode: "candidates"`、1–64 个不重复的 `runtime_ids` 和 `strategy: "preferred_failover"`。可选 `failover` 为 `candidates` 或 `none`。

两者都接受 `offline_behavior: "wait" | "fail"`。协议会校验这些字段，但实际路由需要上游实现，本地 Kernel 不会据此连接另一台设备。

## 配置与可信指令

需要为多次调用复用配置时，应用可以使用 `ContextConfiguration`，其中 `defaults` 提供默认值，`mandatory` 提供不能被普通请求覆盖的设置。应用需要显式使用配置解析函数；KernelClient 不会自动加载这两层配置。

合并默认值和本轮输入时，环境变量按变量名合并，MCP 按服务名整项替换，model 和 limits 按 `payload` 成员合并。`mandatory` 中的 MCP 配置替换请求中的同名服务；环境变量与 mandatory 值冲突时则报错。其他类型的冲突规则见下方链接的配置实现。

内置类型中，除 inline 和 references 外，其余十类在类型目录中标记为 `persistent`，表示可用于应用保存的配置。该标记不会让 Runtime 自动保存、缓存或重发这些项，也不会恢复聊天历史。

会话指令只能来自应用信任的配置。配置解析要求将指令放在 `mandatory`，拒绝 `defaults` 中的指令和不可信请求提交的控制指令。本地 SDK/IPC 假定应用已完成来源授权；JSON 校验只检查结构，不能验证作者身份。

## 业务扩展

应用自己的背景数据可以使用 `extra.<domain>/<name>`，例如 `extra.project/selection`。提供对象 `payload`，并按需添加 `guidance`；无需为每种业务数据注册类型。

其他未知但结构合法的类型会保留在 Context 中，不过不支持该类型的组件不会使用它，也不会将它发给模型。已知执行类型仍按各自规则严格校验，业务数据不能替代权限配置。

校验通过后，还需要确保所选 Provider、模型和工具可用。支持范围见 [Provider](providers.md)。

来源：[schema](../../../packages/octo-runtime-protocol/schema/protocol.schema.json)、[校验器](../../../packages/octo-runtime-protocol/src/context.ts)、[目录](../../../packages/octo-runtime-protocol/src/context-catalog.ts)、[配置](../../../packages/octo-runtime-protocol/src/context-configuration.ts)、[renderer](../../../packages/octo-runtime-executor-core/src/model-input.ts)。
