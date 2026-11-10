# MCode Adapter

[简体中文](README.zh.md) | [Packages](../README.md)

Binds MiniMax Code (`mcode acp`) to Runtime through the shared ACP Adapter. MiniMax picks the model itself and advertises no per-session model option, so Runtime sends no `session/set_model`; the model configured on the runtime governs.

## When to use it

- MiniMax Code is installed and logged in on the machine that runs the executor.
- You are fine with the model choice coming from MiniMax rather than the invocation.

## Register the Adapter and prepare input

This excerpt registers the Adapter and prepares its input. Execute with `executor.invoke(input)`; see [Executor Core](../octo-runtime-executor-core/README.md) for consumption, terminal checks, and `shutdown()`.

```ts
import { AgentExecutor } from "@mininglamp-oss/octo-runtime-executor-core";
import { InvokeInput } from "@mininglamp-oss/octo-runtime-protocol";
import { createMcodeAdapter } from "@mininglamp-oss/octo-runtime-adapter-mcode";

const executor = new AgentExecutor();
executor.register(createMcodeAdapter({ command: "/absolute/path/mcode", env: process.env }));

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
      { namespace: "octo.execution", name: "adapter", payload: { type: "mcode" } }
    ]
  }
});
```

Event semantics live in [Runtime Protocol](../octo-runtime-protocol/README.md).

## What it binds

| Item         | Value                                                                                                                                   |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Adapter type | `mcode`                                                                                                                                 |
| Export       | `createMcodeAdapter`                                                                                                                          |
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

## Private AgentEnv.Item

This package uses `adapter.mcode/options` with optional `modeId: string`, an exact Provider-native ID. This is a package-local contract, not registered in public protocol; adapter.xxx is not a public namespace standard.

Omission performs no mode discovery or setter and does not reset a resumed session. Explicit values must be nonblank strings and match the current Provider advertisement exactly, without trimming or mapping default to build. A mode config option (including grouped options) and its actual configId take precedence; otherwise modes.availableModes is used. Missing advertisements, unsupported IDs, missing configId and RPC rejection fail without selecting another mode. No setter is sent when the current value already matches; otherwise session/set_config_option or session/set_mode is called. Setter success is acceptance, not fabricated confirmation. modeId does not change approval authorization.

Add the following item alongside the caller-prepared workspace and shared adapter/model items. Choose modeId from the native advertisement; the example does not promise Provider support. Keep existing options in the same payload. Old actmode is not converted.

```json
{ "namespace": "adapter.mcode", "name": "options", "payload": { "modeId": "plan" } }
```
