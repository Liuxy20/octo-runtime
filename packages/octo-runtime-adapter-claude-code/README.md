# Claude Code Adapter

[简体中文](README.zh.md) | [Packages](../README.md)

Runs one invocation through Claude Code's bidirectional stream-json CLI. Each call owns a `claude` NDJSON subprocess, maps the prepared working directory, model, effort, MCP settings, permissions, and explicit session onto its arguments, and returns canonical events or native driver frames. Core stays free of Claude-specific branches.

## When to use it

- Claude Code is installed and logged in on the host.
- You want interactive tool approval through `can_use_tool` rather than a bypass flag.
- You need native Provider frames as well as canonical events; this is one of the few Adapters that supports both.

## Register the Adapter and prepare input

This excerpt registers the Adapter and prepares its input. Execute with `executor.invoke(input)`; see [Executor Core](../octo-runtime-executor-core/README.md) for consumption, terminal checks, and `shutdown()`.

```ts
import { AgentExecutor } from "@mininglamp-oss/octo-runtime-executor-core";
import { InvokeInput } from "@mininglamp-oss/octo-runtime-protocol";
import { createClaudeCodeAdapter } from "@mininglamp-oss/octo-runtime-adapter-claude-code";

const executor = new AgentExecutor();
executor.register(createClaudeCodeAdapter({ command: "/absolute/path/claude", env: process.env }));

const input = InvokeInput.check({
  inputs: [{ type: "text", text: "Say hello." }],
  protocol_mode: "canonical",
  agentEnv: {
    schema: "octo.context-envelope/v3",
    items: [
      {
        namespace: "octo.execution",
        name: "workspace",
        payload: { path: "/absolute/prepared/project" }
      },
      { namespace: "octo.execution", name: "adapter", payload: { type: "claude-code" } }
    ]
  }
});
```

## What it binds

| Item         | Value                                                                            |
| ------------ | -------------------------------------------------------------------------------- |
| Adapter type | `claude-code`                                                                    |
| Exports      | `createClaudeCodeAdapter`                                   |
| Protocol     | `claude.stream-json`, modes `native` and `canonical`                             |
| Transport    | one `claude` NDJSON stdio subprocess per invocation                              |
| Session      | explicit Provider session; a new session is generated only when none is supplied |
| Interactions | bidirectional `can_use_tool` requests through the active invocation's bridge     |

## Configuration and session ownership

The example uses approval mode `ask` and leaves reasoning effort to the Provider. Set approvals through Context `octo.security/approval_policy` and effort through `octo.execution/model.payload.reasoning.effort`. The Adapter receives the prepared internal `InvokeRequest`; see the [input reference](../../docs/en/reference/invoke-input.md) for current fields and rejected legacy configuration.

The caller saves and explicitly returns the complete `providerSession` from session updates, including Provider extension fields. Reusing the business `sessionId` alone starts fresh; Core keeps no persistent business-session-to-Provider binding table. See [Context and Sessions](../../docs/en/guides/context-and-sessions.md) for continuation and recovery input.

## Limits

- Approval responses go through two different paths: native consumers answer native requests, canonical consumers answer Runtime interactions. Do not mix them.
- Unsupported approval modes fail rather than degrading to full access.
- Working directory and permission settings are Provider configuration, not OS isolation.
- Streaming text, public reasoning, and tool events are separate; message completion is not Run completion.
- Cancellation and every exit path await owned-process cleanup; its platform limits are described below.

## Owned process cleanup

Claude Code uses SDK `spawnJsonLines`. On POSIX it creates an independent process group and awaits bounded `SIGTERM` → `SIGKILL` escalation and group-exit confirmation. A leader exiting does not by itself release ownership of tools still in that group.

On Windows this path does not enable the shared cleanup helper's `processTree` option: it targets and confirms the direct child, without guaranteeing that all descendants exit. Any additional Kernel cleanup belongs to the Kernel's own ownership path. Host crashes and processes that escape the owned group remain outside normal cleanup guarantees.

See [Output and Control](../../docs/en/reference/output-and-control.md) for execution terminals and cancellation, and [Executor Core](../octo-runtime-executor-core/README.md) for `shutdown()` cleanup results. A Provider result or cancellation acknowledgement alone does not prove cleanup succeeded.

## Import and distribution

Private workspace package, included in the CLI distribution. It has no individual npm package or public SDK subpath.

## Further reading

- [Implementation](src/index.ts), [Adapter SDK](../octo-runtime-adapter-sdk/README.md), [Runtime Protocol](../octo-runtime-protocol/README.md).
- [Input reference](../../docs/en/reference/invoke-input.md).
