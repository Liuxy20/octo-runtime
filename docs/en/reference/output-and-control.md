# Output and Control

Extras use `context.execution` in both direct and IPC modes. Ending observation does not cancel admitted work; explicit cancellation and Extra shutdown do. A terminal event is separate from resource cleanup: direct Extra shutdown also awaits the Core's first cleanup result for the exact accepted receipt. Raw Core iterator closure retains its cancellation semantics.

[简体中文](../../zh-CN/reference/output-and-control.md) | [Documentation](../README.md)

## Output Modes

Use `protocol_mode` to select the return format of `client.invoke`:

- `canonical` returns common `CanonicalEvent` objects, allowing the same application code to handle different Providers.
- `native` returns `HostFrame` objects with Provider-native messages and Runtime control information, for applications that need the native protocol.

The default is `native`, but some Adapters support only `canonical`. For most integrations, explicitly set `protocol_mode: "canonical"`. Once an invocation starts, reconnection must use its original mode.

## Determine When Execution Ends

For canonical output, check the final event: `run.completed` means success, `run.failed` means failure, and `run.cancelled` means cancellation. Execution failures may arrive as events without throwing, so handle events as well as errors thrown while reading. [invokeOnce](../../examples/invoke.mts) demonstrates both.

For HostFrame output, use public `isHostTerminal` to identify Runtime's final status. States are `running`, `completed`, `failed`, `cancelled`, and `lost`. Runtime reports its final status after execution cleanup; a Provider's end message alone does not mean Runtime has finished processing.

`lost` means the execution outcome cannot be determined; KernelClient reports `RUN_OUTCOME_UNKNOWN`. Do not treat a missing final status, missing output, or cleanup failure as success. Your application separately confirms whether results were saved, messages delivered, or the UI updated.

## HostFrame Structure

HostFrame includes execution and session identifiers: `run_id`, `invocation_id`, `stream_id`, `agent_session_id`, and `session_generation`, plus `protocol_mode` and `protocol`. Its `seq` starts at 1 and identifies the output position for reading after a disconnect.

There are three frame kinds: `native` preserves Provider data and extension fields, `canonical` holds a common event in `event`, and `control` reports state, errors, interaction status, and missing output. All three share the same `seq` numbering. If implementing an IPC client, save frame sequence numbers rather than counting canonical events to determine your position.

## Cancellation

There are two ways to cancel:

- Pass an `AbortSignal` to `client.invoke(input, {signal})`, then call `abort(reason)` on its `AbortController`.
- Call `cancelInvocation(invocationId, reason?)` on the same client that started the invocation. Set `invocationId` in the input first so other application code can refer to it.

Cancellation before sending prevents submission. After sending, the client finds the original execution and requests cancellation while continuing to receive remaining output. With an aborted signal, normal completion of reading throws the original cancellation reason. A more specific output or control error encountered while reading takes precedence.

The cancellation API returns `{accepted}` to indicate whether the cancellation request was accepted. Keep reading output to learn whether execution ultimately cancelled. For KernelClient, loop `break`, iterator `return()`, client `close()`, and subscription cancellation only stop receiving output. They do not cancel execution. Closing a direct AgentExecutor execution iterator early does request cancellation.

## Reply to Approvals and User Questions

> **Extra compatibility requirement:** Check `payload.delivery` before registering or presenting an interaction. `delivery: "async"` is optional supplemental input, not a blocking question. Do not route it into an existing synchronous form, `/respond` command, or waiting-state handler without implementing the async contract below.

In canonical mode, `interaction.requested` carries `interactionId`, `executionInstanceId`, and `request`. Its `kind` is `approval`, `question`, or `elicitation`, which requests additional user information. Synchronous requests require `expiresAt` (an ISO timestamp); async questions may omit it. The following response flow describes synchronous interactions:

1. Present `request` in the application's interaction UI.
2. Collect the user's decision or answer.
3. Call `client.respondInteraction(invocationId, response)` on the original client.
4. Continue reading events until execution ends.

The shared [interaction example](../../examples/interactions.mts) follows this flow with an application-supplied decision function. Do not automatically approve requests based on ordinary Context text.

An approval response contains `{interactionId, outcome}`, for example `accepted`, `declined`, or `cancelled`. Questions and elicitation use `outcome: "answered"`, with `value` filled according to the request. See the [InteractionResponse type and validator](../../../packages/octo-runtime-protocol/src/index.ts) for the exact format. Responses must match the original request without expanding its permission scope.

In native mode, save the Provider request ID and call `respondNativeInteraction(invocationId, {requestId, payload})`. The `payload` must match that Provider's response format for the pending request. The Driver still manages initialization and the current turn. This API cannot start another turn or change accounts, global configuration, or arbitrary threads.

HostFrame control messages report interaction states: `pending`, `resolved`, `expired`, and `invalidated`. A pending control uses a Unix timestamp in milliseconds for its deadline. After a response is accepted, subsequent notifications update its state. Replies fail if the request expired, was already answered, belongs to an old execution, uses the wrong mode, or its execution ended. Cancellation or execution loss also invalidates pending interactions.

The `full_access` policy can handle supported approvals, but does not answer user questions or requests for additional information.

### Async Question Contract

Codex can emit `interaction.requested` with `kind: "question"` and `delivery: "async"` while continuing work. Keep reading events while the form is open. Its request is `{schema: "octo.question-request/v1", messageId, questions: [{id, title, options, allowCustom: true}]}`. Options may be `null` or empty; custom text is always allowed. The original request and host-owned pending state authorize a reply; a message snapshot alone does not. Associate both by `messageId` to display one form.

Submit the entire batch once: `outcome: "answered"`, `value: {schema: "octo.question-response/v1", answers: [{questionId: "q:0", text: "option or custom answer"}]}`. Supply every positional question ID exactly once. Each answer must be nonblank and at most 4096 Unicode code points. See [asyncQuestionForm](../../examples/interactions.mts), which imports only public SDK APIs.

Runtime sends one `turn/steer` to the original active turn. The Promise succeeds and `interaction.resolved` reports `resolved/answered/provider_accepted` only after a matching RPC reply. This proves acceptance, not persistence, model consumption, or task completion. `ASYNC_ANSWER_REJECTED` means explicit rejection; `OPERATION_OUTCOME_UNKNOWN` means sent but unconfirmed. Do not automatically retry either. `INVALID_QUESTION_RESPONSE` permits correction before sending; `INTERACTION_NOT_ACTIVE` rejects duplicate or inactive answers.

Async ask is optional supplemental input. Leaving it unanswered does not block completion. The public `/executor-kernel` `AsyncQuestionReply` steers the original active run, or uses the existing `client.invoke` to create a new AgentRun after confirmed normal completion. The host supplies current continuation input with the same session/generation/provider binding and its current Context/configuration. The SDK assigns new execution IDs and replaces input with the original questions and answers. Codex continuation sets `providerSession.requireResume=true`: failed resume fails instead of starting a fresh provider session.

A `route: "steer"` response confirms provider acceptance. A `route: "new_run"` response supplies an `events` stream: consumption starts submission, and returning the stream does not confirm delivery. Runtime admission, provider acceptance, model consumption, and completion are separate facts. See [asyncSupplementForm](../../examples/interactions.mts). Low-level respond still targets active runs only.

Async questions have no default expiry; optional `expiresAt` is enforced, while synchronous interactions still require a deadline. Cancellation dismisses the form without cancelling model work. A single host controller owns storage and calls `observe` on original terminal/interaction frames before saving `snapshot()`. A persisted pending/completed snapshot can start a continuation after restart; a running or unknown submission cannot be replayed. Reset generations and changed provider bindings reject stale forms. Unknown steer delivery never falls back to a new Run or retries. The SDK provides neither a host database transaction nor exactly-once delivery across controllers.

The shared limit is 16 active interactions, with at most 50 questions per batch, 50 options per question, and 4096 code points per title/option. Oversized or malformed snapshots fail explicitly. Synchronous questions, elicitation, approvals and `full_access` behavior remain unchanged. Host UI integration is still required; no Markdown parsing is needed.

### Required Handling in Extras

**Every Extra that consumes interaction events must explicitly choose one of these policies:**

- **Without async form support:** Ignore async `interaction.requested` before interaction registration, secret-input handling, command/card generation, or waiting-state projection. Track its `interactionId` within the original Run and also ignore its `interaction.resolved`, which does not carry `delivery`. Continue consuming the stream, advance the original cursor, and display ordinary message text. Do not submit an automatic answer, pause execution, or let an ignored resolution clear a synchronous interaction's waiting state. Bound and clean up the identity tracking with the Run.
- **With async form support:** Preserve the original request, question IDs, provider/session binding and submission state. Collect a complete `octo.question-response/v1` batch, support custom text and cancellation, and use the public `AsyncQuestionReply` lifecycle above. Handle expiry, duplicate submissions, stale bindings, restart and unknown delivery explicitly. Active runs use steer; confirmed normal completion permits a new AgentRun in the same session. Report delivery only when the provider accepts it.

**Do not remove expiry checks or pass a plain answer string to make an old synchronous handler appear compatible.** Missing async `expiresAt` is valid, not evidence of expiry; async replies require the structured batch. `delivery` controls this distinction, not `kind`, `full_access`, message wording, or the presence of options. `responseRequired: false` is reserved for automatic approvals and is not an async-question discriminator.

The built-in `channel-gateway`, `channel-wecom` and `webui` use the first policy: they display message text without async forms, answer commands, or waiting-state changes. Their synchronous questions, approvals and elicitation keep their existing behavior. New Extras and custom interaction renderers must make this choice explicitly; receiving the public protocol does not provide async UI support automatically. See [Extra development](../guides/extras.md).

## Errors and Recovery

Record the error object's stable code before choosing recovery. For example, fix parameters for input errors and query the original execution after an output disconnect. If a submission receipt is lost, the Provider may already be working; retrying `invoke` can execute the task twice. See [Kernel IPC](kernel-ipc.md) for reconnection and [Troubleshooting](../guides/troubleshooting.md) for common errors.

Sources: [frame validation and canonical view](../../../packages/octo-runtime-protocol/src/run-protocol.ts), [event types](../../../packages/octo-runtime-protocol/src/index.ts), [Kernel client](../../../packages/octo-runtime-executor-kernel/src/client.ts).
