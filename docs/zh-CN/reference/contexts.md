# 执行信封配置

[English](../../en/reference/contexts.md) | [Documentation](../README.md)

agentEnv 沿用 `octo.context-envelope/v3` 的 schema/items 结构。每项使用 namespace、name、payload；公共层校验顺序、唯一键与 JSON 容量；payload 语义由消费它的 Adapter 校验。应用可复用配置；client 和 Core 冻结每次调用，不修改原配置。

| item | 用途 |
| --- | --- |
| `octo.execution/adapter` | 已注册 Adapter 类型，仅含 type |
| `octo.execution/workspace` | 调用方已准备的绝对目录：`{ "path": "/absolute/prepared/project" }` |
| `octo.execution/model` | 模型及 reasoning.effort |
| `octo.execution/envs` | 子进程环境变量 |
| `octo.execution/mcp` | 本次 MCP 连接 |
| `octo.execution/limits` | 执行预算 |
| `octo.security/approval_policy` | 工具审批策略 |

AgentEnv 允许宿主与 Adapter 约定的私有 item；Core 不解释其 payload，也不将它们渲染为模型输入。业务材料由应用准备为 inputs。OpenClaw 专属字段不进入公共协议，详见 [OpenClaw 包文档](../../../packages/octo-runtime-adapter-openclaw/README.zh.md)。

`octo.control/instructions` 已删除，在通用信封、持久配置和 agentEnv 中均拒绝；`controlInstructions` 也拒绝。应用提示词由调用方准备为普通输入 parts，没有 Runtime 的 system 或受信角色。MCP、环境变量和上述其他执行设置保持。

输入示例见 [Inputs 与 agentEnv](../concepts/inputs-and-contexts.md)，高级字段见 [Invoke API](invoke-input.md)。环境变量和 MCP 配置不能进入模型正文或日志。


每个 item 只含 `namespace`、`name`、`payload`。顶层 `guidance`、`data_format` 已删除；业务自行定义材料、inline/reference、历史格式并构造 inputs。公共协议不登记这些类型，也不按资源身份合并 references。通用组合工具对普通 item 整项替换，Core 不隐式组合业务内容。

不指定模型时省略 `selection`，不指定思考强度时省略 `reasoning`；两者均不指定时省略整个 model item。`use_provider_default`、空 selection/reasoning/model 已不受支持。显式使用 defaults 组合工具的调用方须先去掉不需要的覆盖，省略不会清除已有 defaults，也不保证恢复的原生会话重置为全局默认。

来源分类、公共 actmode 与 execution.update 已删除。旧 source/actmode item 仍可能通过通用 opaque 结构校验，但不再生效，也不会自动转换。原生模式归各 Adapter 的私有配置，详见[包文档](../../../packages/README.md)。`adapter.xxx` 不是公共命名空间规范，其字段不进入 Schema、catalog 或生成类型。

业务调用方负责 endpoint 寻址、设备选择和故障转移，再通过 `octo-runtime-client` 发起 invoke。Runtime 在已选定设备上执行；公共协议已删除 `octo.runtime/selection`、解析后的选择类型及 `routing_schema` 声明。

`octo.execution/limits` 和 `RuntimeLimits` 已删除 `enforcement` 及全局关闭 watchdog 的兼容行为。旧字段必须从调用配置中移除；Adapter 读取预算时拒绝该字段。需要运行更久时，设置相应的有限预算：整轮默认 24 小时、最大 7 天；只增大 `run_timeout_ms` 不改变首帧、模型空闲或工具预算。`model_idle_policy: "observe"` 保留，只禁止模型空闲终止。
