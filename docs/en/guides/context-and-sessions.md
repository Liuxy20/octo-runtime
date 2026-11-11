# Execution Environment, History and Sessions

[简体中文](../../zh-CN/guides/context-and-sessions.md) | [文档目录](../README.md)

Applications own reusable agentEnv configuration; each invocation captures its own snapshot. It describes execution and contains no message history. Gateway/applications select history, group rules and materials and submit them as inputs. Runtime does not require extra.im, XML or another business format.

Applications also own startup prompts. Prepend the desired text as ordinary input parts before invoking Runtime; their order relative to business text and images is preserved. Runtime does not provide a portable system/developer prompt field, assign a trusted role, or add prompt text or separators.

| Path | Caller responsibility |
| --- | --- |
| New Provider session | Supply all prompts and material needed for this call in the primary input. |
| Continued Provider session | Explicitly decide whether to include, refresh or omit application prompts. Runtime does not make this decision from session identity. |
| Failed resume with fresh-session fallback | Supply the complete desired fallback text/parts, including prompts, recovery history and image bytes. Runtime does not reconstruct or add them. |
| Retry of the same prepared input | Reuse its frozen content; do not prepend the same application prompts again. Observation recovery is not a new invocation. |

If modelInput overrides the textual turn, it must already contain the desired prompts. The same applies to freshFallbackModelInput and freshFallbackModelInputParts. Historical images that cannot be restored must be declared unavailable rather than silently omitted. MCP and environment values remain execution settings and must not enter prompt text.

Migration removes `octo.control/instructions`, `controlInstructions`, their payload types and instruction helpers, with no compatibility alias. Old items/fields are rejected even when empty. The independently maintained Channel Gateway still uses the old item and requires a separate migration before adopting this Runtime/client release; this repository change does not establish end-to-end Gateway compatibility. Run 7, Context v3, IPC 2 and Adapter transport 2 retain their current numbers; the package release version is selected by the existing release process.

sessionId identifies an application conversation. Repeating it does not resume a Provider. Save the complete providerSession from session.update and pass it explicitly, preserving opaque extension fields. Never reconstruct providerSession from the business ID.

The caller also owns its working directory. Supply the chosen, already existing absolute path on every local invocation, including continuation and explicit fresh recovery. Runtime does not allocate a random workspace, inherit cwd, or recreate a deleted directory. `WORKDIR_NOT_FOUND` remains a failure on recovery; choosing or preparing another directory requires an application decision. Remove workspace `mode` and use the path-only payload. A caller-created temporary directory has the same lifetime responsibilities as any other workspace; keep it until executions and owned cleanup complete. Runtime Home/logs/IPC are separate. See [workdir errors and external-Agent exceptions](../reference/invoke-input.md).

A conversation may contain many invocations, each with a distinct invocationId. Bind Stop to run.invocationId and use the same client's interrupt method; a delayed stop must not target the next invocation. Core forwards interruption to the owning Adapter, which maps it to native turn/interrupt, query interruption or process cancellation. Callers do not need native turnId values.

Reset is a business operation, separate from cancellation. Applications update sessionGeneration/providerEpoch and fence stale updates. Gateway retains generation isolation, bounded history and explicit recovery content. Execution, observation or delivery failures do not automatically authorize replay.

Owner shutdown stops admission, drains executions and business work under a shared deadline, then closes the client. Interruption ACK, execution terminal, delivery and Adapter cleanup are separate facts.

See [identifiers](../concepts/identifiers.md) and [input reference](../reference/invoke-input.md).
