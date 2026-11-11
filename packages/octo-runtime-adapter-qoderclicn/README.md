# Qoder CLI CN Adapter

[简体中文](README.zh.md) | [Packages](../README.md)

Binds the China distribution of Qoder CLI (`qoderclicn --acp`) to Runtime. It behaves like the international adapter — `--yolo` for `full_access`, resume through `session/load` — but ships as a distinct binary and registers as its own adapter type, so a runtime can pick the CN build explicitly.

## When to use it

- The CN build is installed and logged in.
- A runtime has to distinguish the two Qoder distributions instead of picking one by accident.

## Register the Adapter and prepare input

This excerpt registers the Adapter and prepares its input. Execute with `executor.invoke(input)`; see [Executor Core](../octo-runtime-executor-core/README.md) for consumption, terminal checks, and `shutdown()`.

```ts
import { AgentExecutor } from "@mininglamp-oss/octo-runtime-executor-core";
import { InvokeInput } from "@mininglamp-oss/octo-runtime-protocol";
import { createQoderCliCnAdapter } from "@mininglamp-oss/octo-runtime-adapter-qoderclicn";

const executor = new AgentExecutor();
executor.register(createQoderCliCnAdapter({ command: "/absolute/path/qodercli", env: process.env }));

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
      { namespace: "octo.execution", name: "adapter", payload: { type: "qoderclicn" } }
    ]
  }
});
```

Event semantics live in [Runtime Protocol](../octo-runtime-protocol/README.md).

## What it binds

| Item         | Value                                                                                 |
| ------------ | ------------------------------------------------------------------------------------- |
| Adapter type | `qoderclicn`                                                                          |
| Export       | `createQoderCliCnAdapter`                                                                   |
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

## Private AgentEnv.Item

This package uses `adapter.qoderclicn/options` with optional `modeId: string`, an exact Provider-native ID. This is a package-local contract, not registered in public protocol; adapter.xxx is not a public namespace standard.

Omission performs no mode discovery or setter and does not reset a resumed session. Explicit values must be nonblank strings and match the current Provider advertisement exactly, without trimming or mapping default to build. A mode config option (including grouped options) and its actual configId take precedence; otherwise modes.availableModes is used. Missing advertisements, unsupported IDs, missing configId and RPC rejection fail without selecting another mode. No setter is sent when the current value already matches; otherwise session/set_config_option or session/set_mode is called. Setter success is acceptance, not fabricated confirmation. modeId does not change approval authorization.

Add the following item alongside the caller-prepared workspace and shared adapter/model items. Choose modeId from the native advertisement; the example does not promise Provider support. Keep existing options in the same payload. Old actmode is not converted.

```json
{ "namespace": "adapter.qoderclicn", "name": "options", "payload": { "modeId": "plan" } }
```
