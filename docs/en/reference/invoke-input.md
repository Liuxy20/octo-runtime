# Invoke API and IPC Input

[简体中文](../../zh-CN/reference/invoke-input.md) | [文档目录](../README.md)

The public call is `client.invoke(inputs, sessionId, providerSession, agentEnv)`, returning a `KernelInvocation` async iterator. Identity and inputs are captured at call time; submission begins on first consumption. Unconsumed handles count toward the client limit of 128 records: consume them or release through return, throw, interrupt or owner drain. Ending observation of an accepted run does not cancel execution.

| Argument | Meaning |
| --- | --- |
| inputs | Ordered text/image parts, or InvocationContent with parts, protocol_mode, tracing/generation and explicit recovery content. No contexts, agentEnv, sessionId, providerSession or signal. |
| sessionId | Application conversation identity; undefined asks the client to generate it. It does not resume a Provider. |
| providerSession | Complete opaque object returned by the Provider; undefined starts fresh. |
| agentEnv | Required execution envelope; items may be empty. Defaults: codex, ask approval, 24-hour run budget. |

`run.invocationId`, `run.runId` and `run.sessionId` are available immediately. `client.interrupt(run.invocationId, reason?)` targets only that invocation owned by this client. Before submission it prevents sending and iteration throws an error recognized by isInvocationNotSubmitted. After submission, consume the original stream to its terminal event. An accepted interruption is neither a terminal nor cleanup confirmation.

## agentEnv

Shared execution beans include workspace, adapter, model, envs, mcp, approval_policy and limits. Private items require no central registration; unrelated Adapters ignore them, and the consuming Adapter validates their semantics. Public validation checks envelope structure, JSON, unique keys and budgets.

AgentEnv contains only `schema` and `items`. Shared settings use public beans; Harness-specific settings are private items agreed by the host and its Adapter. Core reads the route and forwards the envelope unchanged. The Adapter reads, validates and maps settings with adapter-sdk helpers, without an intermediate configuration object. See the [OpenClaw architecture example](../concepts/architecture.md).

## Caller-owned working directory

Local execution requires an explicit, existing absolute directory. Supply `octo.execution/workspace` with `payload: { "path": "/absolute/prepared/project" }`. The caller selects, creates, reuses and removes the directory; CLI and SDK neither default to cwd nor allocate an application workspace. A caller-created temporary directory follows the same contract.

Runtime checks the local path before Provider execution and never creates or recreates it. Missing input fails with `WORKDIR_REQUIRED`, a relative/invalid path with `WORKDIR_INVALID`, a missing directory with `WORKDIR_NOT_FOUND`, a file with `WORKDIR_NOT_DIRECTORY`, and inaccessible or otherwise unavailable paths with `WORKDIR_UNAVAILABLE`. These reason codes retain the existing public classification `OH-ADP-3004`; inspect the error `.code`, canonical failure `payload.code`/`failure.reasonCode`, or native error control. Validation cannot prevent a filesystem change between the check and the Provider operation; later native errors are reported as observed.

Pass the chosen directory on continuation and explicit fresh recovery. If it disappears, Runtime reports the failure without rebuilding it or choosing another directory. External/preset Agents and Adapters declaring `metadata.workspace: false` may omit a local override; OpenClaw keeps its own workspace and does not stat a remote path as a local directory. Runtime Home, logs, IPC files and Provider-owned state retain their separate owners.

Issue #335 removes workspace `mode` (`fixed`, `random`, `none`), `workspace_mode` receipt/projection fields, `prepareRunContext` and `WorkspaceAssignments`. Old mode-bearing payloads are rejected; remove them and prepare the directory before invoking. No compatibility conversion or data deletion is performed. Previously allocated directories remain user data. Run 7, Context v3, IPC 2 and Adapter transport 2 are unchanged.

## Application prompts

Application startup prompts are ordinary input, not execution settings. `octo.control/instructions` and `controlInstructions` are removed and rejected even when empty; there is no replacement system/developer/trusted prompt field. Remove the item from configuration and prepend the desired text to the input parts before calling Runtime. The caller owns its order, content and inclusion on initial, resumed and reconstructed sessions; see [session guidance](../guides/context-and-sessions.md).

## Content and recovery

InvocationContent requires parts and supports protocol_mode (default native), invocationId, runId, sessionName, sessionGeneration, providerEpoch, prompt, modelInput, runMetadata, continuityMode, freshFallbackModelInput, freshFallbackModelInputParts and freshFallbackImagesUnavailable. The application or client supplies tracing IDs; do not infer them from Provider IDs.

Image parts carry type/image, mimeType, base64 data, byteSize and sha256. Inputs contain 1–128 parts. The whole IPC request is limited to 32 MiB, counting primary and recovery content separately. Applications freeze recovery material explicitly; Runtime does not rebuild history. Use freshFallbackImagesUnavailable when historical image bytes cannot be supplied rather than silently falling back to text.

Runtime preserves the supplied text/image order without adding prompt text or separators. If you supply modelInput or freshFallbackModelInput/Parts, each is a complete caller-prepared input for that path, including any desired startup prompts. Do not rely on Runtime to add prompts only when a Provider session starts, or prepend them again when retrying the same frozen input.

Input selection is explicit: a supplied modelInput replaces the primary Provider carrier when inputs contain only text; when inputs contain images, their ordered parts are retained. Without modelInput, ordinary arrays remain unchanged. Fresh fallback selects freshFallbackModelInputParts first, then freshFallbackModelInput as one ordinary text part, then primary parts. Runtime does not infer intent by comparing text. Text-only recovery that would discard current images is rejected; explicit recovery parts must retain those images and their order.

## Low-level IPC v2

CLI JSON and client.submit use InvokeInput: `{ inputs, sessionId?, providerSession?, agentEnv, ...contentAndTracing }`. InvokeInput.check validates the boundary; the Adapter consumes execution settings directly. Low-level submit/subscribe users own complete RunRef, cancellation and tail observation; these calls do not join the invoke registry.

Old invoke(request, environment), cancelInvocation, contexts and top-level execution settings are incompatible. The client requires IPC v2. The independent Gateway still needs its own prompt migration before using the removed-contract Runtime/client release; changing Runtime alone is not an end-to-end migration. Internal Core/Adapter InvokeEnvironment.signal still carries cancellation; it is not a public invoke argument.

Sources: [protocol](../../../packages/octo-runtime-protocol/src/invoke-input.ts), [client](../../../packages/octo-runtime-client/src/client.ts). See [identifiers](../concepts/identifiers.md).
