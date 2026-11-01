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

## Configuration and session ownership

The example uses approval mode `ask` and leaves reasoning effort to the Provider. Set approvals through Context `octo.security/approval_policy` and effort through `octo.execution/model.payload.reasoning.effort`. Public `InvokeInput.approvalMode` is also supported, but must agree with an explicit Context policy. The Adapter receives the prepared internal `InvokeRequest`; see the [input reference](../../docs/en/reference/invoke-input.md) for current fields and rejected legacy configuration.

The caller saves and explicitly returns the complete `providerSession` from session updates, including Provider extension fields. Reusing the business `sessionId` alone starts fresh; Core keeps no persistent business-session-to-Provider binding table. See [Context and Sessions](../../docs/en/guides/context-and-sessions.md) for continuation and recovery input.

## Limits

- In `ask` and `assisted` modes, approvals use the active interaction bridge. `full_access` automatically handles supported approvals, but does not answer user questions or MCP elicitation.
- Ordered text and image input, including image-only input, become native text and image data URLs, not host-local paths. Image support in the Adapter does not guarantee the selected model accepts images. Formats, integrity fields, and size limits follow the [input reference](../../docs/en/reference/invoke-input.md).
- The authoritative session update is reported only after turn start succeeds; the Adapter never rebuilds application history.
- A turn acknowledgement, a text chunk, or a child exit is not proof of successful completion or cleanup.
- In native mode you must read Runtime control frames alongside Provider payloads.


Human approval capacity counts requests awaiting a decision per invocation, up to 256. Request 257 receives an explicit rejection while admitted approvals remain valid. A valid decision releases its slot immediately; automatic approvals consume no human slots. Questions and MCP elicitations retain a separate limit of 16 unfinished requests. `full_access` keeps Codex's `untrusted` policy and lets Runtime handle supported approvals automatically, preserving dynamic MCP behavior.

All stdin frames for one app-server share a bounded writer: 4096 normal entries / 64 MiB, including the active frame, plus a reserve of 8 entries / 64 KiB for protocol rejections and interrupts. Human-capacity rejections use the normal queue so an ordinary overflow burst cannot exhaust the small control reserve. It waits for each write callback and, when `write` returns false, for `drain`. Five seconds without write progress or 30 seconds since enqueueing fails delivery. The human decision deadline remains 10 minutes. Resolved confirms a successful local write callback, not Provider receipt or tool completion. Cancellation removes unsent responses; bytes already handed to the pipe cannot be recalled.

Structured local capacity, write, and timeout causes take precedence over unrelated plugin Unauthorized stderr. Native `HOST_EXECUTION_FAILED.failure` and canonical failures preserve the same cause; actual Provider authentication rejection retains its credential classification.

## Owned process cleanup

Default POSIX spawning creates an owned, independent process group. Cleanup awaits bounded `SIGTERM` → `SIGKILL` escalation and group-exit confirmation, including when the app-server leader has exited but tools remain. An injected `spawnFn` child is not assumed to own a process group; its cleanup targets the direct child.

On Windows this Adapter does not enable the shared helper's `processTree` option: direct-child termination and exit confirmation do not establish that all descendants exited. Any additional Kernel cleanup belongs to the Kernel's own ownership path. Host crashes and processes that escape the owned group remain outside normal cleanup guarantees; consumers must check cleanup failures rather than assume a cancellation acknowledgement proves exit.

See [Output and Control](../../docs/en/reference/output-and-control.md) for execution terminals and cancellation, and [Executor Core](../octo-runtime-executor-core/README.md) for `shutdown()` cleanup results.

## Import and distribution

Private workspace package, included in the CLI distribution. It has no individual npm package or public SDK subpath.

## Further reading

- [Implementation](src/index.ts), [Adapter SDK](../octo-runtime-adapter-sdk/README.md), [Runtime Protocol](../octo-runtime-protocol/README.md).
- [Input reference](../../docs/en/reference/invoke-input.md).
