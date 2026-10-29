# Supply Background and Continue Sessions

[简体中文](../../zh-CN/guides/context-and-sessions.md) | [Documentation](../README.md)

## Business Material

Put the material needed for this turn in `contexts.items`. Choose from these types:

- `octo.content/inline`: text supplied directly, such as a selected document passage.
- `octo.content/references`: a resource address and retrieval instructions, such as a document ID and an MCP tool that can read it.
- `extra.<domain>/<name>`: application-specific structured data, such as `extra.project/selection`.

See [Inputs and Contexts](../concepts/inputs-and-contexts.md) for a complete invocation. Runtime formats `guidance` and `payload` as background text in item order. It does not automatically extract business fields or summarize the material.

When supplying references, your application also needs to provide a working retrieval tool, such as a configured MCP tool or an installed business CLI. Runtime does not fetch referenced content automatically. Access depends on the tool and server permissions.

`guidance` describes how to use the material and remains ordinary background text. Labeling it "system" or "SOUL" does not make it a Provider session instruction. Use `octo.control/instructions` with an application-authorized source for session instructions.

## Images

Put image data in `inputs`. The shared [imagePart function](../../examples/image.mts) reads an image file and creates an image object with base64 data, byte size, and SHA-256.

Order the array as you want the message presented: for example, a text object saying "Summarize this image" followed by the image object. Choose an Adapter that supports image input. Unsupported images fail the invocation rather than being converted to text. See [InvokeInput](../reference/invoke-input.md) for size limits.

## Invocation Environment

Use `octo.execution/envs` to set environment variables for this invocation. Its `payload.env_variables` is an array of `{key, value}` objects. Values may be empty strings. Duplicate or invalid names, and values containing NUL, fail validation. These variables are not added to model text, but remain in the submitted Context object.

To pass environment variables outside Context, put `executionEnvOverrides` in the second argument of `client.invoke(input, environment)`. These values override variables with the same names in Context. See [InvokeInput](../reference/invoke-input.md) for the structure, precedence, and limits.

Both mechanisms apply only to this invocation. They do not modify the global `process.env` or update an already running Provider. OpenClaw does not accept nonempty environment variables through individual invocations; configure its environment when deploying the Gateway instead.

## Session Continuation

`sessionId` is your application's conversation ID. The Provider has its own session information in `providerSession`. To continue a conversation, save and resubmit that information; reusing `sessionId` alone is insufficient.

1. When consuming canonical output, read `payload.providerSession` from `session.update` events.
2. Save the complete object, including Provider extension fields.
3. On the next invocation, supply the same business `sessionId`, the saved `providerSession`, and `continuityMode: "continue"`.
4. Check the returned session's `resumeOutcome` and `contextInputVariant` to see whether the session resumed or fell back to a new one.

If your application uses `sessionGeneration` or `providerEpoch` to prevent old requests from overwriting newer session data, preserve those fields on continuation too.

For a new Provider conversation, use `continuityMode: "fresh"` and omit `providerSession`.

Some Adapters can fall back to a new session when resuming fails. Use `freshFallbackModelInput` or `freshFallbackModelInputParts` to supply the history that new session needs. Runtime does not retrieve or reconstruct history for your application. If required historical images are unavailable, set `freshFallbackImagesUnavailable: true` to prevent continuing that recovery without them.

To change session instructions, have your application create or reset the Provider session.

## Channel Gateway History

Gateway prepares automatic IM history before invoking the model, using the message API directly. It selects at most 20 recent messages before the current trigger in the same DM, group, or topic. Messages are presented oldest first as `{uid, username, sentAt, content}`. The complete serialized `messages` array has an 8,000-Unicode-code-point budget, including names, original timestamps, JSON keys, and escaping. Bodies may therefore be shorter than 8,000 characters. Retrieval does not download referenced media.

| Situation | Automatic history behavior |
| --- | --- |
| First input, `/reset`, or `/new` | One cold-start attempt; retain own Bot messages within the bounded window. Preparation failure preserves the attempt; empty or failed history handed to execution consumes it. |
| Normal group/topic continuation | Read an observed history gap; no gap means no read. Omit a specific own final reply or related file card only when completion, session ownership, successful delivery position, and unchanged content prove assistant coverage. |
| Recovery or uncertain continuity | Retain own messages. If a prepared continuation falls back to a fresh Provider session, restore omitted messages through the existing fallback input in the same invocation. |
| Retry of the same occurrence | Reuse frozen primary and fallback input; do not query again. |

Cold-start and gap preparation share one bounded read. Gateway budgets the full window before partitioning primary history and recovery supplements; their union stays within 20 messages and 8,000 serialized code points. Omitting a message does not refill the window. Matching UID, text, or URL alone never justifies removal; quoted/forwarded content and explicit host Context remain intact.

This policy belongs to Gateway and applies across Providers. Runtime does not add a transcript database or infer that the model has read every supplied message. See [architecture](../concepts/architecture.md) and [history representation](extras.md).

## Readable Session Names

Set optional `sessionName` when creating a conversation, and keep it with your application binding. Names contain 1–256 Unicode code points, cannot consist only of whitespace, and cannot contain C0/DEL/C1 control characters. Colons, hyphens, underscores, spaces within text and non-ASCII text are allowed; valid input is preserved unchanged. Each caller owns its naming policy: for example, `wecom-{uuid}` or `webui-{uuid}`. Core supplies a random UUID when omitted. Host SDK and Kernel forward the field without inventing business naming rules or keeping a name registry. Names never serve as recovery handles, authorization, or model input. Two conversations with the same name remain separate; changing a name on resume does not select or rename a native session.

Channel Gateway generates `octo-dm-{uid}-{uuid}`, `octo-group-{groupId}-{uuid}`, or `octo-group-{groupId}-topic-{topicId}-{uuid}`. It preserves the name in the existing scoped binding across turns, retries and idle scheduler cleanup. `/reset` and `/new` discard that binding and allocate a new name with the next normal message. Existing unnamed bindings receive a name without changing their Provider handle. The current store's retention and persistence guarantees still apply.

| Adapter | New native conversation | Continuation |
| --- | --- | --- |
| OpenClaw | Readable `agent:{agentId}:` key with an independent random suffix; the Provider envelope keeps its colons. | Reuses the exact returned key, checks existence with `sessions.describe`, applies this turn's version-specific permission policy, then subscribes and runs. Missing/mismatched handles fail without creating a replacement. Old explicitly supplied `resumable: false` handles may resume if they still exist. |
| Codex | `thread/name/set` after creating a thread, including fresh fallback. A rejected name request fails before starting the new turn. | Existing `thread/resume`; native ID and title stay unchanged. |
| Claude Code | `--name` on new sessions; requires a CLI version supporting that option. | Existing `--resume` with the opaque native UUID. |
| Generic ACP | No standard title setter; a fresh session emits a `provider_diagnostic` notice that the name was not applied. | Existing `session/load` / `session/new` and recovery behavior. |
| CodeBuddy ACP / Grok Build ACP / other adapters | This change does not add native title mapping; readable naming is unsupported. | Existing provider-specific recovery behavior is unchanged. |

Native naming was checked with Codex 0.164.0, Claude Code 2.1.306 and OpenClaw 2026.9.4. OpenClaw request projections also cover its existing 27 verified release contracts; that is source-level coverage, not live testing of every release. See the [task validation](../../../.octospec/tasks/224-session-names/validation.md).

During OpenClaw continuation, approvals must identify the current native run. Previously observed runless approvals are ignored. A first-seen approval without `runId` after dispatch fails with `OPENCLAW_APPROVAL_RUN_UNVERIFIED` and requests cancellation of the current run without answering the approval, changing permissions, or creating another session. This applies to both `ask` and `full_access`: a shared session key alone cannot prove turn ownership. Gateway versions omitting `runId` on legitimate approvals cannot complete that continuation approval path. Fresh sessions with independently random keys retain runless approval support; ordinary turns without such approvals still reuse the same session. A cancellation request alone does not confirm that the Provider has stopped.

## Prepare Context for the Next Turn

Your application decides whether the next turn needs all background, changed material only, or no background. Runtime does not restore omitted items from a session or content hash.

Use [Context configuration merging](../reference/contexts.md) for fixed defaults. With Channel Gateway, use the [Extra's `loadContexts`](extras.md) to read current business data before each invocation. Neither mechanism automatically restores chat history.

Sources: [input preparation](../../../packages/octo-runtime-executor-core/src/invoke-input.ts), [renderer](../../../packages/octo-runtime-executor-core/src/model-input.ts), [environment](../../../packages/octo-runtime-adapter-sdk/src/environment.ts).
