# 执行信封配置

[English](../../en/reference/contexts.md) | [Documentation](../README.md)

agentEnv 沿用 `octo.context-envelope/v3` 的 schema/items 结构。每项使用 namespace、name、payload；顺序、唯一键、JSON 大小和已知 payload 约束保持不变。应用可复用配置；client 和 Core 冻结每次调用，不修改原配置。

| item | 用途 |
| --- | --- |
| `octo.execution/adapter` | 已注册 Adapter 类型；OpenClaw 还提供 provider_agent_id |
| `octo.execution/workspace` | cwd 和工作区策略 |
| `octo.execution/model` | 模型及 reasoning.effort |
| `octo.execution/actmode` | 执行模式 |
| `octo.execution/envs` | 子进程环境变量 |
| `octo.execution/mcp` | 本次 MCP 连接 |
| `octo.execution/limits` | 执行预算 |
| `octo.security/approval_policy` | 工具审批策略 |
| `octo.control/instructions` | 来自应用授权来源的受信会话指令 |

Runtime 不接受业务材料进入 agentEnv，不负责 extra.*、历史、资料引用的渲染。通用 ContextEnvelope 类型仍能表示可选条目，以保持信封定义不变；能够构造通用信封不意味着它可作为执行环境提交。Gateway 自己决定业务数据和格式，格式不构成 Runtime 执行要求。

输入示例见 [Inputs 与 agentEnv](../concepts/inputs-and-contexts.md)，高级字段见 [Invoke API](invoke-input.md)。环境变量和 MCP 配置不能进入模型正文或日志。

通用 ContextEnvelope 类型另外保留 `octo.content/inline`、`octo.content/references` 和 `octo.runtime/selection` 的原信封定义；它们不属于 agentEnv。业务材料先变成 inputs；运行设备选择在连接 endpoint 之前由应用完成。
