# Provider Support

[简体中文](../../zh-CN/reference/providers.md) | [Documentation](../README.md)

A Provider is the program that executes Agent tasks, such as Codex or Claude Code. Its Adapter translates Runtime input into Provider calls. Select an Adapter through `octo.execution/adapter` and install/authenticate the corresponding Provider on the execution machine. Runtime does not download these dependencies automatically.

For installation, account configuration, Codex Computer Use, and CodeBuddy/WorkBuddy credits, see [Harness Installation and Configuration](../guides/harnesses.md). For Runtime service commands and `octo-cli` dependencies, see [CLI Installation and Invocation](../getting-started/cli.md).

The table describes the checked-in Adapters. Confirm that your actual Provider version and account configuration work; registering an Adapter alone does not make it ready to execute.

| Adapter type                                                    | Native transport   | Public output modes | Per-invocation MCP                             |
| --------------------------------------------------------------- | ------------------ | ------------------- | ---------------------------------------------- |
| `codex`                                                         | app-server         | native + canonical  | stdio + HTTP                                   |
| `claude-code`                                                   | stream-json        | native + canonical  | stdio + HTTP                                   |
| `dsh` | DeepSeek Harness SDK JSON-RPC stdio | canonical | no per-invocation configuration |
| `acp`, `hermes`, `kimi-code`, `mcode`, `qodercli`, `qoderclicn` | ACP                | canonical           | stdio; HTTP when native capability is declared |
| `opencode`                                                      | OpenCode CLI       | canonical           | local stdio + remote HTTP                      |
| `codebuddy`                                                     | Provider CLI       | canonical           | Unsupported                                    |
| `openclaw`                                                      | Gateway            | canonical           | Unsupported                                    |
| `zcode-gui`                                                     | GUI runtime client | canonical           | Unsupported                                    |
| `antigravity`                                                   | Provider CLI       | canonical           | Unsupported                                    |
| `grok-build` | Grok CLI ACP stdio | canonical | stdio; HTTP when advertised; final `${` literals rejected |

Grok Build uses the shared ACP client and starts a CLI process per invocation. Version 1.0.67 has been checked for text streaming and cross-process session continuation on macOS arm64. See the [Grok adapter](../../../packages/octo-runtime-adapter-grok-build/README.md) for authentication, configuration, and validation limits.

The MCP column describes connections configured through `octo.execution/mcp` on each invocation. A Provider's own MCP configuration is a separate source of settings. See the [MCP guide](../guides/mcp.md) for optional fields and restrictions.

## Native Interaction Support

The Codex Driver manages initialization, thread creation/resume, this turn, interruption, and cleanup. In native mode, applications can reply to supported pending approvals, questions, and requests for additional information. They cannot start another turn or use this interface to manage arbitrary accounts, threads, or global configuration. `item/permissions/requestApproval` is currently unsupported.

Claude Code currently supports `can_use_tool` interactions. Check implementation support for other control methods individually. See [Output and Control](output-and-control.md) for the common response API.

## Models and Work Modes

Model IDs and reasoning effort depend on the Provider and its version. Runtime offers four effort choices, `low`, `medium`, `high`, and `xhigh`, which the Adapter converts to Provider settings. A Provider may not natively support four distinct levels.

Omitting actmode leaves mode behavior to the Provider without actively resetting it. Explicitly selecting an unsupported setting fails the invocation.

## OpenClaw Configuration Differences

OpenClaw uses an existing Gateway Agent and requires an explicit `provider_agent_id`, such as `main`. That Gateway manages the working directory. Nonempty environment variables passed through individual invocations are rejected.

Other Providers whose execution settings are prepared by Runtime normally use the local workdir resolved for the current invocation. A working directory does not restrict filesystem or network permissions.

Image input, sandbox, and session resume support also depend on the Adapter and Provider version; see the [Adapter READMEs](../../../packages/README.md). Documentation tests use a test Adapter. See [Maintenance and Validation](../maintenance.md) for real Provider integration coverage.

Sources: [Codex](../../../packages/octo-runtime-adapter-codex/src/index.ts), [Claude Code](../../../packages/octo-runtime-adapter-claude-code/src/index.ts), [ACP](../../../packages/octo-runtime-adapter-acp/src/index.ts), [OpenCode](../../../packages/octo-runtime-adapter-opencode/src/index.ts), [adapter registration](../../../packages/octo-runtime-adapter-sdk/src/index.ts).
