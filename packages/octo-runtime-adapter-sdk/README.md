# Adapter SDK

[简体中文](README.zh.md) | [Packages](../README.md)

The toolkit for writing a Provider Adapter: the `Adapter` interface Core calls into, `defineAdapter` to validate and freeze a definition, and the machinery every Adapter would otherwise reimplement — subprocess streaming, bounded queues, ACP mapping, approval bridges, environment and MCP mapping, logging, cleanup. Core handles orchestration; an Adapter only translates one Provider.

## When to use it

- You are writing an Adapter for another CLI or app-server.
- You are extending one of the Adapters in this directory and want the shared transport.
- You are not looking for an execution engine: this package runs nothing by itself.

## Write a minimal adapter

```ts
import { defineAdapter } from "@mininglamp-oss/octo-runtime-adapter-sdk";

export const echoAdapter = defineAdapter({
  metadata: {
    type: "echo",
    agentSources: ["provisioned"],
    protocolSupport: { protocol: "echo.canonical", modes: ["canonical"], nativeMethods: [] }
  },
  async *invoke(request) {
    yield {
      protocolVersion: 2,
      type: "message.delta",
      payload: { channel: "final", text: request.modelInput }
    };
    yield { protocolVersion: 2, type: "run.completed", payload: {} };
  }
});
```

Register it like any other Adapter: `serveWorker([echoAdapter])` inside a Kernel worker, or `executor.register(echoAdapter)` for direct Core.

## What the SDK gives you

| Helper                                                              | What it saves you                                                                                                                                                    |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `defineAdapter(adapter)`                                            | Validates and freezes a definition, defaults to canonical-only, rejects unsupported MCP and protocol use, emits `run.notice` when reasoning effort cannot be applied |
| `createJsonCliAdapter(options)`, `spawnJsonLines(spec)`             | JSON-lines subprocess with stdin write acknowledgement, reverse requests, bounded lines, exit handling                                                               |
| `DriverQueue`, `NativeInteractionBridge`                            | Bounded native frame streaming and interaction replies                                                                                                               |
| `AcpTurnNormalizer`, `AcpApprovalBridge`                            | ACP update and permission mapping                                                                                                                                    |
| `invocationEnvironment`, `invocationMcpServers`, `assertMcpOptions` | Environment overrides and MCP server mapping                                                                                                                         |
| `RuntimeLogging`, `HourlyLogWriter`                                 | Bounded, rotated diagnostics                                                                                                                                         |
| `mapReasoningEffort`, `reasoningLevelMap`                           | Provider-specific effort levels, including "not supported"                                                                                                           |
| `watchLineLimit`, `readBoundedLines`                                | Line and buffer caps                                                                                                                                                 |
| `sanitizePublicValue`                                               | Strip unsafe fields before display                                                                                                                                   |

## Rules the interface assumes

- You receive a prepared `InvokeRequest`, not the public `InvokeInput`.
- Return `CanonicalEvent`s. If you also declare native support, handle `context.protocolMode` yourself.
- Keep unsupported settings visible. Never report a setting as applied when the Provider rejected or ignored it.
- Cancellation has to reach the real Provider operation, and cleanup has to be awaited. A terminal event or a stopped iterator does not prove child processes exited.

## Import and distribution

Private workspace package. The published distribution has no Adapter SDK subpath.

## Further reading

- [Interfaces and exports](src/index.ts), [ACP Adapter](../octo-runtime-adapter-acp/README.md), [ACP transport](../octo-runtime-acp-client/README.md).
- A small real Adapter to copy: [Hermes](../octo-runtime-adapter-hermes/README.md).
- [Authoring guide](../../.octospec/guides/adapter-authoring.md), [Adapter metadata rule](../../.octospec/rules/adapter-metadata.md).
