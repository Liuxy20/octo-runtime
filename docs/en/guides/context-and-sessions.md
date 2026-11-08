# Execution Environment, History and Sessions

[简体中文](../../zh-CN/guides/context-and-sessions.md) | [文档目录](../README.md)

Applications own reusable agentEnv configuration; each invocation captures its own snapshot. It describes execution and contains no message history. Gateway/applications select history, group rules and materials and submit them as inputs. Runtime does not require extra.im, XML or another business format.

sessionId identifies an application conversation. Repeating it does not resume a Provider. Save the complete providerSession from session.update and pass it explicitly, preserving opaque extension fields. Never reconstruct providerSession from the business ID.

A conversation may contain many invocations, each with a distinct invocationId. Bind Stop to run.invocationId and use the same client's interrupt method; a delayed stop must not target the next invocation. Core forwards interruption to the owning Adapter, which maps it to native turn/interrupt, query interruption or process cancellation. Callers do not need native turnId values.

Reset is a business operation, separate from cancellation. Applications update sessionGeneration/providerEpoch and fence stale updates. Gateway retains generation isolation, bounded history and explicit recovery content. Execution, observation or delivery failures do not automatically authorize replay.

Owner shutdown stops admission, drains executions and business work under a shared deadline, then closes the client. Interruption ACK, execution terminal, delivery and Adapter cleanup are separate facts.

See [identifiers](../concepts/identifiers.md) and [input reference](../reference/invoke-input.md).
