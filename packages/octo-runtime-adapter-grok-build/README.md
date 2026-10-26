# Grok Build Adapter

[简体中文](README.zh.md) | [Packages](../README.md)

Runs one invocation over Grok Build's ACP stdio protocol: starts `grok --no-auto-update agent --no-leader stdio`, negotiates Grok's own authentication, and maps output, tools, sessions, approvals, and questions into `CanonicalEvent`. Grok owns model calls and tools; Runtime never calls the xAI API directly.

## When to use it

- Grok Build `>=1.0.67 <2.0.0` is installed and natively authenticated by the host.
- You want permission requests, ask-user prompts, and plan approvals routed to your UI.
- You need Grok's session extensions, which the generic ACP factory does not cover.

## Register the Adapter and prepare input

This excerpt registers the Adapter and prepares its input. Execute with `executor.invoke(input)`; see [Executor Core](../octo-runtime-executor-core/README.md) for consumption, terminal checks, and `shutdown()`.

```ts
import { AgentExecutor } from "@mininglamp-oss/octo-runtime/executor-core";
import { InvokeInput } from "@mininglamp-oss/octo-runtime/protocol";
import { grokBuildAdapter } from "@mininglamp-oss/octo-runtime-adapter-grok-build";

const executor = new AgentExecutor();
executor.register(grokBuildAdapter);

const input = InvokeInput.check({
  inputs: [{ type: "text", text: "Say hello." }],
  protocol_mode: "canonical",
  contexts: {
    schema: "octo.context-envelope/v3",
    items: [{ namespace: "octo.execution", name: "adapter", payload: { type: "grok-build" } }]
  }
});
```

## What it binds

| Item             | Value                                                                      |
| ---------------- | -------------------------------------------------------------------------- |
| Adapter type     | `grok-build`                                                               |
| Exports          | `grokBuildAdapter`, `createGrokBuildAdapter`                               |
| Command          | `grok --no-auto-update agent --no-leader stdio`                            |
| Output           | canonical events only                                                      |
| Auth             | advertised `xai.api_key` or `cached_token`, in advertised order            |
| Model and effort | advertised session setters; `xhigh` may downgrade to `high` with a warning |

## Behaviour

- `ask` and `full_access` set native yolo policy with autoMode disabled. `assisted` and explicit sandbox overrides fail.
- Full access does not automatically answer questions or approve plans — those still come back through the same invocation.
- An explicit session load disables workspace-snapshot recovery. Only `FS_NOT_FOUND` uses the caller-supplied fresh fallback.
- Cancellation invalidates pending interactions, sends a session cancel, and performs bounded process cleanup.
- Images require advertised support. MCP uses standard session servers and rejects unsupported optional fields and unresolved template syntax.

## Limits

- The recorded tested version is 1.0.67; the compatible range is a bound, not evidence that every release and platform was verified.
- Authentication is never inferred from environment variables, and a rejected method is not retried with another one. No browser login, no credential-file rewriting.
- No final text, queue acknowledgement, disconnect, process exit, or cleanup failure is reported as success.

## Import and distribution

Private workspace package, included in the CLI distribution. It has no individual npm package or public SDK subpath.

## Further reading

- [Implementation](src/index.ts), [worker example](examples/worker.mts), [fixtures](../../test/grok-build-adapter.test.js).
- [Recorded verification](../../.octospec/tasks/95-grok-build-acp/reference.md), [Adapter SDK](../octo-runtime-adapter-sdk/README.md).
