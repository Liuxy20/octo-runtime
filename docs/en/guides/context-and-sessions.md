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

## Prepare Context for the Next Turn

Your application decides whether the next turn needs all background, changed material only, or no background. Runtime does not restore omitted items from a session or content hash.

Use [Context configuration merging](../reference/contexts.md) for fixed defaults. With Channel Gateway, use the [Extra's `loadContexts`](extras.md) to read current business data before each invocation. Neither mechanism automatically restores chat history.

Sources: [input preparation](../../../packages/octo-runtime-executor-core/src/invoke-input.ts), [renderer](../../../packages/octo-runtime-executor-core/src/model-input.ts), [environment](../../../packages/octo-runtime-adapter-sdk/src/environment.ts).
