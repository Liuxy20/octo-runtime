# Hermes Adapter

[简体中文](README.zh.md) | [Packages](../README.md)

Binds the Hermes CLI (`hermes acp`) to Runtime through the shared ACP Adapter. One prepared invocation per turn, explicit Hermes sessions, native updates normalized into `CanonicalEvent`. The host installs and authenticates Hermes.

## When to use it

- Hermes is installed and logged in on the machine that runs the executor.
- You want it behind the same Core or Kernel path as the other Providers.

## Register the Adapter and prepare input

This excerpt registers the Adapter and prepares its input. Execute with `executor.invoke(input)`; see [Executor Core](../octo-runtime-executor-core/README.md) for consumption, terminal checks, and `shutdown()`.

```ts
import { AgentExecutor } from "@mininglamp-oss/octo-runtime/executor-core";
import { InvokeInput } from "@mininglamp-oss/octo-runtime/protocol";
import { hermesAdapter } from "@mininglamp-oss/octo-runtime-adapter-hermes";

const executor = new AgentExecutor();
executor.register(hermesAdapter);

const input = InvokeInput.check({
  inputs: [{ type: "text", text: "Say hello." }],
  protocol_mode: "canonical",
  contexts: {
    schema: "octo.context-envelope/v3",
    items: [{ namespace: "octo.execution", name: "adapter", payload: { type: "hermes" } }]
  }
});
```

Consume the events as described in [Runtime Protocol](../octo-runtime-protocol/README.md); `run.completed` is the only success terminal.

## What it binds

| Item         | Value                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Adapter type | `hermes`                                                                                                                  |
| Export       | `hermesAdapter`                                                                                                           |
| Command      | `hermes acp`                                                                                                              |
| Output       | canonical events only                                                                                                     |
| Session      | explicit resume; an empty `session/load` result counts as a missing session and falls back to the caller's recovery input |
| Model        | Provider-advertised IDs; omit the model to keep the Provider default                                                      |

## Limits

- Canonical-only: pass `protocol_mode: "canonical"`. Core's native default is not a conversion.
- `ask` and `full_access` only; `assisted` is rejected before the process starts.
- A probe checks that `hermes` exists, not that it is authenticated or has model access.
- Each invocation owns its ACP process; await cleanup rather than trusting a cancellation receipt.

## Import and distribution

Private workspace package. The published distribution has no Hermes subpath.

## Further reading

- [Implementation](src/index.ts), [ACP Adapter](../octo-runtime-adapter-acp/README.md), [Provider matrix](../../.octospec/guides/providers.md).
- [Input reference](../../docs/en/reference/invoke-input.md).
