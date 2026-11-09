# 执行信封配置

[English](../../en/reference/contexts.md) | [Documentation](../README.md)

agentEnv 沿用 `octo.context-envelope/v3` 的 schema/items 结构。每项使用 namespace、name、payload；公共层校验顺序、唯一键与 JSON 容量；payload 语义由消费它的 Adapter 校验。应用可复用配置；client 和 Core 冻结每次调用，不修改原配置。

| item | 用途 |
| --- | --- |
| `octo.execution/adapter` | 已注册 Adapter 类型，仅含 type |
| `octo.execution/workspace` | 调用方已准备的绝对目录：`{ "path": "/absolute/prepared/project" }` |
| `octo.execution/model` | 模型及 reasoning.effort |
| `octo.execution/actmode` | 执行模式 |
| `octo.execution/envs` | 子进程环境变量 |
| `octo.execution/mcp` | 本次 MCP 连接 |
| `octo.execution/limits` | 执行预算 |
| `octo.security/approval_policy` | 工具审批策略 |

AgentEnv 允许宿主与 Adapter 约定的私有 item；Core 不解释其 payload，也不将它们渲染为模型输入。业务材料由应用准备为 inputs。OpenClaw 专属字段不进入公共协议，详见[架构示例](../concepts/architecture.md)。

`octo.control/instructions` 已删除，在通用信封、持久配置和 agentEnv 中均拒绝；`controlInstructions` 也拒绝。应用提示词由调用方准备为普通输入 parts，没有 Runtime 的 system 或受信角色。MCP、环境变量和上述其他执行设置保持。

输入示例见 [Inputs 与 agentEnv](../concepts/inputs-and-contexts.md)，高级字段见 [Invoke API](invoke-input.md)。环境变量和 MCP 配置不能进入模型正文或日志。

通用 ContextEnvelope 类型另外保留 `octo.content/inline`、`octo.content/references` 和 `octo.runtime/selection` 的原信封定义；它们不属于 agentEnv。业务材料先变成 inputs；运行设备选择在连接 endpoint 之前由应用完成。
