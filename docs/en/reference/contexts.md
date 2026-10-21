# Context Catalog

[简体中文](../../zh-CN/reference/contexts.md) | [Documentation](../README.md)

Each Context item consists of `namespace`, `name`, and `payload`. This page abbreviates a type as `namespace/name`, for example `octo.execution/adapter`. See [Inputs and Contexts](../concepts/inputs-and-contexts.md) for an introduction.

## The contexts Object

Put the following object in the invocation's `contexts` field:

```json
{
  "schema": "octo.context-envelope/v3",
  "items": [{ "namespace": "octo.execution", "name": "adapter", "payload": { "type": "codex" } }]
}
```

`items` accepts at most 32 entries and may be empty. The serialized `contexts` object must not exceed 65,536 UTF-8 bytes. Each `payload` must be an object; `guidance` is optional descriptive text.

`namespace` and `name` each allow at most 96 characters and must match `^[a-z0-9][a-z0-9._-]*$`. Each pair must be unique in the array. Execution, routing, security, and control namespaces (`octo.execution`, `octo.runtime`, `octo.security`, `octo.control`) do not accept `guidance`.

Do not add undefined fields. Context v3 items have no general `required` field or independent schema version; adding `required: true` fails validation. The removed `octo.resources` namespace is also rejected. See Business Extensions below for custom types.

## Built-in Types

Runtime has the following 12 built-in types. [contexts.json](../../examples/contexts.json) contains all examples for checking field structure. Select only the items you need and replace example paths, addresses, and configuration values.

### Select a Provider: `octo.execution/adapter`

Example `payload`: `{"type":"codex"}`. The `type` selects a registered Adapter.

OpenClaw also requires `provider_agent_id`, such as `main`, to select an existing Gateway Agent. Other Adapters do not allow this field.

### Select a Model and Reasoning Effort: `octo.execution/model`

Example `payload`: `{"selection":{"use_provider_default":true},"reasoning":{"effort":"medium"}}`.

Supply at least `selection` or `reasoning`. For a model, use `selection: {id}` or `{use_provider_default:true}`. For reasoning, use `reasoning: {effort}` or `{use_provider_default:true}`. A member cannot both specify a value and request the Provider default.

### Select a Work Mode: `octo.execution/actmode`

The `payload` is `{"mode":"default"}` or `{"mode":"plan"}`. The Adapter converts it to the Provider's work mode. Support differs across Providers; omitting this item does not actively reset an existing mode.

### Set the Working Directory: `octo.execution/workspace`

Three payloads are available: `{"mode":"fixed","path":"/example/project"}` selects a directory, `{"mode":"random"}` creates a random directory, and `{"mode":"none"}` leaves directory management to a preset Agent.

A random directory does not replace persistent application session storage. A working directory is not a filesystem sandbox and does not restrict access to other paths.

### Set Environment Variables: `octo.execution/envs`

Example `payload`: `{"env_variables":[{"key":"PROJECT_ID","value":"example-project"}]}`.

At most 128 unique variable names are allowed, with string values containing no NUL. This setting does not read dotenv files, execute a shell, or substitute `${NAME}`. OpenClaw rejects nonempty per-invocation environment variables. See [Context and Sessions](../guides/context-and-sessions.md) for usage.

### Configure Tool Connections: `octo.execution/mcp`

Example `payload`: `{"mcpServers":{"project-docs":{"type":"streamable_http","url":"https://example.com/mcp"}}}`.

Configure up to 32 services. Runtime validates fields for the connection type, then the Adapter converts them to Provider configuration. See the [MCP guide](../guides/mcp.md) for setup and support.

### Set Execution Timeouts: `octo.execution/limits`

Example `payload`: `{"run_timeout_ms":120000}` sets a 120-second whole-invocation timeout. Time fields are integer milliseconds, with detailed ranges below. This item does not control output-cache size or retention.

### Select a Runtime: `octo.runtime/selection`

Example `payload`: `{"mode":"explicit","runtime_id":"example-runtime"}`, for the application's upstream routing logic to select a Runtime. A candidate Runtime list is also supported.

The local Kernel does not discover or switch remote devices. Even with this item, a call goes to the endpoint the client already connected to. See Runtime Selection below for field combinations.

### Set Approval Policy: `octo.security/approval_policy`

Example `payload`: `{"mode":"ask"}`. Modes are `ask`, `assisted`, and `full_access`. An Adapter fails if it cannot implement the chosen mode. Ordinary background text cannot change the policy. See [Output and Control](output-and-control.md) for interactions.

### Supply Text: `octo.content/inline`

Example `payload`: `{"entries":[{"text":"Selected source text","resource_ref":"doc:example"}]}`. Runtime sends this text to the model as background material.

`entries` must be nonempty, with nonempty `text` in each entry. Optional fields are `resource_ref`, `source` (string or object), and `summary` (string). `source` describes provenance rather than confirming read permission.

### Supply Resource References: `octo.content/references`

Example `payload`: `{"entries":[{"resource_ref":"doc:example","resolver":"mcp","locator":{"server_ref":"project-docs","tool":"read_document"}}]}`.

`entries` must be nonempty, with unique `resource_ref` values. Entries may also contain object `params` and strings `authorization_ref` and `revision`. The model receives the reference description, but Runtime does not automatically call tools or read its content.

### Set Session Instructions: `octo.control/instructions`

Example `payload`: `{"entries":[{"text":"Answer concisely."}]}`. Runtime joins entries with a single newline and passes the result separately as Provider session instructions, rather than ordinary background material.

`entries` may be empty and accepts only text entries, without a `source` field. The application must authorize instruction sources instead of using unauthorized user input directly. Instructions are applied when a Provider session is created; see [Inputs and Contexts](../concepts/inputs-and-contexts.md) for continuation behavior.

Of the built-ins above, only inline and references are sent as ordinary background text. Session instructions are passed separately; the other types configure execution. Business extensions under `extra.<domain>/*` are also sent as background text.

## Timeout Fields

| Field                    | Meaning            | Allowed range (ms) |
| ------------------------ | ------------------ | ------------------ |
| `first_frame_timeout_ms` | First frame wait   | 100–1,800,000      |
| `model_idle_timeout_ms`  | Model idle timeout | 100–3,600,000      |
| `model_idle_warning_ms`  | Model idle warning | 100–3,600,000      |
| `tool_timeout_ms`        | Tool idle timeout  | 100–86,400,000     |
| `tool_wall_timeout_ms`   | Tool total timeout | 100–86,400,000     |
| `run_timeout_ms`         | Whole invocation   | 100–86,400,000     |
| `cancel_grace_ms`        | Cancellation grace | 100–60,000         |

`model_idle_policy` and `enforcement` accept `observe` or `enforce`. Legacy `enforcement: "observe"` cannot be combined with `model_idle_policy`, `model_idle_warning_ms`, or `tool_wall_timeout_ms`. Stopping and cleanup after a timeout also depend on the Provider; reaching a threshold does not mean all processes have already exited.

## Runtime Selection

Two forms are available for upstream routing logic:

- Single Runtime: `mode: "explicit"` and `runtime_id`, with optional `failover` limited to `none`.
- Candidate list: `mode: "candidates"`, 1–64 unique `runtime_ids`, and `strategy: "preferred_failover"`. Optional `failover` is `candidates` or `none`.

Both accept `offline_behavior: "wait" | "fail"`. The protocol validates these fields, but upstream code must implement routing. The local Kernel does not use them to connect to another device.

## Configuration and Trusted Instructions

To reuse settings across invocations, an application can use `ContextConfiguration`: `defaults` supplies defaults, while `mandatory` supplies settings that ordinary requests cannot override. The application must explicitly use configuration resolution; KernelClient does not load these layers automatically.

When defaults and invocation settings are merged, environment variables merge by name, MCP replaces whole server entries by name, and model/limits merge by `payload` member. Mandatory MCP settings replace same-name servers in the request. Conflicting mandatory environment values fail. See the configuration implementation linked below for conflict rules of other types.

The catalog marks the ten built-ins other than inline/references as `persistent`, meaning they may be used in application-saved configuration. The flag does not make Runtime save, cache, or resend them automatically, or restore chat history.

Session instructions must come from configuration trusted by the application. Configuration resolution requires them in `mandatory`, rejecting instructions in `defaults` and control instructions submitted by untrusted requests. The local SDK/IPC assumes the application has authorized the source; JSON validation checks structure, not author identity.

## Business Extensions

Application background data can use `extra.<domain>/<name>`, such as `extra.project/selection`. Supply an object `payload` and optional `guidance`. No registration is needed for each business data type.

Other unknown but structurally valid types remain in Context. Components that do not support them ignore them and do not send them to the model. Known execution types are still strictly validated; business data cannot replace permission configuration.

After validation, ensure the selected Provider, model, and tools are available. See [Providers](providers.md) for support.

Sources: [schema](../../../packages/octo-runtime-protocol/schema/protocol.schema.json), [validator](../../../packages/octo-runtime-protocol/src/context.ts), [catalog](../../../packages/octo-runtime-protocol/src/context-catalog.ts), [configuration](../../../packages/octo-runtime-protocol/src/context-configuration.ts), [renderer](../../../packages/octo-runtime-executor-core/src/model-input.ts).
