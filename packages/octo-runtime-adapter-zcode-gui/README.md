# ZCode GUI Adapter

[简体中文](README.zh.md) | [Packages](../README.md)

Launches the app-server bundled with ZCode Desktop (`zcode.cjs app-server --stdio`) and exchanges bidirectional NDJSON with it. Session, text, tool, and terminal messages become `CanonicalEvent`. It speaks ZCode's private protocol without automating Electron windows and without depending on an ACP server.

## When to use it

- ZCode Desktop is installed, so the bundled app-server can be discovered.
- You are fine with ZCode's natively configured model; per-invocation model selection is not available here.
- You want ZCode behind the same Core or Kernel path as the other Providers.

## Register the Adapter and prepare input

This excerpt registers the Adapter and prepares its input. Execute with `executor.invoke(input)`; see [Executor Core](../octo-runtime-executor-core/README.md) for consumption, terminal checks, and `shutdown()`.

```ts
import { AgentExecutor } from "@mininglamp-oss/octo-runtime/executor-core";
import { InvokeInput } from "@mininglamp-oss/octo-runtime/protocol";
import { zcodeGuiAdapter } from "@mininglamp-oss/octo-runtime-adapter-zcode-gui";

const executor = new AgentExecutor();
executor.register(zcodeGuiAdapter);

const input = InvokeInput.check({
  inputs: [{ type: "text", text: "Say hello." }],
  protocol_mode: "canonical",
  contexts: {
    schema: "octo.context-envelope/v3",
    items: [{ namespace: "octo.execution", name: "adapter", payload: { type: "zcode-gui" } }]
  }
});
```

## What it binds

| Item         | Value                                                                         |
| ------------ | ----------------------------------------------------------------------------- |
| Adapter type | `zcode-gui`                                                                   |
| Exports      | `zcodeGuiAdapter`, `createZcodeGuiAdapter`                                    |
| Discovery    | `ZCODE_BIN`, then PATH, then known ZCode Desktop installation paths           |
| Command      | the bundled app-server in `--stdio` mode                                      |
| Output       | canonical events only                                                         |
| Approvals    | `ask` and `full_access` through the invocation bridge; `assisted` is rejected |

## Limits

- The verified app-server path has no per-invocation model selection; the model configured in ZCode applies.
- `ZCODE_BIN` selects the executable, not a model.
- Runtime preferences disable unsupported memory, search, and automatic-question behaviour. Unsupported user-input requests are declined by the native mapping, and native Cron is disabled because Runtime does not implement its automation host callbacks.
- Do not infer support from a feature being present in the desktop UI.
- Working directory and permission replies are not OS isolation.
- The host prepares ZCode login; credentials are never copied into prompts or project files.

## Import and distribution

Private workspace package, included in the CLI distribution. It has no individual npm package or public SDK subpath.

## Further reading

- [Implementation](src/index.ts), [Adapter SDK](../octo-runtime-adapter-sdk/README.md), [Runtime Protocol](../octo-runtime-protocol/README.md).
- [Input reference](../../docs/en/reference/invoke-input.md).
