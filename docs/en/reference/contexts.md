# Execution Envelope Configuration

[简体中文](../../zh-CN/reference/contexts.md) | [Documentation](../README.md)

agentEnv retains the schema/items structure of octo.context-envelope/v3. Each item uses namespace, name and payload; ordering, unique keys and JSON budgets remain enforced; payload semantics belong to consuming Adapters. Applications may reuse configuration; client and Core capture each invocation without mutating the original.

| Item | Purpose |
| --- | --- |
| `octo.execution/adapter` | Registered Adapter type, containing only type |
| `octo.execution/workspace` | Caller-prepared absolute directory: `{ "path": "/absolute/prepared/project" }` |
| `octo.execution/model` | Model and reasoning.effort |
| `octo.execution/actmode` | Execution mode |
| `octo.execution/envs` | Child-process environment variables |
| `octo.execution/mcp` | Per-invocation MCP connections |
| `octo.execution/limits` | Execution budgets |
| `octo.security/approval_policy` | Tool approval policy |

AgentEnv accepts private items agreed by the host and Adapter. Core neither interprets their payloads nor renders them into model input. Applications prepare business material as inputs. OpenClaw-specific fields do not enter the public protocol; see the [architecture example](../concepts/architecture.md).

`octo.control/instructions` is removed and rejected in general envelopes, persistent configuration and agentEnv. `controlInstructions` is also rejected. Application prompts belong in ordinary input parts, prepared by the caller; they have no Runtime system or trusted role. MCP, environment variables and other execution settings above remain unchanged.

See [Inputs and agentEnv](../concepts/inputs-and-contexts.md) and the [Invoke API](invoke-input.md). Keep environment variables and MCP configuration out of model text and logs.

The general ContextEnvelope type also retains the definitions of `octo.content/inline`, `octo.content/references` and `octo.runtime/selection`. They are not agentEnv settings: prepare business material as inputs and choose the execution endpoint in the application before connecting.
