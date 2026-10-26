# MCode Adapter

[简体中文](README.zh.md) | [Packages](../README.md)

Binds MiniMax Code (`mcode acp`) to Runtime through the shared ACP Adapter. MiniMax picks the model itself and advertises no per-session model option, so Runtime sends no `session/set_model`; the model configured on the runtime governs.

## When to use it

- MiniMax Code is installed and logged in on the machine that runs the executor.
- You are fine with the model choice coming from MiniMax rather than the invocation.

## Register the Adapter and prepare input

This excerpt registers the Adapter and prepares its input. Execute with `executor.invoke(input)`; see [Executor Core](../octo-runtime-executor-core/README.md) for consumption, terminal checks, and `shutdown()`.

```ts
import { AgentExecutor } from "@mininglamp-oss/octo-runtime/executor-core";
import { InvokeInput } from "@mininglamp-oss/octo-runtime/protocol";
import { mcodeAdapter } from "@mininglamp-oss/octo-runtime-adapter-mcode";

const executor = new AgentExecutor();
executor.register(mcodeAdapter);

const input = InvokeInput.check({
  inputs: [{ type: "text", text: "Say hello." }],
  protocol_mode: "canonical",
  contexts: {
    schema: "octo.context-envelope/v3",
    items: [{ namespace: "octo.execution", name: "adapter", payload: { type: "mcode" } }]
  }
});
```

Event semantics live in [Runtime Protocol](../octo-runtime-protocol/README.md).

## What it binds

| Item         | Value                                                                                                                                   |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Adapter type | `mcode`                                                                                                                                 |
| Export       | `mcodeAdapter`                                                                                                                          |
| Command      | `mcode acp`                                                                                                                             |
| Output       | canonical events only                                                                                                                   |
| Session      | MiniMax advertises `loadSession: false`; an empty `session/load` result counts as missing and falls back to the caller's recovery input |
| Model        | none sent; MiniMax owns selection                                                                                                       |

## Limits

- Canonical-only: pass `protocol_mode: "canonical"`.
- Because no model setter exists, per-invocation `model` cannot be applied; the runtime's configured model decides.
- `ask` and `full_access` only; `assisted` is rejected.
- A probe checks that `mcode` exists, not that it is authenticated.

## Import and distribution

Private workspace package, with no public MCode subpath.

## Further reading

- [Implementation](src/index.ts), [ACP Adapter](../octo-runtime-adapter-acp/README.md), [Provider matrix](../../.octospec/guides/providers.md).
- [Input reference](../../docs/en/reference/invoke-input.md).
