# OpenClaw Adapter

[简体中文](README.zh.md) | [Packages](../README.md)

Calls an existing Agent in OpenClaw Gateway over its authenticated WebSocket RPC — no local Provider CLI is launched. Runtime gets the same Adapter interface while OpenClaw keeps the Agent's workspace, tools, skills, memory, and native configuration.

## When to use it

- You already run an OpenClaw Gateway with a configured Agent.
- Runtime should call that Agent instead of hosting one.
- The remote Agent owns its working directory; do not pass a local execution `workdir`.

## Register the Adapter and prepare input

This excerpt registers the Adapter and prepares its input. Execute with `executor.invoke(input)`; see [Executor Core](../octo-runtime-executor-core/README.md) for consumption, terminal checks, and `shutdown()`.

```ts
import { AgentExecutor } from "@mininglamp-oss/octo-runtime/executor-core";
import { InvokeInput } from "@mininglamp-oss/octo-runtime/protocol";
import { openclawAdapter } from "@mininglamp-oss/octo-runtime-adapter-openclaw";

const executor = new AgentExecutor();
executor.register(openclawAdapter);

const input = InvokeInput.check({
  inputs: [{ type: "text", text: "Say hello." }],
  protocol_mode: "canonical",
  contexts: {
    schema: "octo.context-envelope/v3",
    items: [
      {
        namespace: "octo.execution",
        name: "adapter",
        payload: { type: "openclaw", provider_agent_id: "main" }
      }
    ]
  }
});
```

## What it binds

| Item         | Value                                                                              |
| ------------ | ---------------------------------------------------------------------------------- |
| Adapter type | `openclaw`                                                                         |
| Exports      | `openclawAdapter`, `createOpenClawAdapter`                                         |
| Transport    | Gateway WebSocket RPC, advertised v4 methods and events                            |
| Target       | an existing Agent via `provider_agent_id`; input preparation defaults it to `main` |
| Output       | canonical events only                                                              |
| Workspace    | disabled — the remote Agent owns it                                                |

## Limits

- Compatibility is checked against explicitly supported Gateway versions **and** advertised v4 methods/events. Speaking protocol v4 alone does not make a Gateway compatible.
- `assisted` is unsupported. `ask` may fall back to native full access when the Gateway has no usable manual approval channel or scopes; a Provider diagnostic reports that fallback, so read the effective permission state instead of the requested one.
- `full_access` means native full access, not OS isolation.
- The Adapter owns the invocation's WebSocket and pending interactions — not the Gateway process or the remote Agent's resources.
- It never calls `config.patch` to replace persona, MCP, or workspace settings. A missing Agent fails; it is not created or silently substituted.
- Host prepares connection snapshots and device identity through `configureOpenClawConnection` or trusted Provider options. Probe and invoke never discover credentials or rewrite user configuration.

## Import and distribution

Private workspace package, included in the CLI distribution. It has no individual npm package or public SDK subpath.

## Further reading

- [Implementation](src/index.ts), [OpenClaw contract](../../.octospec/rules/openclaw.md), [Adapter SDK](../octo-runtime-adapter-sdk/README.md).
- [Runtime Protocol](../octo-runtime-protocol/README.md).
