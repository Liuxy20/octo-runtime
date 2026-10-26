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
  contexts: {
    schema: "octo.context-envelope/v3",
    items: [{ namespace: "octo.execution", name: "adapter", payload: { type: "dsh" } }]
  }
});
```

`check` throws on a malformed shape or an oversized payload and returns the same object. It calls nothing and generates nothing: Core and Kernel fill in `invocationId`, `runId`, and `sessionId` when you omit them, so keep the returned IDs if you want to cancel or correlate the run later.

## The fields that matter

| Field                                | Required | What it does                                                                                      |
| ------------------------------------ | -------- | ------------------------------------------------------------------------------------------------- |
| `inputs`                             | yes      | This turn's text and image parts, in order. Image bytes go here once.                             |
| `contexts`                           | yes      | Context v3 envelope. Its `octo.execution` / `adapter` item selects the Adapter; empty is legal.   |
| `workdir`                            | no       | Provider working directory. Defaults to the host workspace; it is not a sandbox.                  |
| `protocol_mode`                      | no       | `native` (default) or `canonical`.                                                                |
| `providerSession`                    | no       | Explicit Provider session to resume. Never rebuilt from `sessionId`.                              |
| `agentConfig`                        | no       | Full Provider configuration, including `providerOptions`. Must agree with the Context selections. |
| `runtimeLimits`                      | no       | Timeouts and enforcement for this turn; execution defaults apply when omitted.                    |
| `sessionId`, `invocationId`, `runId` | no       | Correlation IDs, generated when omitted. Not Provider history.                                    |

`inputs` and `contexts` are the only required fields, but a request without the `octo.execution` / `adapter` item fails before any Provider starts.

## Reading the output

Two views over one stream:

- `native` (default) — `HostFrame`: the Provider's own payload wrapped in Runtime control frames.
- `canonical` — `CanonicalEvent`: normalized across Providers. Most applications want this one.

In native mode the terminal is the `control` frame with `type: "state"`.

## Canonical event types

Adapters translate each Provider's events into this one set, so a Provider-specific event name never reaches you. Every canonical event is `{ protocolVersion: 2, type, payload }`. The 24 types below are ordered by lifecycle; the payload column lists the fields you will actually read, not an exhaustive schema.

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

[protocol.schema.json](schema/protocol.schema.json) is the wire source of truth. [gen-types.mjs](scripts/gen-types.mjs) generates [protocol-types.ts](src/generated/protocol-types.ts): change the schema, regenerate, and never hand-edit the generated types.

```sh
pnpm --filter @mininglamp-oss/octo-runtime-protocol gen
pnpm --filter @mininglamp-oss/octo-runtime-protocol build
```

## Further reading

- [InvokeInput](src/invoke-input.ts), [workspace exports](src/index.ts), [generated types](src/generated/protocol-types.ts).
- [Input reference](../../docs/en/reference/invoke-input.md), [output and control](../../docs/en/reference/output-and-control.md), [Kernel IPC](../../docs/en/reference/kernel-ipc.md).
- [Protocol tests](test/run-protocol.test.js).
