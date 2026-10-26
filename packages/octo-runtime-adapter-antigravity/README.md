# Antigravity Adapter

[简体中文](README.zh.md) | [Packages](../README.md)

Runs one Runtime invocation through the Antigravity `agy` CLI: prepared input goes in as stdin NDJSON, one owned subprocess comes out, and native text, tool, session, and result messages become `CanonicalEvent`. It drives the CLI, never a desktop window.

## When to use it

- `agy` 1.3.3 or newer is installed and authenticated on the host.
- Every call is `full_access`; this Adapter has no approval path to fall back on.
- You need text and tools only: images and MCP are not supported.

## Register the Adapter and prepare input

This excerpt registers the Adapter and prepares its input. Execute with `executor.invoke(input)`; see [Executor Core](../octo-runtime-executor-core/README.md) for consumption, terminal checks, and `shutdown()`.

```ts
import { AgentExecutor } from "@mininglamp-oss/octo-runtime/executor-core";
import { InvokeInput } from "@mininglamp-oss/octo-runtime/protocol";
import { antigravityAdapter } from "@mininglamp-oss/octo-runtime-adapter-antigravity";

const executor = new AgentExecutor();
executor.register(antigravityAdapter);

const input = InvokeInput.check({
  inputs: [{ type: "text", text: "Say hello." }],
  protocol_mode: "canonical",
  approvalMode: "full_access",
  contexts: {
    schema: "octo.context-envelope/v3",
    items: [{ namespace: "octo.execution", name: "adapter", payload: { type: "antigravity" } }]
  }
});
```

`approvalMode` must already be `full_access` before the call — there is no `ask` path.

## What it binds

| Item         | Value                                                                     |
| ------------ | ------------------------------------------------------------------------- |
| Adapter type | `antigravity`                                                             |
| Exports      | `antigravityAdapter`, `createAntigravityAdapter`                          |
| Command      | `agy` with `--dangerously-skip-permissions --mode accept-edits`           |
| Output       | canonical events only                                                     |
| Session      | an explicit Provider session selects the conversation and stays resumable |
| Model        | passed through native CLI flags, with mapped effort                       |

## Limits

- `ask` and `assisted` fail instead of escalating to full access.
- Probe requires a detected version of at least 1.3.3; a missing version fails the probe.
- Trusted control instructions travel as tagged text inside the user input, not as a separate system role.
- Success needs a native `SUCCESS` result **and** a non-empty answer. Exit code zero alone is not success.
- Each invocation owns its process; cancellation and cleanup are the invocation's responsibility.

## Import and distribution

Private workspace package, included in the CLI distribution. It has no individual npm package or public SDK subpath.

## Further reading

- [Implementation](src/index.ts), [Adapter SDK](../octo-runtime-adapter-sdk/README.md), [Runtime Protocol](../octo-runtime-protocol/README.md).
- [Input reference](../../docs/en/reference/invoke-input.md).
