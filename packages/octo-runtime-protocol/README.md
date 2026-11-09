# Runtime Protocol

[简体中文](README.zh.md) | [Packages](../README.md)

The data contract for everything that crosses a module boundary in Octo Runtime: the input you hand to an executor, the Context attached to one turn, the events that come back, and the terminal states that tell you whether the run actually succeeded. `InvokeInput`, `CanonicalEvent`, `HostFrame`, and the Context envelope live here as JSON Schema, TypeScript types, and runtime validators.

## When you touch this package

- You build an `InvokeInput` and call Core or Kernel.
- You consume output and need to tell progress from a terminal result.
- You write an Adapter or a host and need the exact JSON shape.

It never runs a Provider, chooses business Context, or stores history. This is the vocabulary, not the engine.

## Validate one invocation

```ts
import { InvokeInput } from "@mininglamp-oss/octo-runtime/protocol";

const input = InvokeInput.check({
  inputs: [{ type: "text", text: "Summarize the last commit." }],
  agentEnv: {
    schema: "octo.context-envelope/v3",
    items: [
      {
        namespace: "octo.execution",
        name: "workspace",
        payload: { path: "/absolute/prepared/project" }
      },
      { namespace: "octo.execution", name: "adapter", payload: { type: "dsh" } }
    ]
  }
});
```

`check` throws on a malformed shape or an oversized payload and returns the same object. It calls nothing and generates nothing: KernelClient, Core, and Kernel fill in `invocationId`, `runId`, and `sessionId` when you omit them, so keep the returned IDs if you want to cancel or correlate the run later.

## The fields that matter

| Field                                | Required | What it does                                                                                      |
| ------------------------------------ | -------- | ------------------------------------------------------------------------------------------------- |
| `inputs`                             | yes      | This turn's text and image parts, in order. Image bytes go here once.                             |
| `agentEnv`                           | yes      | Context v3 envelope. Its `octo.execution` / `adapter` item selects the Adapter; empty is legal.   |
| `octo.execution/workspace.payload.path`                   | local calls | Caller-prepared existing absolute directory in the workspace item. No cwd default; not a sandbox. |
| `protocol_mode`                      | no       | `native` (default) or `canonical`.                                                                |
| `providerSession`                    | no       | Explicit Provider session to resume. Never rebuilt from `sessionId`.                              |
| `sessionId`, `invocationId`, `runId` | no       | Correlation IDs, generated when omitted. Not Provider history.                                    |

`inputs` and `agentEnv` are the only required fields. Without an explicit Adapter item, Core routes to `codex`; its configuration defaults belong to that Adapter. Core snapshots and forwards every AgentEnv item in order. Private items are agreed between the host and the consuming Adapter without registration in the public schema.

## Reading the output

Two views over one stream:

- `native` (default) — `HostFrame`: the Provider's own payload wrapped in Runtime control frames.
- `canonical` — `CanonicalEvent`: normalized across Providers. Most applications want this one.

In native mode the terminal is the `control` frame with `type: "state"`.

## Canonical event types

In canonical mode, Adapters translate each Provider's events into this one set, so a Provider-specific event name never reaches you. Native-only Adapters do not need this conversion. Every canonical event is `{ protocolVersion: 2, type, payload }`. The 24 types below are ordered by lifecycle; the payload column lists the fields you will actually read, not an exhaustive schema.

| Type                    | Group       | When it appears                                            | Key payload fields                                                                                                   |
| ----------------------- | ----------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `run.queued`            | run         | Accepted and waiting; reserved, no built-in producer today | —                                                                                                                    |
| `run.started`           | run         | Execution begins; reserved like `run.queued`               | —                                                                                                                    |
| `run.completed`         | run         | Normal end — the only success terminal                     | —                                                                                                                    |
| `run.failed`            | run         | Execution failed                                           | `message`, `code`, `adapterType`; a normalized `failure` may be attached                                             |
| `run.cancelled`         | run         | Cancelled, or the stream was aborted                       | —                                                                                                                    |
| `message.create`        | message     | A message starts                                           | `messageId`, `role`, `channel`                                                                                       |
| `message.delta`         | message     | Incremental text                                           | `text`, `channel`, `messageId`                                                                                       |
| `message.update`        | message     | Full replacement or status change                          | `text`, `status`, `messageId`                                                                                        |
| `model_step.started`    | step        | One model round begins                                     | `stepId`, `startedAtMs`                                                                                              |
| `model_step.finished`   | step        | That round ends                                            | `stepId`, `status`, `finishReason`                                                                                   |
| `tool_call.create`      | tool        | A tool call starts                                         | `id`, `name`, `args`, `status: "running"`                                                                            |
| `tool_call.delta`       | tool        | Streaming argument or output fragment                      | `id`, and one of `argsDelta`, `outputDelta`, `outputSnapshot`                                                        |
| `tool_call.update`      | tool        | Tool call reaches a terminal status                        | `id`, `status`, `output`, `error`, `exitCode`                                                                        |
| `tool_call.progress`    | tool        | Long-running progress                                      | `id`, `progress` (`message`, `completed`, `total`, `unit`)                                                           |
| `activity.started`      | activity    | Thinking, executing, waiting for approval or input         | `activityId`, `kind`, `subject`, `source`, `info`                                                                    |
| `activity.updated`      | activity    | Activity details refreshed                                 | `activityId`, `info`                                                                                                 |
| `activity.finished`     | activity    | Activity ends                                              | `activityId`, `status`                                                                                               |
| `plan.updated`          | plan        | Whole plan replaced                                        | `planId`, `revision`, `steps[]`                                                                                      |
| `run.notice`            | notice      | Retry, compaction, reroute, configuration warning          | `noticeId`, `code`, `severity`, `params`                                                                             |
| `interaction.requested` | interaction | Needs approval, an answer, or more input                   | `interactionId`, `kind`, `expiresAt`, `request`                                                                      |
| `interaction.resolved`  | interaction | Handled, expired, or invalidated                           | `interactionId`, `status`, `outcome`, `reasonCode`                                                                   |
| `session.update`        | state       | Provider session data changed                              | `providerSession`                                                                                                    |
| `execution.update`      | state       | Execution-mode evidence, for example actmode               | `actmode`                                                                                                            |
| `usage.update`          | state       | Token usage for this turn                                  | Adapter-normalized counts such as `inputTokens` and `outputTokens`, optionally `cumulative` and `modelContextWindow` |

Three rules cover the whole table:

- Exactly one terminal event per run: `run.completed`, `run.failed`, or `run.cancelled`. Nothing else is success — not a final message, not an accepted cancellation, not a process exit, not stream EOF.
- Message channels are `analysis` (reasoning, gated by `exposure`), `commentary` (in-run progress), and `final` (answer text). Final text can stream before the terminal; a consumer must observe `run.completed` before treating it as a successful answer for delivery.
- Analysis stays private unless `exposure` is `public_reasoning`, `public_summary`, or `public_plan`.

## Envelope and wire shape

A bare event carries no identity. `envelope()` adds `id`, `seq`, `tsMs`, `runId`, and `agentSessionId` when an event is persisted or forwarded; Kernel's transport wraps it in a `CanonicalHostFrame` carrying `run_id`, `invocation_id`, `stream_id`, and `session_generation`.

In canonical mode both `AgentExecutor.invoke` and `KernelClient.invoke` yield the bare event and check sequence continuity for you: a gap throws `STREAM_GAP` instead of silently skipping. Only a hand-written IPC client has to deal with the frame.

## Versions

Run contract 7, Context v3, and Adapter protocol 2 version independently. A new Context schema does not imply a new Run contract; check each side instead of assuming one bundle version covers the others.

## Import and distribution

This is a private workspace package: source and submodule hosts import `@mininglamp-oss/octo-runtime-protocol`. Published consumers use `@mininglamp-oss/octo-runtime/protocol`, which exposes a subset — not every workspace export is reachable there.

[protocol.schema.json](schema/protocol.schema.json) defines shared wire data; [kernel-ipc.schema.json](schema/kernel-ipc.schema.json) defines IPC requests and results. These are the only files in `schema/`. [gen-types.mjs](scripts/gen-types.mjs) generates [protocol-types.ts](src/generated/protocol-types.ts), including `KERNEL_IPC_VERSION` and `RUN_PROTOCOL_ERRORS` from their Schema definitions. Change the Schema and regenerate; do not hand-edit the output.

```sh
pnpm --filter @mininglamp-oss/octo-runtime-protocol gen
pnpm --filter @mininglamp-oss/octo-runtime-protocol build
```

## Validation and asset ownership

Both schemas use JSON Schema Draft-07. A standard Draft-07 validator checks standard structural constraints. The `x-octo-*` keywords describe additional semantics; a validator must implement them explicitly to enforce them. Accepting the standard keywords alone does not prove protocol conformance. Existing runtime validators also check JSON byte/depth budgets, Unicode scalar strings, uniqueness, cross-field consistency, identities, and lifecycle rules. Generated TypeScript types do not validate runtime input, and the handwritten validators remain necessary.

The seven positive/negative fixture files live in [test/fixtures](test/fixtures). They test implementations against the contract; they are not protocol definitions. Only the IPC conformance samples are intentionally published: the existing full Runtime `/executor-kernel/ipc-fixtures.json` and standalone client `/protocol/ipc-fixtures.json` imports remain available. Other fixtures stay out of release packages.

Client connection/concurrency limits, timeouts, and retry delays belong to the client implementation. They are not a shared behavior protocol or another JSON configuration source. Shared wire byte limits remain protocol constants.

## Schema cleanup upgrade notes

Issue #332 removes `kernel-client.behavior.json` and the standalone client's `/protocol/behavior.json` export. Stop importing this file; use the client API and its documented defaults. The IPC Schema identifier is now `urn:mininglamp-oss:octo-runtime:kernel-ipc:v2`; update registrations or references that used the old v1 identifier. The actual IPC version remains 2. The unused `x-octo-methods` code-generation metadata is removed; RPC methods and their request/result definitions remain.

The following legacy types are removed from the Schema, generated types, and protocol exports: `ContextSelectionEntry`, `ContextResourceEntry`, `ContextContinuityPayload`, `ChannelScope`, `ChannelMessagePart`, `ChannelMessageSender`, `ChannelMessageFlags`, `ChannelMessageFact`, `ChannelContextAppend`, `ContextSyncRequest`, `ContextSyncResult`, `ChannelContextDescriptor`, and `ContextCommitResult`. Their five validators (`assertChannelScope`, `assertChannelMessageFact`, `assertChannelContextAppend`, `assertContextSyncResult`, and `assertChannelContextDescriptor`) are also removed. Use the existing `ContextInlineEntry` and `ContextReferenceEntry` for the retained generic content shapes. Applications own channel history and synchronization contracts. These exports have no compatibility shim; callers must update their imports.

## Workspace migration

Issue #335 makes `octo.execution/workspace` path-only: `{ "path": "/absolute/prepared/project" }`. The caller must create or select an existing absolute directory before local CLI or SDK execution. Runtime does not use an implicit cwd, allocate random directories or recreate missing directories on continuation/recovery. External/preset Agents and Adapters with `metadata.workspace: false` can omit the local override; OpenClaw retains its Provider workspace.

Remove `mode` (`fixed`, `random`, `none`) and update removed `workspace_mode` receipt/projection fields, `prepareRunContext` and `WorkspaceAssignments` imports. Old mode-bearing payloads fail without compatibility conversion. Existing user directories are not deleted. `WORKDIR_REQUIRED`, `WORKDIR_INVALID`, `WORKDIR_NOT_FOUND`, `WORKDIR_NOT_DIRECTORY` and `WORKDIR_UNAVAILABLE` retain public classification `OH-ADP-3004`; see [validation and error details](../../docs/en/reference/invoke-input.md). Runtime operational directories remain distinct. The source package version and Run/Context/IPC/Adapter wire versions are unchanged; the normal release process selects the published version. Independent Gateway must migrate its old fixed-mode payload before adopting this release.

## Caller prompt migration

Issue #334 removes `octo.control/instructions`, `controlInstructions`, `ContextInstructionEntry`, `ContextInstructionsPayload`, `contextControlInstructions()` and `initialControlInstructions()` from Runtime and its public contracts. Old items and fields are rejected even when empty, without a compatibility alias. Callers prepend application prompts to ordinary input parts and decide their inclusion on new, resumed and reconstructed sessions. Primary and explicit fallback inputs must each be complete; Runtime neither adds prompts nor upgrades them to system/developer/trusted roles. MCP, environment variables and execution policy remain in agentEnv. See [session migration guidance](../../docs/en/guides/context-and-sessions.md). Independent Gateway consumers still need their own migration; this change does not claim end-to-end compatibility.

## Further reading

- [InvokeInput](src/invoke-input.ts), [workspace exports](src/index.ts), [generated types](src/generated/protocol-types.ts).
- [Input reference](../../docs/en/reference/invoke-input.md), [output and control](../../docs/en/reference/output-and-control.md), [Kernel IPC](../../docs/en/reference/kernel-ipc.md).
- [Protocol tests](test/run-protocol.test.js).
