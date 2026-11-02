# Developer Documentation

[简体中文](../zh-CN/README.md) | [Language Index](../README.md)

Octo Runtime gives applications a common interface for Agent calls. Your application supplies a task, background material, and execution settings. Runtime calls a Provider such as Codex or Claude Code and returns output as an event stream.

This documentation is for developers integrating the SDK, supplying business context and tools, and handling execution results. SDK chapters cover service integration, advanced dependencies, and optional AgentRun usage; root `SDK_*` guides add specific business wiring.

## Start Here

1. Follow [CLI Installation and Operations](getting-started/cli.md) to run from the terminal, or [SDK Service Integration](getting-started/sdk.md) to call Runtime from an application. Each path links the required [Harness setup](guides/harnesses.md).
2. Read [Architecture](concepts/architecture.md) for module roles and the execution flow.
3. Learn [Inputs and Contexts](concepts/inputs-and-contexts.md) to supply application data.

For module selection, read [Adapter and Extra Loading](concepts/module-loading.md): SDK native composition and CLI built-in/user manifests.

## Guides

| Task                                                                                  | Page                                                   |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Install and configure a Harness; enable Codex Computer Use or share WorkBuddy credits | [Harness Setup](guides/harnesses.md)                   |
| Supply business context, environment, images, or session continuation                 | [Context and Sessions](guides/context-and-sessions.md) |
| Connect an installed MCP server                                                       | [MCP](guides/mcp.md)                                   |
| Add an optional business integration                                                  | [Extras](guides/extras.md)                             |
| Diagnose a failed or interrupted invocation                                           | [Troubleshooting](guides/troubleshooting.md)           |

## SDK Chapters

1. [Integrate KernelService and ChannelGateway ExtraService](getting-started/sdk.md)
2. [Advanced: Context, session storage, and custom dependencies](guides/sdk-dependencies.md)
3. [Optional: AgentRun invocation, events, and control](guides/agent-runs.md)

## Reference

| Look up                                                | Page                                                  |
| ------------------------------------------------------ | ----------------------------------------------------- |
| Invocation fields, defaults, local environment, limits | [InvokeInput](reference/invoke-input.md)              |
| All built-in Context types and extension behavior      | [Context Catalog](reference/contexts.md)              |
| SDK methods and cross-language IPC protocol            | [Kernel IPC](reference/kernel-ipc.md)                 |
| Output modes, cancellation, approvals, questions       | [Output and Control](reference/output-and-control.md) |
| Adapter support and implementation boundaries          | [Providers](reference/providers.md)                   |

See [Maintenance and Validation](maintenance.md) for validation results and the relationship to existing documents. Device operations are covered in [CLI Installation and Operations](getting-started/cli.md).
