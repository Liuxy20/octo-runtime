# OpenCode Adapter

[简体中文](README.zh.md) | [Packages](../README.md)

Runs one invocation through the OpenCode CLI, choosing the transport by approval mode: JSON output for `full_access`, ACP for `ask`. Both paths end in `CanonicalEvent`. Config mapping and completion rules stay here instead of leaking into Core.

## When to use it

- OpenCode is installed and authenticated, with the CLI JSON or ACP protocol used below.
- You want ACP behaviour for `ask` and the simpler CLI JSON path for unattended runs.
- You do not need image input; `assisted` is not supported either.

## Register the Adapter and prepare input

This excerpt registers the Adapter and prepares its input. Execute with `executor.invoke(input)`; see [Executor Core](../octo-runtime-executor-core/README.md) for consumption, terminal checks, and `shutdown()`.

```ts
import { AgentExecutor } from "@mininglamp-oss/octo-runtime-executor-core";
import { InvokeInput } from "@mininglamp-oss/octo-runtime-protocol";
import { createOpenCodeAdapter } from "@mininglamp-oss/octo-runtime-adapter-opencode";

const executor = new AgentExecutor();
executor.register(createOpenCodeAdapter({ command: "/absolute/path/opencode", env: process.env }));

const input = InvokeInput.check({
  inputs: [{ type: "text", text: "Say hello." }],
  protocol_mode: "canonical",
  agentEnv: {
    schema: "octo.context-envelope/v3",
    items: [
      {
        namespace: "octo.execution",
        name: "workspace",
        payload: { path: "/absolute/prepared/project" }
      },
      { namespace: "octo.execution", name: "adapter", payload: { type: "opencode" } }
    ]
  }
});
```

## What it binds

| Item          | Value                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------- |
| Adapter type  | `opencode`                                                                               |
| Exports       | `createOpenCodeAdapter`                                               |
| `full_access` | `opencode run --format json --thinking --auto --standalone`                              |
| `ask`         | `opencode acp` through the shared ACP Adapter                                            |
| Output        | canonical events only                                                                    |
| Model         | `provider/model`; effort becomes `provider/model#variant`, with `xhigh` mapped to `high` |
| MCP           | native v2 `mcp.servers` in CLI mode, negotiated session servers in ACP mode              |

## Limits

- Versions are optional diagnostic metadata. Upgrades, prereleases and unknown versions are not rejected, and invocation does not run `--version`. Protocol or process failures are reported from actual execution.
- `assisted` and image input are rejected.
- Probe and invocation use the host-bound executable, runtime, prefix arguments and environment; request PATH/cwd cannot reselect it.
- Configuration is merged through `OPENCODE_CONFIG_CONTENT`; user files are not rewritten, and `cwd` and `PWD` stay consistent.
- CLI success requires a normal exit **and** final text. A tool or step stopping is not Run success.
- Native permission denials stay in force.

## Import and distribution

Private workspace package, included in the CLI distribution. It has no individual npm package or public SDK subpath.

## Further reading

- [Implementation](src/index.ts), [ACP Adapter](../octo-runtime-adapter-acp/README.md), [Adapter SDK](../octo-runtime-adapter-sdk/README.md).
- [Input reference](../../docs/en/reference/invoke-input.md).

## Private AgentEnv.Item

This package uses `adapter.opencode/options` with optional `modeId: string`, an exact Provider-native ID. This is a package-local contract, not registered in public protocol; adapter.xxx is not a public namespace standard.

Omission performs no mode discovery or setter and does not reset a resumed session. Explicit values must be nonblank strings and match the current Provider advertisement exactly, without trimming or mapping default to build. A mode config option (including grouped options) and its actual configId take precedence; otherwise modes.availableModes is used. Missing advertisements, unsupported IDs, missing configId and RPC rejection fail without selecting another mode. No setter is sent when the current value already matches; otherwise session/set_config_option or session/set_mode is called. Setter success is acceptance, not fabricated confirmation. modeId does not change approval authorization.

Only the ask path uses ACP and supports this field. full_access uses JSON CLI and rejects an explicit modeId with OPENCODE_MODE_UNSUPPORTED before launch, without changing approval or transport. assisted remains unsupported.

Add the following item alongside the caller-prepared workspace and shared adapter/model items. Choose modeId from the native advertisement; the example does not promise Provider support. Keep existing options in the same payload. Old actmode is not converted.

```json
{ "namespace": "adapter.opencode", "name": "options", "payload": { "modeId": "plan" } }
```
