# Codex Adapter

[简体中文](README.zh.md) | [Packages](../README.md)

Drives the bidirectional `codex app-server` protocol. Hosts explicitly create a managed owner or inject a business CodexEngineProvider; compatible calls reuse a resident app-server, initialized once per incarnation. The adapter handles invocation threads/turns, reverse requests, canonical/native output, approvals and targeted cancellation.

## When to use it

- Codex is installed and authenticated on the host.
- You want approvals and interactive questions routed back to your UI instead of pre-answered.
- You need native Provider payloads; this Adapter supports both `native` and `canonical`.

## Register the Adapter and prepare input

This excerpt registers the Adapter and prepares its input. Execute with `executor.invoke(input)`; see [Executor Core](../octo-runtime-executor-core/README.md) for consumption, terminal checks, and `shutdown()`.

```ts
import { AgentExecutor } from "@mininglamp-oss/octo-runtime/executor-core";
import { InvokeInput } from "@mininglamp-oss/octo-runtime/protocol";
import { createCodexAdapter, createManagedCodexEngine } from "@mininglamp-oss/octo-runtime/adapters/codex";

const executor = new AgentExecutor();
const owner = createManagedCodexEngine({ codexHome: "/absolute/host-codex-home" });
executor.register(createCodexAdapter({ engine: owner.provider }));

const input = InvokeInput.check({
  inputs: [{ type: "text", text: "Say hello." }],
  protocol_mode: "canonical",
  agentEnv: {
    schema: "octo.context-envelope/v3",
    items: [
      {
        namespace: "octo.execution",
        name: "workspace",
        payload: { path: "/absolute/prepared/project" }
      },
      { namespace: "octo.execution", name: "adapter", payload: { type: "codex" } }
    ]
  }
});
```

## What it binds

| Item         | Value                                                                                                                                                       |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Adapter type | `codex`                                                                                                                                                     |
| Exports      | `createCodexAdapter`, `createManagedCodexEngine` |
| Protocol     | `codex.app-server`, modes `native` and `canonical`                                                                                                          |
| Transport    | host-owned resident app-server, invocation channels borrowed by the adapter |
| Session      | explicit Provider session maps to the native thread; resume rejection or a missing rollout can trigger one fresh-thread fallback with caller-supplied input |
| Interactions | command/file approvals, user input, and MCP elicitation answered on the same active request                                                                 |

## Configuration and session ownership

The example uses approval mode `ask` and leaves reasoning effort to the Provider. Set approvals through Context `octo.security/approval_policy` and effort through `octo.execution/model.payload.reasoning.effort`. The Adapter receives the prepared internal `InvokeRequest`; see the [input reference](../../docs/en/reference/invoke-input.md) for current fields and rejected legacy configuration.

The caller saves and explicitly returns the complete `providerSession` from session updates, including Provider extension fields. Reusing the business `sessionId` alone starts fresh; Core keeps no persistent business-session-to-Provider binding table. See [Context and Sessions](../../docs/en/guides/context-and-sessions.md) for continuation and recovery input.

Compatibility includes the executable identity, argv, cwd, complete effective environment, `CODEX_HOME`, semantic MCP configuration, effective `rawMessageMaxBytes` budget and `adapter.codex/options.payload.codexServiceRevision`. Change that revision or recreate the owner when changing native configuration or credentials in place. Keys and credentials are private; process snapshots expose only ownership, PID, state and incarnation. Raw descriptor invocation requires an explicit execution scope; registering with Core binds it automatically.

An idle or active transport failure proactively replaces the owned process, with at most five replacements per recovery episode and a 90-second budget. Original business and control requests are never replayed. Startup errors such as a missing executable fail without repeated retries. Healthy operation for 60 seconds resets the recovery budget.

## Construction, Home and Ownership

createCodexAdapter({engine}) is Codex-specific. engine.acquire returns {channel, configuration}; channel.close must be idempotent and invocation-specific, while configuration contains only the MCP view. The provider coordinates shared RPC IDs, thread/turn routing and configuration rejection without exposing owner.close. Registering one descriptor in multiple Cores borrows that provider; hosts can instead create separate owners.

SDK hosts must supply an absolute codexHome. Missing/relative paths fail with CODEX_HOME_REQUIRED; invocation conflicts fail with CODEX_HOME_CONFLICT. Hosts own directory preparation, permissions and data retention. Closing or recovering a process never deletes Home. CLI chooses its own ~/.codex default. Existing business Engines may supply their own provider; closing a borrowing Kernel leaves that owner running.

The singleton, default export and old process constructor options are removed without compatibility. Other adapters choose arbitrary construction signatures without Codex types or common options. See the [SDK example](../../docs/examples/codex-service.mts) for shutdown and initialization rollback and the [architecture](../../docs/en/concepts/architecture.md).

## Limits

- In `ask` and `assisted` modes, approvals use the active interaction bridge. `full_access` automatically handles supported approvals, but does not answer user questions or MCP elicitation.
- Ordered text and image input, including image-only input, become native text and image data URLs, not host-local paths. Image support in the Adapter does not guarantee the selected model accepts images. Formats, integrity fields, and size limits follow the [input reference](../../docs/en/reference/invoke-input.md).
- The authoritative session update is reported only after turn start succeeds; the Adapter never rebuilds application history.
- A turn acknowledgement, a text chunk, or a child exit is not proof of successful completion or cleanup.
- In native mode you must read Runtime control frames alongside Provider payloads.
- Each managed owner admits at most eight service configurations; each service admits eight distinct active threads. A concurrent turn on the same thread is rejected. Startup/recovery waiters are bounded to 128 and 32 MiB; completed-thread routing history is bounded to 4096 distinct threads per incarnation. Capacity errors never evict a healthy service.
- A nullable-turn elicitation can be routed on the first active subscription. On a reused thread its causality cannot be established, so the Adapter rejects it explicitly.
- A nonempty completed `final_answer` with no open work or synchronous interaction can complete after a 15-second finalization fallback. Cancellation, Provider error and subsequent work invalidate eligibility. Turn cleanup remains independently observable and can fail after the result is completed.

Human approval capacity counts requests awaiting a decision per invocation, up to 256. Request 257 receives an explicit rejection while admitted approvals remain valid. A valid decision releases its slot immediately; automatic approvals consume no human slots. Questions and MCP elicitations retain a separate limit of 16 unfinished requests. `full_access` keeps Codex's `untrusted` policy and lets Runtime handle supported approvals automatically, preserving dynamic MCP behavior.

All stdin frames for one app-server share a bounded writer: 4096 normal entries / 64 MiB, including the active frame, plus a reserve of 8 entries / 64 KiB for protocol rejections and interrupts. Human-capacity rejections use the normal queue so an ordinary overflow burst cannot exhaust the small control reserve. It waits for each write callback and, when `write` returns false, for `drain`. Five seconds without write progress or 30 seconds since enqueueing fails delivery. The human decision deadline remains 10 minutes. Resolved confirms a successful local write callback, not Provider receipt or tool completion. Cancellation removes only the invocation's queued responses; bytes already handed to the pipe cannot be recalled.

Structured local capacity, write, and timeout causes take precedence over unrelated plugin Unauthorized stderr. Native `HOST_EXECUTION_FAILED.failure` and canonical failures preserve the same cause; actual Provider authentication rejection retains its credential classification.

## Owned process cleanup

Default POSIX spawning creates an owned, independent process group. Cleanup awaits bounded `SIGTERM` → `SIGKILL` escalation and group-exit confirmation, including when the app-server leader has exited but tools remain. An injected `spawnFn` child is not assumed to own a process group; its cleanup targets the direct child.

Normal completion, Stop and business consumer closure release the invocation subscription. Core.shutdown releases local scopes and leases. The host calls owner.beginShutdown(), awaits Core/Kernel cleanup, then owner.close({deadline}) and checks complete. The deadline is absolute performance.now() milliseconds. owner.processes() and Kernel serviceProcesses snapshots never start or probe a Provider.

Default owned spawning enables Windows process-tree cleanup through the existing system command. Injected children receive direct-child cleanup. Windows tree cleanup depends on a still-identifiable leader; leader-first exit, host crashes and escaped descendants remain outside a full descendant-exit guarantee. Check cleanup results rather than treating cancellation acknowledgement as exit proof.

See [Output and Control](../../docs/en/reference/output-and-control.md) for execution terminals and cancellation, and [Executor Core](../octo-runtime-executor-core/README.md) for `shutdown()` cleanup results.

## Import and distribution

Private workspace package, included in the CLI distribution. External consumers import `@mininglamp-oss/octo-runtime/adapters/codex`; there is no individual npm package.

## Further reading

- [Implementation](src/index.ts), [Adapter SDK](../octo-runtime-adapter-sdk/README.md), [Runtime Protocol](../octo-runtime-protocol/README.md).
- [Input reference](../../docs/en/reference/invoke-input.md).
