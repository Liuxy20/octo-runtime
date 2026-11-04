# 开发者文档

[English](../en/README.md) | [语言目录](../README.md)

Octo Runtime 为应用提供统一的 Agent 调用接口。应用提交任务、背景资料和执行配置，Runtime 调用 Codex、Claude Code 等 Provider，并将输出以事件流返回。

这套文档面向接入 SDK、提供业务背景和工具、处理执行结果的开发者。SDK 文档按服务接入、高级依赖、可选 AgentRun 使用分章；根目录 `SDK_*` 指南补充具体业务接线。

## 从这里开始

1. 从终端运行时，按 [CLI 安装与运维](getting-started/cli.md)操作；从应用调用 Runtime 时，完成[SDK 服务接入](getting-started/sdk.md)。两条路径均链接所需的 [Harness 安装配置](guides/harnesses.md)。
2. 阅读[核心架构](concepts/architecture.md)，了解各模块的作用和执行流程。
3. 理解 [Inputs 与 Contexts](concepts/inputs-and-contexts.md)，为调用提供应用数据。

## 操作指南

模块选择见 [Adapter 与 Extra 载入](concepts/module-loading.md)：SDK 原生组装，以及 CLI 内置清单和用户扩展清单。

| 任务                                                           | 页面                                             |
| -------------------------------------------------------------- | ------------------------------------------------ |
| 安装配置 Harness、开启 Codex Computer Use、共享 WorkBuddy 额度 | [Harness 安装配置](guides/harnesses.md)          |
| 提供业务背景、环境变量、图片或续聊信息                         | [Context 与会话](guides/context-and-sessions.md) |
| 连接已安装的 MCP server                                        | [MCP](guides/mcp.md)                             |
| 增加可选业务接入                                               | [Extra](guides/extras.md)                        |
| 排查组件构造或初始化失败                                       | [启动诊断](guides/startup-diagnostics.md)        |
| 排查失败或中断的调用                                           | [故障排查](guides/troubleshooting.md)            |

## SDK 分章阅读

1. [KernelService 与 ChannelGateway ExtraService 接入](getting-started/sdk.md)
2. [高级接入：Context、会话存储与自定义依赖](guides/sdk-dependencies.md)
3. [可选使用：AgentRun 调用、事件与控制](guides/agent-runs.md)

## 接口参考

| 查阅内容                         | 页面                                          |
| -------------------------------- | --------------------------------------------- |
| 调用字段、默认值、本地环境和限额 | [InvokeInput](reference/invoke-input.md)      |
| 全部内置 Context 类型与扩展行为  | [Context 目录](reference/contexts.md)         |
| SDK 方法与跨语言 IPC 协议        | [Kernel IPC](reference/kernel-ipc.md)         |
| 输出模式、取消、审批和追问       | [输出与控制](reference/output-and-control.md) |
| Adapter 支持范围与实现边界       | [Provider](reference/providers.md)            |

验证结果和旧文档的对应关系见[维护与验证](maintenance.md)。设备运维见 [CLI 安装与运维](getting-started/cli.md)。
