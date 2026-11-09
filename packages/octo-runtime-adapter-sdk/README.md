# Adapter SDK

[简体中文](README.zh.md) | [Packages](../README.md)

The toolkit for writing a Provider Adapter: the `Adapter` authoring interface, `defineAdapter` to validate and freeze a definition, and the machinery every Adapter would otherwise reimplement — subprocess streaming, bounded queues, ACP mapping, approval bridges, environment and MCP mapping, logging, cleanup. Core handles orchestration; an Adapter only translates one Provider.

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

Register it like any other Adapter: `createKernelService({ home, endpoint, adapters: [echoAdapter] })` in the host, or `executor.register(echoAdapter)` for direct Core.

`Adapter` and `AdapterMetadata` describe authoring input, where `protocolSupport` is optional. `defineAdapter()` and `createJsonCliAdapter()` return `DefinedAdapter` with required protocol metadata. Omitting it defaults to protocol `${type}.canonical`, modes `["canonical"]`, and no native methods. Keep the inferred factory return type when passing the result to Core. A hand-written `HostedAdapter` must explicitly supply `protocolSupport`: registration validates it without adding defaults. Callers of canonical-only Adapters must explicitly select canonical mode.

## What the SDK gives you

Core forwards `request.agentEnv` as an ordered snapshot. Read common beans with helpers such as `invocationModel`, `invocationEffort` and `invocationApprovalMode`; read an agreed private payload with `agentEnvItem<T>(request.agentEnv, namespace, name)`. The consuming Adapter owns validation and native mapping. Caller composition uses `withAgentEnvItems` and an Adapter's independent `defaultAgentEnv` copy; invocation does not append defaults to the request. Private items need no public schema or generated type changes. See the [OpenClaw example](../../docs/en/concepts/architecture.md).

`agentEnvItem<T>` performs no runtime type validation. It returns `undefined` when absent and the original payload reference when present; Adapters consume it read-only and own required fields, defaults and semantics. See the [SDK private bean example](../../docs/en/getting-started/sdk.md) for host construction and Adapter consumption.

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

An Adapter with resident resources may supply synchronous, lazy `createExecutionScope({log})`. Core creates one scope per registration, binds invocation and replies to it, calls `beginShutdown(reason)` before cancellation, and awaits `close({deadline})`. The deadline is absolute `performance.now()` milliseconds. Report unresolved and failed service IDs independently of invocation cleanup; optional `processes()` returns only safe resident ownership snapshots. A turn releases its subscription; a scope cleans only work, leases and resources it owns. Explicit host owners manage injected persistent Engines and connections. Adapter construction methods, parameters and dependencies are unrestricted; CLI manifest conventions do not constrain SDK construction. See [scope types](src/execution-scope.ts) and the [Codex implementation](../octo-runtime-adapter-codex/src/service.ts).

- You receive a prepared `InvokeRequest`, not the public `InvokeInput`.
- Local execution receives the caller's existing absolute directory, validated by the Adapter through SDK helpers. Do not default to cwd, allocate or recreate application workspaces on resume/fallback. Workspace-owning external/preset Agents and `metadata.workspace: false` Adapters may omit the local override; preserve Provider-owned and Runtime operational state separately. See [workdir contract](../../docs/en/reference/invoke-input.md).
- Emit output for the declared and selected mode: `CanonicalEvent`s in canonical mode, native payloads and control output in native mode. A native-only Adapter does not need a canonical converter. Read the selected mode from internal `context.protocolMode`; public callers select it with `InvokeInput.protocol_mode`.
- Keep unsupported settings visible. Never report a setting as applied when the Provider rejected or ignored it.
- Cancellation has to reach the real Provider operation, and cleanup has to be awaited. A terminal event or a stopped iterator does not prove child processes exited.

## Import and distribution

The implementation is a private workspace package. Native hosts and Adapter authors integrate its source, declare a workspace dependency on `@mininglamp-oss/octo-runtime-adapter-sdk`, and import helpers and authoring types. It is not independently published; applications only connecting to Kernel use the client without this dependency.

## Further reading

- [Interfaces and exports](src/index.ts), [ACP Adapter](../octo-runtime-adapter-acp/README.md), [ACP transport](../octo-runtime-acp-client/README.md).
- A small real Adapter to copy: [Hermes](../octo-runtime-adapter-hermes/README.md).
- [Authoring guide](../../.octospec/guides/adapter-authoring.md), [Adapter metadata rule](../../.octospec/rules/adapter-metadata.md).
