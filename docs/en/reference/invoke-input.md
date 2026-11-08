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

The schema/items envelope is unchanged. Allowed items are octo.execution/*, octo.security/approval_policy and octo.control/instructions; business material is rejected. Use workspace for cwd, adapter for Adapter selection, model for model/effort, envs for variables, mcp for connections, approval_policy for approvals and limits for execution budgets.

Advanced agentEnv fields are agentSource, workdir, controlInstructions, approvalMode, agentConfig and runtimeLimits. They are no longer top-level InvokeInput fields and must agree with corresponding item selections. agentConfig.providerOptions belongs to the selected Adapter. OpenClaw adapter items explicitly specify provider_agent_id, commonly main.

## Content and recovery

InvocationContent requires parts and supports protocol_mode (default native), invocationId, runId, sessionName, sessionGeneration, providerEpoch, prompt, modelInput, runMetadata, continuityMode, freshFallbackModelInput, freshFallbackModelInputParts and freshFallbackImagesUnavailable. The application or client supplies tracing IDs; do not infer them from Provider IDs.

Image parts carry type/image, mimeType, base64 data, byteSize and sha256. Inputs contain 1–128 parts. The whole IPC request is limited to 32 MiB, counting primary and recovery content separately. Applications freeze recovery material explicitly; Runtime does not rebuild history. Use freshFallbackImagesUnavailable when historical image bytes cannot be supplied rather than silently falling back to text.

## Low-level IPC v2

CLI JSON and client.submit use InvokeInput: `{ inputs, sessionId?, providerSession?, agentEnv, ...contentAndTracing }`. InvokeInput.check validates the boundary; Core resolves execution settings. Low-level submit/subscribe users own complete RunRef, cancellation and tail observation; these calls do not join the invoke registry.

Old invoke(request, environment), cancelInvocation, contexts and top-level execution settings are incompatible. The client requires IPC v2. Upgrade Runtime/client before deploying Gateway. Internal Core/Adapter InvokeEnvironment.signal still carries cancellation; it is not a public invoke argument.

Sources: [protocol](../../../packages/octo-runtime-protocol/src/invoke-input.ts), [client](../../../packages/octo-runtime-client/src/client.ts). See [identifiers](../concepts/identifiers.md).
