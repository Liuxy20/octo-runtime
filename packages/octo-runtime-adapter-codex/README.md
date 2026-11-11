# Codex Adapter

[简体中文](README.zh.md) | [Packages](../README.md)

Drives the bidirectional `codex app-server` protocol. Hosts explicitly create a managed owner or inject a business CodexEngineProvider; all calls to one managed owner reuse its single resident app-server, initialized once per incarnation. The adapter handles invocation threads/turns, reverse requests, canonical/native output, approvals and targeted cancellation.

## When to use it

- Codex is installed and authenticated on the host.
- You want approvals and interactive questions routed back to your UI instead of pre-answered.
- You need native Provider payloads; this Adapter supports both `native` and `canonical`.

## Register the Adapter and prepare input

This excerpt registers the Adapter and prepares its input. Execute with `executor.invoke(input)`; see [Executor Core](../octo-runtime-executor-core/README.md) for consumption, terminal checks, and `shutdown()`.

```ts
import { AgentExecutor } from "@mininglamp-oss/octo-runtime-executor-core";
import { InvokeInput } from "@mininglamp-oss/octo-runtime-protocol";
import { createCodexAdapter, createManagedCodexEngine } from "@mininglamp-oss/octo-runtime-adapter-codex";

const executor = new AgentExecutor();
const owner = createManagedCodexEngine({ command: "/absolute/path/codex", env: process.env, codexHome: "/absolute/host-codex-home" });
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

One managed owner supervises one app-server, without pools based on cwd, model, environment, MCP, capacity or concurrency. The process uses the owner's fixed environment and inherits the host working directory without an explicit spawn cwd; CODEX_HOME selects Codex data. Each request supplies its workdir, shell/MCP environment, HTTP headers and capacity through thread/turn configuration. Stream limits apply per invocation. Per-call `adapter.codex/options.payload.codexServiceRevision` fails with CODEX_SERVICE_REVISION_UNSUPPORTED; the host must close and recreate its owner when changing accounts or startup configuration. Credentials remain private in diagnostics. Raw descriptor invocation requires an explicit execution scope; Core registration binds it automatically.

An idle or active transport failure proactively replaces the owned process, with at most five replacements per recovery episode and a 90-second budget. Original business and control requests are never replayed. Startup errors such as a missing executable fail without repeated retries. Healthy operation for 60 seconds resets the recovery budget.

## Construction, Home and Ownership

createCodexAdapter({engine}) is Codex-specific. engine.acquire returns {channel, configuration}; channel.close is idempotent and invocation-specific, while configuration contains the MCP view and native thread overrides. The provider coordinates shared RPC IDs, thread/turn routing and configuration rejection without exposing owner.close. Multiple Cores can borrow one provider. Separate owners require an explicit strong isolation decision such as separate accounts. Default CLI composition constructs each harness type once.

SDK hosts must supply an absolute codexHome. Missing/relative paths fail with CODEX_HOME_REQUIRED; invocation conflicts fail with CODEX_HOME_CONFLICT. Hosts own directory preparation, permissions and data retention. Closing or recovering a process never deletes Home. CLI chooses its own ~/.codex default. Existing business Engines may supply their own provider; closing a borrowing Kernel leaves that owner running.

The singleton, default export and old process constructor options are removed without compatibility. Other adapters choose arbitrary construction signatures without Codex types or common options. See the [SDK example](../../docs/examples/codex-service.mts) for shutdown and initialization rollback and the [architecture](../../docs/en/concepts/architecture.md).

## Limits

- In `ask` and `assisted` modes, approvals use the active interaction bridge. `full_access` automatically handles supported approvals, but does not answer user questions or MCP elicitation.
- Ordered text and image input, including image-only input, become native text and image data URLs, not host-local paths. Image support in the Adapter does not guarantee the selected model accepts images. Formats, integrity fields, and size limits follow the [input reference](../../docs/en/reference/invoke-input.md).
- The authoritative session update is reported only after turn start succeeds; the Adapter never rebuilds application history.
- A turn acknowledgement, a text chunk, or a child exit is not proof of successful completion or cleanup.
- In native mode you must read Runtime control frames alongside Provider payloads.
- Concurrency admission and resource quotas belong to the host. The owner imposes no agent-count, estimated lease-memory, lifetime-thread or aggregate interaction quota. Concurrent turns on the same thread are rejected. It retains only active invocation routes, not completed-thread history; existing transport queue and stream limits still apply.
- A nullable-turn elicitation can be routed only when the current invocation created the thread. On a resumed thread its causality cannot be established, so the Adapter rejects it explicitly without consulting history.
- A nonempty completed `final_answer` with no open work or synchronous interaction can complete after a 15-second finalization fallback. Cancellation, Provider error and subsequent work invalidate eligibility. Turn cleanup remains independently observable and can fail after the result is completed.

Human approval capacity counts requests awaiting a decision per invocation, up to 256. Request 257 receives an explicit rejection while admitted approvals remain valid. A valid decision releases its slot immediately; automatic approvals consume no human slots. Questions and MCP elicitations retain a separate limit of 16 unfinished requests. `full_access` keeps Codex's `untrusted` policy and lets Runtime handle supported approvals automatically, preserving dynamic MCP behavior.

All stdin frames for one managed app-server share a bounded writer: 4096 normal entries / 64 MiB, including the active frame, plus a reserve of 4096 entries / 64 KiB for protocol rejections and interrupts. Human-capacity rejections use the normal queue so an ordinary overflow burst cannot exhaust the control reserve. It waits for each write callback and, when `write` returns false, for `drain`. Five seconds without write progress or 30 seconds since enqueueing fails delivery. The human decision deadline remains 10 minutes. Resolved confirms a successful local write callback, not Provider receipt or tool completion. Cancellation removes only the invocation's queued responses; bytes already handed to the pipe cannot be recalled.

Structured local capacity, write, and timeout causes take precedence over unrelated plugin Unauthorized stderr. Native `HOST_EXECUTION_FAILED.failure` and canonical failures preserve the same cause; actual Provider authentication rejection retains its credential classification.

## Owned process cleanup

Default POSIX spawning creates an owned, independent process group. Cleanup awaits bounded `SIGTERM` → `SIGKILL` escalation and group-exit confirmation, including when the app-server leader has exited but tools remain. An injected `spawnFn` child is not assumed to own a process group; its cleanup targets the direct child.

Normal completion, Stop and business consumer closure release the invocation subscription. Core.shutdown releases local scopes and leases. The host calls owner.beginShutdown(), awaits Core/Kernel cleanup, then owner.close({deadline}) and checks complete. The deadline is absolute performance.now() milliseconds. owner.processes() and Kernel serviceProcesses snapshots never start or probe a Provider.

Default owned spawning enables Windows process-tree cleanup through the existing system command. Injected children receive direct-child cleanup. Windows tree cleanup depends on a still-identifiable leader; leader-first exit, host crashes and escaped descendants remain outside a full descendant-exit guarantee. Check cleanup results rather than treating cancellation acknowledgement as exit proof.

See [Output and Control](../../docs/en/reference/output-and-control.md) for execution terminals and cancellation, and [Executor Core](../octo-runtime-executor-core/README.md) for `shutdown()` cleanup results.

## Import and distribution

Private workspace package, bundled with CLI but neither independently published nor re-exported through the full package. Native hosts integrate it from source, declare a `workspace:*` dependency and import it as needed; an OpenClaw-only host needs no Codex dependency. Independent applications connecting to the CLI Kernel install only `octo-runtime-client`.

## Further reading

- [Implementation](src/index.ts), [Adapter SDK](../octo-runtime-adapter-sdk/README.md), [Runtime Protocol](../octo-runtime-protocol/README.md).
- [Input reference](../../docs/en/reference/invoke-input.md).

## Private AgentEnv.Item

This package owns the following item; neither its name nor its payload is registered in public Schema, catalog or generated types. Existing options may share the same payload. Invalid explicit collaborationMode values fail in this Adapter.

Optional `collaborationMode` accepts only `"default"` or `"plan"`. Omission makes no `collaborationMode/list` request and sends no collaborationMode override; it does not reset a resumed thread. Explicit values must be advertised by the Provider. Unsupported modes, missing required native model or RPC failures fail without a fallback to another mode. Native settings use the explicit model/effort when supplied, otherwise the current thread response. Approval policy is independent.

```json
{ "namespace": "adapter.codex", "name": "options", "payload": { "collaborationMode": "plan" } }
```

Add this item to the same `agentEnv.items` array as the Adapter route and prepared workspace in the example above. Keep any existing options in this single item; duplicate namespace/name pairs are invalid. Model/effort remain in the shared model item. The removed public actmode item is not converted.

The same private options payload also accepts `appServerRequestTimeoutMs` (app-server RPC deadline, default 30,000 ms) and `finalizationTimeoutMs` (the final-answer fallback described above, default 15,000 ms). Each uses a finite positive number; omission or an invalid value keeps its existing default. These paths are owned by this package and are not emitted as public protocol configuration hints. Explicit invalid `collaborationMode` still fails as described above.
