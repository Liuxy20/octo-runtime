# Kimi Code Adapter

[简体中文](README.zh.md) | [Packages](../README.md)

Binds Kimi Code (`kimi acp`) to Runtime through the shared ACP Adapter. One prepared turn per invocation against a new or explicitly resumed session; native updates become `CanonicalEvent`. Provider installation, login, and Context stay with the host.

## When to use it

- Kimi Code is installed and logged in on the machine that runs the executor.
- You want per-session model selection from Kimi's advertised `configOptions`.

## Register the Adapter and prepare input

This excerpt registers the Adapter and prepares its input. Execute with `executor.invoke(input)`; see [Executor Core](../octo-runtime-executor-core/README.md) for consumption, terminal checks, and `shutdown()`.

```ts
import { AgentExecutor } from "@mininglamp-oss/octo-runtime/executor-core";
import { InvokeInput } from "@mininglamp-oss/octo-runtime/protocol";
import { kimiCodeAdapter } from "@mininglamp-oss/octo-runtime-adapter-kimi-code";

const executor = new AgentExecutor();
executor.register(kimiCodeAdapter);

const input = InvokeInput.check({
  inputs: [{ type: "text", text: "Say hello." }],
  protocol_mode: "canonical",
  contexts: {
    schema: "octo.context-envelope/v3",
    items: [{ namespace: "octo.execution", name: "adapter", payload: { type: "kimi-code" } }]
  }
});
```

Event semantics live in [Runtime Protocol](../octo-runtime-protocol/README.md).

## What it binds

| Item         | Value                                                                                         |
| ------------ | --------------------------------------------------------------------------------------------- |
| Adapter type | `kimi-code`                                                                                   |
| Export       | `kimiCodeAdapter`                                                                             |
| Command      | `kimi acp`                                                                                    |
| Output       | canonical events only                                                                         |
| Session      | new session, or an explicit Provider session resumed by the ACP Adapter                       |
| Model        | the model category in advertised `configOptions`, applied through `session/set_config_option` |

## Limits

- Canonical-only: pass `protocol_mode: "canonical"`.
- Use advertised option values, not display names. An explicit model the Provider cannot set fails instead of being guessed.
- Omitting the model keeps the Provider default.
- `ask` and `full_access` only; `assisted` is rejected.
- A probe checks that `kimi` exists, not that it is authenticated.

## Import and distribution

Private workspace package, with no public Kimi subpath.

## Further reading

- [Implementation](src/index.ts), [ACP Adapter](../octo-runtime-adapter-acp/README.md), [Provider matrix](../../.octospec/guides/providers.md).
- [Input reference](../../docs/en/reference/invoke-input.md).
