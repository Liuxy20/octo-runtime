# Qoder CLI Adapter

[简体中文](README.zh.md) | [Packages](../README.md)

Binds the international Qoder CLI (`qodercli --acp`) to Runtime through the shared ACP Adapter. Full access adds Qoder's `--yolo`, which selects the ACP "bypass permissions" mode so headless tool runs do not block on interactive approval.

## When to use it

- The international Qoder build is installed and logged in.
- You want session resume through `session/load` rather than a fresh fallback.

## Register the Adapter and prepare input

This excerpt registers the Adapter and prepares its input. Execute with `executor.invoke(input)`; see [Executor Core](../octo-runtime-executor-core/README.md) for consumption, terminal checks, and `shutdown()`.

```ts
import { AgentExecutor } from "@mininglamp-oss/octo-runtime/executor-core";
import { InvokeInput } from "@mininglamp-oss/octo-runtime/protocol";
import { qoderCliAdapter } from "@mininglamp-oss/octo-runtime-adapter-qodercli";

const executor = new AgentExecutor();
executor.register(qoderCliAdapter);

const input = InvokeInput.check({
  inputs: [{ type: "text", text: "Say hello." }],
  protocol_mode: "canonical",
  contexts: {
    schema: "octo.context-envelope/v3",
    items: [{ namespace: "octo.execution", name: "adapter", payload: { type: "qodercli" } }]
  }
});
```

Event semantics live in [Runtime Protocol](../octo-runtime-protocol/README.md).

## What it binds

| Item         | Value                                                                              |
| ------------ | ---------------------------------------------------------------------------------- |
| Adapter type | `qodercli`                                                                         |
| Export       | `qoderCliAdapter`                                                                  |
| Command      | `qodercli --acp`; `qodercli --yolo --acp` for `full_access`                        |
| Output       | canonical events only                                                              |
| Session      | resumed through `session/load`; no fresh fallback needed                           |
| Model        | standard ACP option selection when the runtime configures a model Qoder advertises |

## Limits

- `--yolo` is added only for `full_access`. It does not elevate any other mode.
- Canonical-only: pass `protocol_mode: "canonical"`.
- `ask` and `full_access` only; `assisted` is rejected.
- A probe checks that `qodercli` exists, not that it is authenticated.

## Import and distribution

Private workspace package. For the China build use [Qoder CLI CN](../octo-runtime-adapter-qoderclicn/README.md), which is a separate binary and adapter type.

## Further reading

- [Implementation](src/index.ts), [ACP Adapter](../octo-runtime-adapter-acp/README.md), [Provider matrix](../../.octospec/guides/providers.md).
- [Input reference](../../docs/en/reference/invoke-input.md).
