# Codex Adapter

[简体中文](README.zh.md) | [Packages](../README.md)

Drives the bidirectional `codex app-server` protocol: starts one app-server per invocation, walks `initialize` → `thread/start` or `thread/resume` → `turn/start`, answers reverse requests, and maps the result into canonical events or keeps Provider payloads as native frames. Codex sessions, approvals, and cancellation live here so Core needs no Codex-specific logic.

## When to use it

- Codex is installed and authenticated on the host.
- You want approvals and interactive questions routed back to your UI instead of pre-answered.
- You need native Provider payloads; this Adapter supports both `native` and `canonical`.

## Register the Adapter and prepare input

This excerpt registers the Adapter and prepares its input. Execute with `executor.invoke(input)`; see [Executor Core](../octo-runtime-executor-core/README.md) for consumption, terminal checks, and `shutdown()`.

```ts
import { AgentExecutor } from "@mininglamp-oss/octo-runtime/executor-core";
import { InvokeInput } from "@mininglamp-oss/octo-runtime/protocol";
import { codexAdapter } from "@mininglamp-oss/octo-runtime-adapter-codex";

const executor = new AgentExecutor();
executor.register(codexAdapter);

const input = InvokeInput.check({
  inputs: [{ type: "text", text: "Say hello." }],
  protocol_mode: "canonical",
  contexts: {
    schema: "octo.context-envelope/v3",
    items: [{ namespace: "octo.execution", name: "adapter", payload: { type: "codex" } }]
  }
});
```

## What it binds

| Item         | Value                                                                                                                                                       |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Adapter type | `codex`                                                                                                                                                     |
| Exports      | `codexAdapter`, `createCodexAdapter`                                                                                                                        |
| Protocol     | `codex.app-server`, modes `native` and `canonical`                                                                                                          |
| Transport    | one stdio JSON-RPC app-server per invocation                                                                                                                |
| Session      | explicit Provider session maps to the native thread; resume rejection or a missing rollout can trigger one fresh-thread fallback with caller-supplied input |
| Interactions | command/file approvals, user input, and MCP elicitation answered on the same active request                                                                 |

## Limits

- Reverse requests are not auto-approved. Approval policy follows the prepared request and the bridge you install.
- Ordered text and image input become native text and image data URLs, not host-local paths. Image support in the Adapter does not guarantee the selected model accepts images.
- The authoritative session update is reported only after turn start succeeds; the Adapter never rebuilds application history.
- A turn acknowledgement, a text chunk, or a child exit is not proof of successful completion or cleanup.
- In native mode you must read Runtime control frames alongside Provider payloads.

## Import and distribution

Private workspace package, included in the CLI distribution. It has no individual npm package or public SDK subpath.

## Further reading

- [Implementation](src/index.ts), [Adapter SDK](../octo-runtime-adapter-sdk/README.md), [Runtime Protocol](../octo-runtime-protocol/README.md).
- [Input reference](../../docs/en/reference/invoke-input.md).
