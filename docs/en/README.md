# Developer Documentation

[简体中文](../zh-CN/README.md) | [Language Index](../README.md)

Octo Runtime gives applications a common interface for Agent calls. Your application supplies a task, background material, and execution settings. Runtime calls a Provider such as Codex or Claude Code and returns output as an event stream.

This documentation is for developers integrating the SDK, supplying business context and tools, and handling execution results. Host-specific assembly detail — Electron initialization, IM business wiring — stays in the root `SDK_*` guides; this library covers the shared workflow and the API reference.

## Start Here

1. Read [Architecture](concepts/architecture.md) for module roles and the execution flow.
2. Follow [CLI Installation and Operations](getting-started/cli.md) or [Your First SDK Invocation](getting-started/sdk.md).
3. Set up your selected [Harness](guides/harnesses.md), then learn [Inputs and Contexts](concepts/inputs-and-contexts.md).

For module selection, read [Adapter and Extra Loading](concepts/module-loading.md): SDK native composition and CLI built-in/user manifests.

## Guides

| Task                                                                                  | Page                                                   |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Install and configure a Harness; enable Codex Computer Use or share WorkBuddy credits | [Harness Setup](guides/harnesses.md)                   |
| Supply business context, environment, images, or session continuation                 | [Context and Sessions](guides/context-and-sessions.md) |
| Connect an installed MCP server                                                       | [MCP](guides/mcp.md)                                   |
| Add an optional business integration                                                  | [Extras](guides/extras.md)                             |
| Diagnose a failed or interrupted invocation                                           | [Troubleshooting](guides/troubleshooting.md)           |

## Reference

| Look up                                                | Page                                                  |
| ------------------------------------------------------ | ----------------------------------------------------- |
| Invocation fields, defaults, local environment, limits | [InvokeInput](reference/invoke-input.md)              |
| All built-in Context types and extension behavior      | [Context Catalog](reference/contexts.md)              |
| SDK methods and cross-language IPC protocol            | [Kernel IPC](reference/kernel-ipc.md)                 |
| Output modes, cancellation, approvals, questions       | [Output and Control](reference/output-and-control.md) |
| Adapter support and implementation boundaries          | [Providers](reference/providers.md)                   |

See [Maintenance and Validation](maintenance.md) for validation results and the relationship to existing documents. Device operations are covered in [CLI Installation and Operations](getting-started/cli.md).
