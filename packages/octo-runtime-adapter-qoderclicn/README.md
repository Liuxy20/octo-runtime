# Qoder CLI CN Adapter

[简体中文](README.zh.md) | [Packages](../README.md)

Binds the China distribution of Qoder CLI (`qoderclicn --acp`) to Runtime. It behaves like the international adapter — `--yolo` for `full_access`, resume through `session/load` — but ships as a distinct binary and registers as its own adapter type, so a runtime can pick the CN build explicitly.

## When to use it

- The CN build is installed and logged in.
- A runtime has to distinguish the two Qoder distributions instead of picking one by accident.

## Register the Adapter and prepare input

This excerpt registers the Adapter and prepares its input. Execute with `executor.invoke(input)`; see [Executor Core](../octo-runtime-executor-core/README.md) for consumption, terminal checks, and `shutdown()`.

```ts
import { AgentExecutor } from "@mininglamp-oss/octo-runtime/executor-core";
import { InvokeInput } from "@mininglamp-oss/octo-runtime/protocol";
import { qoderCliCnAdapter } from "@mininglamp-oss/octo-runtime-adapter-qoderclicn";

const executor = new AgentExecutor();
executor.register(qoderCliCnAdapter);

const input = InvokeInput.check({
  inputs: [{ type: "text", text: "Say hello." }],
  protocol_mode: "canonical",
  contexts: {
    schema: "octo.context-envelope/v3",
    items: [{ namespace: "octo.execution", name: "adapter", payload: { type: "qoderclicn" } }]
  }
});
```

Event semantics live in [Runtime Protocol](../octo-runtime-protocol/README.md).

## What it binds

| Item         | Value                                                                                 |
| ------------ | ------------------------------------------------------------------------------------- |
| Adapter type | `qoderclicn`                                                                          |
| Export       | `qoderCliCnAdapter`                                                                   |
| Command      | `qoderclicn --acp`; `qoderclicn --yolo --acp` for `full_access`                       |
| Output       | canonical events only                                                                 |
| Session      | resumed through `session/load`                                                        |
| Model        | standard ACP option selection when the runtime configures a model Qoder CN advertises |

## Limits

- `--yolo` is added only for `full_access`.
- Canonical-only: pass `protocol_mode: "canonical"`.
- `ask` and `full_access` only; `assisted` is rejected.
- A probe checks that `qoderclicn` exists, not that it is authenticated.

## Import and distribution

Private workspace package. The international build is a separate adapter: [Qoder CLI](../octo-runtime-adapter-qodercli/README.md).

## Further reading

- [Implementation](src/index.ts), [ACP Adapter](../octo-runtime-adapter-acp/README.md), [Provider matrix](../../.octospec/guides/providers.md).
- [Input reference](../../docs/en/reference/invoke-input.md).
