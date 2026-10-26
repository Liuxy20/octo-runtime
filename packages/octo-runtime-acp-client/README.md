# ACP Client

[简体中文](README.zh.md) | [Packages](../README.md)

The JSON-RPC 2.0 / NDJSON transport for ACP subprocesses: request correlation, one update queue per session, permission replies, cancel, and bounded buffers. It speaks ACP and nothing else — turning native updates into `CanonicalEvent` is the Adapter's job.

## When to use it

- You are writing an Adapter for a Provider that already speaks ACP.
- You want the wire layer only; `createAcpAdapter` wraps it into a complete Adapter.
- A JSON-lines CLI that is not ACP belongs on the Adapter SDK's JSON CLI helper instead.

## One turn over ACP

```ts
import { spawnAcpClient } from "@mininglamp-oss/octo-runtime-acp-client";

const client = spawnAcpClient({ command: "hermes", args: ["acp"], cwd: process.cwd() });
try {
  await client.initialize();
  const { sessionId } = await client.newSession({ cwd: process.cwd() });
  for await (const update of client.prompt(sessionId, "Say hello.")) {
    if (update.type === "session/update") console.log(JSON.stringify(update));
  }
} finally {
  await client.close();
}
```

## Call order

1. `initialize()` — ACP handshake, before any session call.
2. `newSession({ cwd, model? })` or `loadSession(sessionId, { cwd? })` — an explicit Provider session.
3. `prompt(sessionId, text | content[])` — streams updates until the correlated response arrives.
4. `close()` — in `finally`, and await it even after a failure.

`acpNewSessionParams`, `acpLoadSessionParams`, and `acpPromptParams` build the raw params when you need them directly.

## What "done" means here

- The `session/prompt` JSON-RPC response ends the turn and carries its result and usage. Silence in the notification stream is not completion.
- `cancel(sessionId)` sends a notification. It does not confirm that execution stopped or that resources were released.
- Closing the prompt iterator early is not cancellation either.

## Permissions

Pass `permissionHandler` to answer `session/request_permission`. Without one, the client selects the first reject/deny option, otherwise the last offered option, and cancels when there are none — fine for a demo, not a policy. Approval semantics beyond that belong to the Adapter.

## Limits

Defaults are 300 seconds per request, 600 seconds for `session/load`, and eight hours for a prompt. Queues, raw message size, and line buffers are bounded; the stderr tail kept for diagnostics is capped at 8192 characters and is not a full Provider log.

## Import and distribution

Private workspace package, with no standalone public subpath.

## Further reading

- [Implementation](src/index.ts), [generic ACP Adapter](../octo-runtime-adapter-acp/README.md), [Adapter SDK](../octo-runtime-adapter-sdk/README.md).
- [Provider matrix](../../.octospec/guides/providers.md).
