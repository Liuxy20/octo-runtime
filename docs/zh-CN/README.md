# 开发者文档

[English](../en/README.md) | [语言目录](../README.md)

Octo Runtime 为应用提供统一的 Agent 调用接口。应用提交任务、背景资料和执行配置，Runtime 调用 Codex、Claude Code 等 Provider，并将输出以事件流返回。

这套文档面向接入 SDK、提供业务背景和工具、处理执行结果的开发者。

## 从这里开始

1. 阅读[核心架构](concepts/architecture.md)，了解各模块的作用和执行流程。
2. 按 [CLI 安装与调用](getting-started/cli.md)运行，或完成[第一次 SDK 调用](getting-started/sdk.md)。
3. 配置所选 [Harness](guides/harnesses.md)，再理解 [Inputs 与 Contexts](concepts/inputs-and-contexts.md)。

## 操作指南

模块选择见 [Adapter 与 Extra 载入](concepts/module-loading.md)：SDK 原生组装，以及 CLI 内置清单和用户扩展清单。

| 任务                                                           | 页面                                             |
| -------------------------------------------------------------- | ------------------------------------------------ |
| 安装配置 Harness、开启 Codex Computer Use、共享 WorkBuddy 额度 | [Harness 安装配置](guides/harnesses.md)          |
| 提供业务背景、环境变量、图片或续聊信息                         | [Context 与会话](guides/context-and-sessions.md) |
| 连接已安装的 MCP server                                        | [MCP](guides/mcp.md)                             |
| 增加可选业务接入                                               | [Extra](guides/extras.md)                        |
| 排查失败或中断的调用                                           | [故障排查](guides/troubleshooting.md)            |

## 接口参考

| 查阅内容                         | 页面                                          |
| -------------------------------- | --------------------------------------------- |
| 调用字段、默认值、本地环境和限额 | [InvokeInput](reference/invoke-input.md)      |
| 全部内置 Context 类型与扩展行为  | [Context 目录](reference/contexts.md)         |
| SDK 方法与跨语言 IPC 协议        | [Kernel IPC](reference/kernel-ipc.md)         |
| 输出模式、取消、审批和追问       | [输出与控制](reference/output-and-control.md) |
| Adapter 支持范围与实现边界       | [Provider](reference/providers.md)            |

本库依据源码 `d44f5cd` 编写。验证结果和旧文档的对应关系见[维护与验证](maintenance.md)。更多 CLI 运维操作见[完整 CLI 指南](../../CLI_USAGE_GUIDE.md)。
