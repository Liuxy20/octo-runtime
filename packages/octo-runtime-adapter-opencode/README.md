# OpenCode Adapter

[简体中文](README.zh.md) | [Packages](../README.md)

Runs one invocation through the OpenCode v2 CLI, choosing the transport by approval mode: JSON output for `full_access`, ACP for `ask`. Both paths end in `CanonicalEvent`. Version checks, config mapping, and completion rules stay here instead of leaking into Core.

## When to use it

- OpenCode 2.1.3 or newer, still below 3.0, is installed and authenticated.
- You want ACP behaviour for `ask` and the simpler CLI JSON path for unattended runs.
- You do not need image input; `assisted` is not supported either.

## Register the Adapter and prepare input

This excerpt registers the Adapter and prepares its input. Execute with `executor.invoke(input)`; see [Executor Core](../octo-runtime-executor-core/README.md) for consumption, terminal checks, and `shutdown()`.

```ts
import { AgentExecutor } from "@mininglamp-oss/octo-runtime/executor-core";
import { InvokeInput } from "@mininglamp-oss/octo-runtime/protocol";
import { opencodeAdapter } from "@mininglamp-oss/octo-runtime-adapter-opencode";

const executor = new AgentExecutor();
executor.register(opencodeAdapter);

const input = InvokeInput.check({
  inputs: [{ type: "text", text: "Say hello." }],
  protocol_mode: "canonical",
  contexts: {
    schema: "octo.context-envelope/v3",
    items: [{ namespace: "octo.execution", name: "adapter", payload: { type: "opencode" } }]
  }
});
```

## What it binds

| Item          | Value                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------- |
| Adapter type  | `opencode`                                                                               |
| Exports       | `opencodeAdapter`, `createOpenCodeAdapter`                                               |
| `full_access` | `opencode run --format json --thinking --auto --standalone`                              |
| `ask`         | `opencode acp` through the shared ACP Adapter                                            |
| Output        | canonical events only                                                                    |
| Model         | `provider/model`; effort becomes `provider/model#variant`, with `xhigh` mapped to `high` |
| MCP           | native v2 `mcp.servers` in CLI mode, negotiated session servers in ACP mode              |

## Limits

- Supported versions are detected `>=2.1.3 <3`. Undetectable or unsupported versions fail; the range is compatibility, not a claim that every release was tested.
- `assisted` and image input are rejected.
- The executable actually selected in the invocation's cwd and environment is what gets checked.
- Configuration is merged through `OPENCODE_CONFIG_CONTENT`; user files are not rewritten, and `cwd` and `PWD` stay consistent.
- CLI success requires a normal exit **and** final text. A tool or step stopping is not Run success.
- Native permission denials stay in force.

## Import and distribution

Private workspace package, included in the CLI distribution. It has no individual npm package or public SDK subpath.

## Further reading

- [Implementation](src/index.ts), [ACP Adapter](../octo-runtime-adapter-acp/README.md), [Adapter SDK](../octo-runtime-adapter-sdk/README.md).
- [Input reference](../../docs/en/reference/invoke-input.md).
