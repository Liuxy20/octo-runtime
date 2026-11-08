# Identifiers, Sessions and Interruption

[简体中文](../../zh-CN/concepts/identifiers.md) | [Documentation](../README.md)

These identifiers describe different objects and are not interchangeable. Most applications persist their business sessionId and the complete providerSession returned by the Provider. A run handle's invocationId targets interruption and interactions precisely.

| Identifier | Meaning and lifetime | Producer and owner | Purpose / wire name |
| --- | --- | --- | --- |
| sessionId | Application conversation spanning multiple invocations | Application generates/persists it; otherwise client generates run.sessionId | Business correlation; agent_session_id on wire. Does not resume a Provider or select the latest run to stop |
| invocationId | Control identity of one invocation | Client generates run.invocationId immediately; advanced content may provide it; client tracks it within bounded capacity | interrupt/respondInteraction; invocation_id on wire, not a Provider turnId |
| runId | Business/tracing identity of one execution | Client default or explicitly supplied/persisted by the application | Logs/business records; run_id on wire, not the interruption ID |
| providerSession | Opaque native resume handle with Provider extensions | Provider/Adapter emits session.update; application saves the entire object and supplies it next turn | Actual Provider continuation; its nested sessionId is unrelated to business sessionId |
| sessionName | Human-readable display name | Application supplies it; Core defaults to UUID | Display only; no merging, authorization or resume decision |
| sessionGeneration | Application conversation generation | Application maintains it on reset; receipt defaults to 0 | Fence stale updates; session_generation on wire; Runtime does not choose reset policy |
| providerEpoch | Application version of the Provider binding | Application maintains it; omission does not infer a version | Fence stale binding writes, not a native session ID |
| stream_id | One accepted execution source stream | Core generates it on admission; retained in RunRef | Resume observation of the original stream; checked with invocation and Kernel instance |
| seq | Contiguous sequence within that stream | Execution source assigns; subscriber saves last observed value | Continue after after_seq; explicit handling of gaps/expiry |
| kernel_instance_id | One Kernel startup instance | Kernel generates at startup; client retains in RunRef | Reject stale references after restart; does not restore executions |
| JSON-RPC id | One request/response correlation ID | Client generates per RPC | Matches that response only, not execution identity |
| interactionId | Unified identity of a current interaction | Adapter/source emits it; application reads event | Answer original interaction; executionInstanceId maps to invocationId. Native requestId remains Provider-defined |

For sessionId `chat-42`, two calls get invocation IDs A and B and may reuse the same Provider session. A delayed Stop still invokes interrupt(A); it must never be retargeted to the newest call B.

invoke captures identity and inputs before first consumption. Before submission, an accepted interruption prevents local sending and iteration fails with an error recognized by isInvocationNotSubmitted. After submission, cancellation follows the complete original reference. Lost ACKs report an unknown outcome; no automatic control retry or re-execution occurs. Cancellation acknowledgement, execution terminal and resource cleanup are separate facts.

Core owns the unified interruption contract; the Adapter maps it to native cancellation, such as Codex threadId/turnId. Applications do not compose Provider messages or pass native turnId to the client. Closing an iterator/socket only stops observation. Owner stopAdmission/drain/close handles owned calls. Another client cannot interrupt a registration it does not own; advanced low-level cancel(ref) remains the responsibility of callers holding the complete RunRef.

See [Invoke API](../reference/invoke-input.md), [IPC](../reference/kernel-ipc.md) and [execution/control](../reference/output-and-control.md).


## providerEpoch Versus agentEnv

providerEpoch represents an application-defined Provider binding version, not an execution-configuration fingerprint. Each invocation snapshots agentEnv, but later calls in the same session may explicitly use different configuration. Changing effort, refreshing credentials or selecting a workdir does not automatically require an epoch increment. Replacing the Adapter, account or server identity domain owning the Provider session requires the application to isolate old forms and late updates.

AsyncQuestionReply compares the snapshot and continuation providerEpoch values. Hosts using this field must save the original value when the question is created. Both values being absent passes the comparison; it means no epoch protection, not SDK confirmation of an unchanged binding. Hosts omitting it still own invalidation of forms for replaced bindings. See [continuation configuration](../reference/output-and-control.md).
