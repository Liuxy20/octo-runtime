# Execution Envelope Configuration

[简体中文](../../zh-CN/reference/contexts.md) | [Documentation](../README.md)

agentEnv retains the schema/items structure of octo.context-envelope/v3. Each item uses namespace, name and payload; ordering, unique keys and JSON budgets remain enforced; payload semantics belong to consuming Adapters. Applications may reuse configuration; client and Core capture each invocation without mutating the original.

| Item | Purpose |
| --- | --- |
| `octo.execution/adapter` | Registered Adapter type, containing only type |
| `octo.execution/workspace` | Caller-prepared absolute directory: `{ "path": "/absolute/prepared/project" }` |
| `octo.execution/model` | Model and reasoning.effort |
| `octo.execution/envs` | Child-process environment variables |
| `octo.execution/mcp` | Per-invocation MCP connections |
| `octo.execution/limits` | Execution budgets |
| `octo.security/approval_policy` | Tool approval policy |

AgentEnv accepts private items agreed by the host and Adapter. Core neither interprets their payloads nor renders them into model input. Applications prepare business material as inputs. OpenClaw-specific fields do not enter the public protocol; see the [OpenClaw package README](../../../packages/octo-runtime-adapter-openclaw/README.md).

`octo.control/instructions` is removed and rejected in general envelopes, persistent configuration and agentEnv. `controlInstructions` is also rejected. Application prompts belong in ordinary input parts, prepared by the caller; they have no Runtime system or trusted role. MCP, environment variables and other execution settings above remain unchanged.

See [Inputs and agentEnv](../concepts/inputs-and-contexts.md) and the [Invoke API](invoke-input.md). Keep environment variables and MCP configuration out of model text and logs.


Each item contains only `namespace`, `name` and `payload`. Top-level `guidance` and `data_format` are removed. Applications define material, inline/reference and history formats and prepare inputs. These types are not in the public catalog, and references are not merged by resource identity. Explicit composition replaces ordinary items as a whole; Core does not compose business content.

Omit `selection` to leave model choice to the Provider, and `reasoning` to omit effort. Omit the entire model item when neither is set. `use_provider_default` and empty selection/reasoning/model objects are unsupported. Callers using explicit defaults must remove unwanted overrides before composition: omission does not clear defaults or reset a resumed native session to global Provider defaults.

Source classification, public actmode and execution.update are removed. Old source/actmode items may still pass generic opaque-envelope validation, but have no effect and are not converted. Native modes belong to the individual Adapter's private contract; see the [package READMEs](../../../packages/README.md). `adapter.xxx` is not a public namespace standard, and its fields do not enter Schema, catalog or generated types.

Applications own endpoint discovery, device selection and failover before invoking through `octo-runtime-client`. Runtime executes on the selected device; `octo.runtime/selection`, its resolved selection types and `routing_schema` advertisement have been removed from the public protocol.

`octo.execution/limits` and `RuntimeLimits` no longer accept `enforcement` or the legacy global watchdog opt-out. Remove that field from caller configuration; the Adapter rejects it when reading limits. For longer execution, set the relevant finite budgets: the total-run default is 24 hours and the maximum is 7 days. Raising `run_timeout_ms` does not change first-frame, model-idle, or tool budgets. `model_idle_policy: "observe"` remains supported and only disables model-idle termination.
