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
import { AgentExecutor } from "@mininglamp-oss/octo-runtime/executor-core";
import { InvokeInput } from "@mininglamp-oss/octo-runtime/protocol";
import { claudeCodeAdapter } from "@mininglamp-oss/octo-runtime-adapter-claude-code";

const executor = new AgentExecutor();
executor.register(claudeCodeAdapter);

const input = InvokeInput.check({
  inputs: [{ type: "text", text: "Say hello." }],
  protocol_mode: "canonical",
  contexts: {
    schema: "octo.context-envelope/v3",
    items: [{ namespace: "octo.execution", name: "adapter", payload: { type: "claude-code" } }]
  }
});
```

## What it binds

| Item         | Value                                                                            |
| ------------ | -------------------------------------------------------------------------------- |
| Adapter type | `claude-code`                                                                    |
| Exports      | `claudeCodeAdapter`, `createClaudeCodeAdapter`                                   |
| Protocol     | `claude.stream-json`, modes `native` and `canonical`                             |
| Transport    | one `claude` NDJSON stdio subprocess per invocation                              |
| Session      | explicit Provider session; a new session is generated only when none is supplied |
| Interactions | bidirectional `can_use_tool` requests through the active invocation's bridge     |

## Limits

- Approval responses go through two different paths: native consumers answer native requests, canonical consumers answer Runtime interactions. Do not mix them.
- Unsupported approval modes fail rather than degrading to full access.
- Working directory and permission settings are Provider configuration, not OS isolation.
- Streaming text, public reasoning, and tool events are separate; message completion is not Run completion.
- Cancellation and every exit path must finish owned-process cleanup.

## Import and distribution

Private workspace package, included in the CLI distribution. It has no individual npm package or public SDK subpath.

## Further reading

- [Implementation](src/index.ts), [Adapter SDK](../octo-runtime-adapter-sdk/README.md), [Runtime Protocol](../octo-runtime-protocol/README.md).
- [Input reference](../../docs/en/reference/invoke-input.md).
