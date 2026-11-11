# ACP Adapter

[简体中文](README.zh.md) | [Packages](../README.md)

Turns any ACP-speaking CLI into a Runtime Adapter: one prompt turn per invocation, native ACP updates mapped to `CanonicalEvent`, permissions bridged, process cleanup owned. Six Adapters in this directory are thin wrappers around it.

## When to use it

- The Provider CLI already speaks ACP and you only need to bind its command, model options, and approval flow.
- You want canonical events; ACP's native `session/update` names never reach your code.
- The Provider has a bespoke protocol: write an Adapter against the [Adapter SDK](../octo-runtime-adapter-sdk/README.md) instead.

## Make one call

```ts
import { AgentExecutor } from "@mininglamp-oss/octo-runtime-executor-core";
import { InvokeInput } from "@mininglamp-oss/octo-runtime-protocol";
import { createAcpAdapter } from "@mininglamp-oss/octo-runtime-adapter-acp";

const executor = new AgentExecutor();
executor.register(
  createAcpAdapter({ type: "hermes", provider: "hermes", command: "hermes", args: ["acp"] })
);

const input = InvokeInput.check({
  inputs: [{ type: "text", text: "Say hello." }],
  agentEnv: {
    schema: "octo.context-envelope/v3",
    items: [
      {
        namespace: "octo.execution",
        name: "workspace",
        payload: { path: "/absolute/prepared/project" }
      },
      { namespace: "octo.execution", name: "adapter", payload: { type: "hermes" } }
    ]
  }
});

try {
  let terminal: string | undefined;
  for await (const event of executor.invoke({ ...input, protocol_mode: "canonical" })) {
    if (["run.completed", "run.failed", "run.cancelled"].includes(event.type))
      terminal = event.type;
    if (event.type === "run.failed") throw new Error(JSON.stringify(event.payload));
  }
  if (terminal !== "run.completed") throw new Error(terminal ?? "RUN_TERMINAL_MISSING");
} finally {
  const { cleanup } = await executor.shutdown();
  if (cleanup !== "complete") throw new Error("EXECUTOR_CLEANUP_INCOMPLETE");
}
```

## The definition

| Field                         | Meaning                                                                                       |
| ----------------------------- | --------------------------------------------------------------------------------------------- |
| `type`                        | Adapter type used by the `octo.execution` / `adapter` Context item                            |
| `provider`                    | Provider name stamped on normalized events                                                    |
| `command`                     | Executable to spawn                                                                           |
| `args`                        | Fixed arguments, or `(request) => string[]` built from the prepared request                   |
| `env`                         | Optional `(request) => ProcessEnv`                                                            |
| `protocolVersion`             | ACP protocol version to request                                                               |
| `emptyLoadResultMeansMissing` | Treat an empty `session/load` result as a missing session and use the caller's fallback input |

The optional second argument overrides the transport: `{ acpClientFactory, command }`.

## Behaviour

- Approval modes: `ask` and `full_access`. `assisted` throws `APPROVAL_MODE_UNSUPPORTED` before anything starts.
- Model selection uses advertised `configOptions`, falling back to the legacy model list. An explicit model with no supported setter fails rather than guessing.
- Images and MCP require the Provider to advertise the capability; MCP without it throws `MCP_UNSUPPORTED`.
- Canonical-only: pass `protocol_mode: "canonical"`. Core's native default is not an automatic conversion.
- Each invocation owns its ACP process. A cancellation receipt or a stopped iterator does not prove cleanup; await it.

## Import and distribution

Private workspace package, neither independently published nor re-exported through the full package. Native hosts declare a workspace dependency on its source and import it as needed; independent applications connect to an already composed Kernel through the client.

## Further reading

- [Implementation](src/index.ts), [ACP transport](../octo-runtime-acp-client/README.md), [Adapter SDK](../octo-runtime-adapter-sdk/README.md).
- A wrapper to copy: [Hermes](../octo-runtime-adapter-hermes/README.md).
- [Input reference](../../docs/en/reference/invoke-input.md).

## Private AgentEnv.Item

This package uses `adapter.<metadata.type>/options` with optional `modeId: string`, an exact Provider-native ID. This is a package-local contract, not registered in public protocol; adapter.xxx is not a public namespace standard.

Omission performs no mode discovery or setter and does not reset a resumed session. Explicit values must be nonblank strings and match the current Provider advertisement exactly, without trimming or mapping default to build. A mode config option (including grouped options) and its actual configId take precedence; otherwise modes.availableModes is used. Missing advertisements, unsupported IDs, missing configId and RPC rejection fail without selecting another mode. No setter is sent when the current value already matches; otherwise session/set_config_option or session/set_mode is called. Setter success is acceptance, not fabricated confirmation. modeId does not change approval authorization.

Add the following item alongside the caller-prepared workspace and shared adapter/model items. Choose modeId from the native advertisement; the example does not promise Provider support. Keep existing options in the same payload. Old actmode is not converted.

```json
{ "namespace": "adapter.<metadata.type>", "name": "options", "payload": { "modeId": "plan" } }
```
